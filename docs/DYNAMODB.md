# DynamoDB key strategy (design + local adapter)

Status: implemented as **design + local adapter**. No DynamoDB table exists yet — creating one is deferred until the AWS account is available and verified. The repository layer in `server/repositories/` defines the operations both the real DynamoDB adapter (documented here) and the local adapters (`memory`, `sqlite`) must implement, so the table can be provisioned later without touching the domain or service layers.

Table name: `sahpaath-main` (configurable via `SAHPAATH_DDB_TABLE`). Billing: on-demand (per-request), per COSTS.md. Point-in-time recovery and encryption at rest (AWS-owned key at minimum) should be enabled at provisioning time. **UNVERIFIED:** account/region availability, applied quotas, PITR settings — requires an authenticated account; nothing here may be created before docs/AWS_VERIFICATION.md gates pass.

## Entities and key layout (single table)

| Entity | PK (partition) | SK (sort) | GSI-1 (PK/SK) | GSI-2 (PK/SK) |
|---|---|---|---|---|
| User | `USER#<userId>` | `PROFILE` | — | — |
| Session | `USER#<userId>` | `SESSION#<sessionId>` | — | — |
| Lesson | `LESSON#<lessonId>` | `META` | `TEACHER#<teacherId>` / `LESSON#<updatedAt>` | — |
| Diagram | `LESSON#<lessonId>` | `DIAGRAM#<diagramId>` | — | — |
| DiagramVersion | `DIAG#<diagramId>` | `VERSION#<version>` | — | `LESSON#<lessonId>` / `DIAG#<diagramId>` |
| DiagramPart | `DIAG#<diagramId>` | `VERSION#<version>#PART#<partId>` | — | — |
| Relationship | `DIAG#<diagramId>` | `VERSION#<version>#REL#<relationId>` | — | — |
| ProcessFlow | `DIAG#<diagramId>` | `VERSION#<version>#FLOW#<flowId>` | — | — |
| Approval | `DIAG#<diagramId>` | `VERSION#<version>#APPROVAL#<itemId>` | — | — |
| ProcessingJob | `DIAG#<diagramId>` | `JOB#<jobId>` | — | — |
| VocabularyTerm | `LESSON#<lessonId>` | `VOCAB#<termId>` | — | — |
| CaptionSession | `LESSON#<lessonId>` | `CAPSESS#<sessionId>` | — | — |
| CaptionSegment | `CAPSESS#<sessionId>` | `SEG#<index>` | — | — |
| CommunicationPhrase | `LESSON#<lessonId>` | `PHRASE#<phraseId>` | — | — |
| StudentQuestion | `LESSON#<lessonId>` | `QUESTION#<questionId>` | `TEACHER#<teacherId>` / `QUESTION#<createdAt>` | — |
| AuditEvent | `LESSON#<lessonId>` | `AUDIT#<createdAt>#<eventId>` | — | — |

Notes:

- Single-table design: one item type per composite key; every item carries `type` and, where relevant, `lessonId` for authorization checks at the service layer.
- Diagram version items (parts/relations/flows/approvals) are keyed under the **diagram** partition with `VERSION#<version>` prefix so a version is one queryable unit; `DiagramVersion` carries the `map` snapshot? **No** — parts/relations/flows are stored as individual items (they are small), while `DiagramVersion` stores the immutable rendered snapshot metadata. The **original image bytes and derived audio never go in DynamoDB** — only S3 keys.
- `DiagramVersion` is the immutable published record: once written with `state = published`, no update or delete is permitted (enforced by repository conditional writes; in DynamoDB additionally protect with a condition expression + IAM least privilege; optionally a DynamoDB CloudTrail/deny-update policy — UNVERIFIED until account review).
- Student identity: anonymous `studentSessionId` only (random, opaque). No student names, emails, or device identifiers are stored anywhere.

## Access patterns → operation mapping

| # | Access pattern | Operation |
|---|---|---|
| AP1 | List lessons for teacher | Query GSI-1 `PK = TEACHER#<teacherId>` |
| AP2 | Get lesson metadata | GetItem `LESSON#id / META` |
| AP3 | Get diagram + its versions | Query `DIAG#id` with `begins_with(SK, VERSION#)` |
| AP4 | Get all parts/relations/flows for a version | Query `DIAG#id` with `begins_with(SK, VERSION#<v>#)` |
| AP5 | Get active (published) version for students | GetItem `DIAG#id / VERSION#<activeVersion>` (version id from `Diagram.activeVersionId`) |
| AP6 | List audit events for lesson (teacher) | Query `LESSON#id` with `begins_with(SK, AUDIT#)`, newest first |
| AP7 | Teacher inbox: unacknowledged questions across lessons | Query GSI-1 `PK = TEACHER#<t>` (questions carry teacherId), filter `acknowledged = false` |
| AP8 | Vocabulary for lesson | Query `LESSON#id` with `begins_with(SK, VOCAB#)` |
| AP9 | Caption segments for a session | Query `CAPSESS#id` with `begins_with(SK, SEG#)` |
| AP10 | Phrases for student communication screen | Query `LESSON#id` with `begins_with(SK, PHRASE#)` |
| AP11 | Session lookup by cookie token hash | GetItem `USER#<userId> / SESSION#<sessionId>` — **note:** the HTTP layer resolves cookie→user first; local adapter stores an index, DynamoDB adapter uses GSI on token hash (see below) |
| AP12 | Auth check "is this lesson mine?" | GetItem `LESSON#id / META` and compare `teacherId` (deny-by-default) |

GSI-1 (teacher index) projected keys: `PK = TEACHER#<teacherId>`, `SK = <ENTITY>#<sort>` where sort is `LESSON#<updatedAt>` for lessons and `QUESTION#<createdAt>` for questions. GSI-2 (lesson→diagram lookup) only needs `PK = LESSON#<lessonId>`, `SK = DIAG#<diagramId>`. All GSIs are `ALL` projection for simplicity; revisit projection if item sizes grow.

Session lookup by token: the token hash is not the primary key (the partition is the user). The DynamoDB adapter adds **GSI-3: `PK = TOKEN#<sha256(token)>`, `SK = SESSION#<sessionId>`** used only by the auth service; the local memory/sqlite adapters keep a simple map. Session TTL uses the `expires` attribute with DynamoDB TTL enabled on `ttl` (epoch seconds) — UNVERIFIED until account provisioning; the adapters also check `expires` explicitly so correctness does not depend on TTL timing.

## Conditional writes (the load-bearing rules)

1. **Publish race prevention (required):** publishing writes `DiagramVersion` (state=published) and updates `Diagram.activeVersionId` + `Lesson.status/publishedVersionId` in a **TransactWriteItems** with:
   - `Put` DiagramVersion: `ConditionExpression: attribute_not_exists(PK) AND attribute_not_exists(SK)` — a version row can only ever be created once; two racing publishers cannot both claim the same `(diagramId, version)`.
   - `Put` each Approval row (audit of who approved what): same `attribute_not_exists` condition.
   - `Update` Diagram: `ConditionExpression: activeVersionId = :expected` where `:expected` is the version the teacher reviewed (or `attribute_not_exists(activeVersionId)` for the first publish). This makes the second racing publish fail with `TransactionCanceledException`.
   - `Update` Lesson: `ConditionExpression: revision = :expectedRevision` (optimistic concurrency, same rule as the existing store).
   The service layer rejects un-publishable states (unresolved decisions, structural errors) **before** the transaction; the conditional expressions are the second line of defense, not the first.
2. **Decision/immutable-version protection:** updates to any item under `VERSION#...` after publication are rejected by the service; the repository's `replaceVersionItems` only ever writes when `versionStatus != 'published'`. DynamoDB adapter additionally adds `ConditionExpression: attribute_not_exists(publishedAt)` on version-item writes.
3. **Optimistic concurrency everywhere else:** every mutable aggregate (Lesson, Diagram, CaptionSession) carries a monotonic `revision`; every update uses `ConditionExpression: revision = :expected` and returns a typed `RevisionConflictError` on failure.
4. **Idempotent session/question creation:** questions use `attribute_not_exists(PK AND SK)` so a double-tap cannot duplicate a question.

## Serialization rules

- All attributes are typed per entity via Zod schemas in `shared/model.ts` before write and after read (defense against schema drift).
- No S3 content, no base64 blobs, no transcripts > item limit — only keys and text fields.
- Numbers (revision, version, index) are stored as DynamoDB numbers; ISO-8601 strings for timestamps so sorting is lexicographic.
- Every item includes `type` (entity name) and `ttl` where a retention rule exists (sessions only today).

## Local adapters

- `memory` (default for unit tests): `Map<(pk, sk), unknown>` with the same conditional-write semantics implemented in JS; deterministic and fast.
- `sqlite` (existing local server): tables keyed `(pk, sk)` with a JSON `body` column; conditions evaluated inside a transaction; used when `SAHPAATH_STORE=sqlite` so the local server can run the *same* service code as the future Lambda.
- `dynamodb`: thin `@aws-sdk/lib-dynamodb` DocumentClient wrapper implementing the same interface; enabled by `SAHPAATH_STORE=dynamodb` with table name from env. It will be exercised only after the account gates pass; until then its module exists and is unit-tested against the interface contract with a fake document client (no network).
