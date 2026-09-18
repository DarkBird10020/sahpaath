# SahPaath API contract

Versioned core API (`/api/v1/*`) built on the repository/service layers, plus the **legacy** local classroom API (`/api/*`) that the current frontend depends on. Both run in the same server; the legacy API is documented at the bottom and must not break.

## Conventions

- **Base URL (local):** `http://127.0.0.1:PORT` (default 5173). Server binds loopback only.
- **Content type:** `application/json` for every request with a body. Oversized bodies → `413`.
- **Auth:** `sahpaath` HttpOnly cookie (SameSite=Strict), issued by a session route. Roles: `teacher`, `student` (anonymous). Student identity is an anonymous session id only.
- **Error shape (v1):** `{ "error": string, "code": ErrorCode, "details"?: unknown }`. Codes: `validation_failed` (400), `unauthorized` (401), `forbidden` (403), `not_found` (404), `conflict` (409), `revision_conflict` (409), `immutable` (409), `trust_transition` (409), `payload_too_large` (413), `unsupported_media_type` (415), `rate_limited` (429), `internal` (500).
- **Error shape (legacy):** `{ "error": string }` only.
- **Rate limits (local):** 500 req/min/IP overall; 20/min on logins; 30/min per student on questions; 30/min on local-mode uploads.
- **CSRF:** non-GET requests reject mismatched `Origin` and `Sec-Fetch-Site: cross-site`.
- **Uploads:** max 5 MB (`SAHPAATH_MAX_UPLOAD_BYTES`); grants expire after `SAHPAATH_PRESIGN_EXPIRES_SECONDS` (default 600s); content types restricted to `image/png`/`image/jpeg`; extension and browser MIME never trusted — magic bytes verified server-side after upload.

---

## Core API v1

### Session

#### POST /api/v1/session
Creates a session; sets the `sahpaath` cookie.
- **Auth:** none.
- **Request:** one of
  - `{ "role": "teacher", "password": string }`
  - `{ "role": "student" }`
- **Response 201:** `{ "role": "teacher" | "student", "code": string }` — `code` is the anonymous class code.
- **Errors:** 403 `forbidden` (wrong teacher password), 429 `rate_limited`.

#### GET /api/v1/session
- **Auth:** any session.
- **Response 200:** `{ "role": "teacher" | "student", "code": string }`
- **Errors:** 401 `unauthorized`.

#### DELETE /api/v1/session
- **Auth:** any. Clears the cookie.
- **Response 200:** `{ "ok": true }`

### Health

#### GET /api/v1/health
- **Auth:** none.
- **Response 200:** `{ "mode": "sqlite" | "memory" | "dynamodb", "awsConnected": boolean }`
- `awsConnected` is true only when the configured store really is DynamoDB. It is never turned on by configuration alone.

### Lessons

#### POST /api/v1/lessons
- **Auth:** teacher.
- **Request:** `{ "title": string (1..140), "description"?: string (<=2000) }`
- **Response 201:** Lesson object: `{ lessonId, teacherId, title, description, status: "draft", revision, createdAt, updatedAt, publishedVersionId: null }`
- **Errors:** 400 `validation_failed`, 403 `forbidden`.

#### GET /api/v1/lessons
- **Auth:** teacher.
- **Response 200:** `Lesson[]` (own lessons only, newest first).

#### GET /api/v1/lessons/:lessonId
- **Auth:** teacher (owner).
- **Response 200:** Lesson object.
- **Errors:** 404 `not_found`, 403 `forbidden` (another teacher's lesson).

### Diagrams (direct-to-S3 upload flow)

The diagram flow never sends image bytes through the API JSON body. The teacher registers metadata, receives a **presigned direct-upload form**, the browser uploads straight to private S3 (or the clearly-labeled local sink in dev), then processing starts server-side.

#### POST /api/v1/lessons/:lessonId/diagrams
Registers a diagram **without bytes**. License metadata is required up front — a diagram without `sourceType` + `licenseName` can never be registered, and the publish endpoint re-checks the gate server-side.
- **Auth:** teacher (lesson owner).
- **Request:** `{ "sourceType": string (1..80, e.g. "teacher_created"), "licenseName": string (1..120, SPDX-style or "proprietary"), "attribution"?: string (<=500), "sourceUrl"?: string | null, "contentType": "image/png" | "image/jpeg" }`
- **Response 201:** Diagram object with `originalS3Key: null`, `mimeType: null`, `byteSize: 0`, `processingStatus: "pending"`, `activeVersionId: null`.
- **Errors:** 400 `validation_failed` (schema, empty license fields), 403 `forbidden`, 404 `not_found` (lesson).

#### GET /api/v1/lessons/:lessonId/diagrams
- **Auth:** teacher (owner).
- **Response 200:** `Diagram[]`.
- **Errors:** 403, 404.

#### POST /api/v1/diagrams/:diagramId/upload-url
Grants a **presigned POST form** the browser uses to upload directly — never through this API. The grant always:
- **expires** (`SAHPAATH_PRESIGN_EXPIRES_SECONDS`, default 600s),
- restricts **content-length-range** to `[1, maxUploadBytes]` (5 MB default),
- pins the **exact content type** (`image/png` or `image/jpeg` — no wildcards),
- targets a **unique server-generated key** (`uploads/<diagramId>/original.<ext>`),
- and the bucket stays **private** (no ACL is granted; access only via the API).

File extension and browser MIME are never trusted: after upload, `POST .../process` path re-verifies **magic bytes** server-side.
- **Auth:** teacher (owner).
- **Request:** `{ "contentType"?: "image/png" | "image/jpeg" }` (defaults to `image/png`)
- **Response 201 (cloud mode, `SAHPAATH_S3_BUCKET` set):**
  ```json
  { "mode": "s3", "url": "https://<bucket>.s3.<region>.amazonaws.com/", "fields": { "key": "uploads/<diagramId>/original.png", "Content-Type": "image/png", "...S3 policy fields...": "..." }, "expiresAt": 1700000000000, "key": "uploads/<diagramId>/original.png", "maxBytes": 5000000, "contentType": "image/png" }
  ```
  The client POSTs `fields` + `file` as `multipart/form-data` to `url`.
- **Response 201 (local mode, no bucket):** same shape with `"mode": "local"`, `url: "/api/v1/uploads/local"`, and HMAC-signed `x-sahpaath-*` fields mirroring the S3 policy conditions. **This is the local adapter, explicitly not AWS.**
- **Errors:** 400 `validation_failed`, 403 `forbidden`, 404 `not_found` (diagram), 409 `conflict` (image already uploaded).

#### POST /api/v1/uploads/local — LOCAL ADAPTER ONLY
Receives the multipart form in local mode (same field/file shape as an S3 POST). Verifies the HMAC grant (key, size cap, content type, expiry, diagram binding), enforces the 5 MB cap, validates **magic bytes** (extension/browser MIME ignored), stores bytes privately, and stamps the diagram.
- **Only registered when no S3 bucket is configured** — returns 404 when S3 is enabled. Responses always carry `"mode": "local"`.
- **Auth:** teacher (owner). Rate limit 30/min.
- **Request:** `multipart/form-data` with the granted fields (`key`, `Content-Type`, `x-sahpaath-diagram-id`, `x-sahpaath-max-size`, `x-sahpaath-expires-at`, `x-sahpaath-token`) plus `file`.
- **Response 201:** `{ "mode": "local", "diagram": Diagram }` — `diagram.originalS3Key`, `mimeType` (magic-byte verified), `byteSize` now set.
- **Errors:** 400 `validation_failed` (bad/expired/forged grant, type mismatch, magic-byte mismatch, empty file), 403, 404, 413 `payload_too_large`, 429 `rate_limited`.

#### POST /api/v1/diagrams/:diagramId/process
Runs the **DiagramSense pipeline** on the stored, magic-byte-verified image: Textract OCR → normalization → Bedrock structured proposal (retry once on malformed output) → deterministic validator → `ai_proposed` draft. Synchronous in this version; the Step Functions layout is designed but UNVERIFIED (docs/DIAGRAM_PIPELINE.md). Stages are recorded honestly: real stages `completed`, unconfigured providers `fallback` with `simulation: true`, failures `failed` with the real error. Never publishes — teacher review is the next gate.
- **Auth:** teacher (owner).
- **Response 201:** `{ "diagram": Diagram (processingStatus: "awaiting_review"|"failed"), "job": { "jobId", "mode": "local", "status": "succeeded"|"failed", "stages": [{ name, status, simulation, detail, durationMs }] }, "issues": [{ code, severity, itemId, message }] }` — `issues` lists grounding/validation findings (e.g. `unknown_label` for an invented OCR reference).
- **Errors:** 404, 403, 409 `conflict` (**duplicate processing request**, or image not uploaded yet).

#### GET /api/v1/diagrams/:diagramId/draft
Draft payload for the review UI: OCR labels with coordinates/confidence plus proposed parts (with `descriptionShort`/`descriptionDetailed` levels).
- **Auth:** teacher (owner).
- **Response 200:** `{ "diagramId", "version", "labels": [{ labelId, text, confidence, x, y }], "parts": [{ partId, labelId, name, description, descriptionShort?, descriptionDetailed?, state, reviewNote }] }`
- **Errors:** 404, 403, 409 `conflict` (no draft version).

#### GET /api/v1/diagrams/:diagramId/processing-status
- **Auth:** teacher (owner).
- **Response 200:** `{ "diagramId", "processingStatus", "activeJobId", "stages": [...] | null, "error": string | null, "mode": "stepfunctions" | "local" | "none" }`
- **Errors:** 404, 403.

#### GET /api/v1/diagrams/:diagramId
- **Auth:** teacher (owner of the owning lesson).
- **Response 200:** `{ diagram: Diagram, lesson: Lesson }`
- **Errors:** 404, 403.

#### GET /api/v1/diagrams/:diagramId/versions
- **Auth:** teacher (owner).
- **Response 200:** `DiagramVersion[]` ascending by `version`.

#### POST /api/v1/diagrams/:diagramId/structure
Replaces the **draft** structure. All trust states reset to `ai_proposed`, then the deterministic validator re-runs: passing items → `validated`, flagged → `needs_review`. Prior approvals do NOT survive an edit.
- **Auth:** teacher (owner).
- **Request:** `{ "diagramId": string, "expectedVersionCreatedAt": ISO-8601 (from the current draft), "structure": { "labels": DiagramLabel[], "parts": DiagramPart[], "relations": Relationship[], "flows": ProcessFlow[] } }`
  - `DiagramLabel: { labelId, text, confidence: number|null, source: "teacher_entered"|"textract"|"fixture", x, y }` (x/y normalized 0..1)
  - `DiagramPart: { partId, labelId, name, description, state, reviewNote }`
  - `Relationship: { relationId, fromPartId, toPartId, kind: "flows_to"|"connects_to"|"supports", evidenceLabelIds: string[], state, reviewNote }`
  - `ProcessFlow: { flowId, name, stepPartIds: string[], state, reviewNote }`
- **Response 201:** updated `DiagramVersion`.
- **Errors:** 400 `validation_failed`, 409 `revision_conflict` (stale `expectedVersionCreatedAt`), 409 `conflict` (no draft version — one is published), 403, 404.

#### POST /api/v1/diagrams/:diagramId/decision
Applies an explicit teacher decision to one item (part/relation/flow). Backend-enforced trust transitions: approve walks `→ validated → teacher_approved` and is blocked by structural errors (warnings require a note); reject → `rejected`. Approving over a rejected item re-validates it first. A rejection invalidates dependent approvals (`teacher_approved` → `needs_review`).
- **Auth:** teacher (owner).
- **Request:** `{ "diagramId": string, "itemId": string, "itemType": "part" | "relation" | "flow", "decision": "approve" | "reject", "note": string (<=1000), "expectedVersionCreatedAt": ISO-8601 }`
- **Response 201:** updated `DiagramVersion`; each item carries `state` + `reviewNote`.
- **Errors:** 400 `validation_failed` (structural errors block approval; warning without note), 409 `revision_conflict`, 409 `trust_transition` (illegal state move), 404 `not_found` (item missing).

#### POST /api/v1/diagrams/:diagramId/publish
Publishes the draft as a new **immutable** version. Gated: complete source/license metadata on the diagram (`sourceType` + `licenseName`), every item decided, ≥1 approved part, zero structural errors. Executed as one conditional transaction (docs/DYNAMODB.md): the draft row transitions draft→published only while `status = "draft"`; `diagram.activeVersionId` flips only from the expected value; the lesson revision must match. Two racing publishes cannot both succeed.
- **Auth:** teacher (owner).
- **Request:** `{ "diagramId": string, "expectedVersionCreatedAt": ISO-8601 }`
- **Response 201:** published `DiagramVersion` containing **only** approved items (rejected ones are dropped, labels filtered to approved parts).
- **Errors:** 409 `conflict` (undecided items, nothing approved, structural errors, publish race), 409 `revision_conflict`, 409 `immutable` (already published), 403, 404.

#### POST /api/v1/diagrams/:diagramId/versions
Creates draft version N+1 from the latest version (published versions are never modified).
- **Auth:** teacher (owner).
- **Response 201:** new draft `DiagramVersion` (all item states preserved from the source version; decisions must be re-made before publishing).
- **Errors:** 404, 403, 409 `revision_conflict`.

### Student surface

#### GET /api/v1/published/:diagramId
Returns the currently published version for students. Defense-in-depth serializer refuses to serve any item that is not `teacher_approved`.
- **Auth:** any session.
- **Response 200:** `DiagramVersion` (published items only).
- **Errors:** 404 `not_found` (nothing published), 401.

### Questions (anonymous students → teacher inbox)

#### POST /api/v1/questions
- **Auth:** any session (student intended). Rate limit 30/min.
- **Request:** `{ "lessonId": string, "conceptPartId": string | null, "text": string (1..500) }`
- **Response 201:** `{ questionId, lessonId, versionId (pinned to the published version), studentSessionId (anonymous), conceptPartId, text, acknowledged: false, acknowledgedAt: null, createdAt }`
- **Errors:** 409 `conflict` (lesson not published, duplicate id), 404, 429.

#### GET /api/v1/lessons/:lessonId/questions
- **Auth:** teacher (owner).
- **Response 200:** `StudentQuestion[]` (oldest first).

#### POST /api/v1/questions/:questionId/acknowledge
- **Auth:** teacher (owner).
- **Response 200:** `{ "ok": true }` (idempotent).
- **Errors:** 404, 403.

### Captions (loaded transcripts / manual notes today; live later)

#### POST /api/v1/caption-sessions
- **Auth:** teacher (owner). Requires a published lesson version.
- **Request:** `{ "lessonId": string, "mode": "loaded" | "manual" }`
- **Response 201:** `{ sessionId, lessonId, versionId, mode, startedAt, revision }`
- **Errors:** 409 `conflict` (lesson not published), 403, 404.

#### POST /api/v1/caption-sessions/:sessionId/segments
- **Auth:** teacher (owner).
- **Request:** `{ "sessionId": string, "text": string (1..4000) }`
- **Response 201:** `{ segmentId, sessionId, lessonId, index, text, corrections: [], createdAt }`

#### GET /api/v1/caption-sessions/:sessionId/segments
- **Auth:** any session.
- **Response 200:** `CaptionSegment[]` ordered by `index`.

#### POST /api/v1/caption-sessions/:sessionId/segments/:segmentId/correct
Teacher corrects a mis-heard term to an approved vocabulary term. The original text is retained; the correction is appended. Must match a term of the session's published version.
- **Auth:** teacher (owner).
- **Request:** `{ "sessionId": string, "segmentId": string, "heard": string (1..120), "termPartId": string }`
- **Response 201:** updated `CaptionSegment` (with `originalText` and `corrections`).
- **Errors:** 400 `validation_failed` (phrase not found in passage; term not approved for this version), 403, 404.

### Communication phrases

#### GET /api/v1/lessons/:lessonId/phrases
Fixed fast phrases, created lazily per lesson. Context-anchored variants use `conceptPartId`.
- **Auth:** any session.
- **Response 200:** `CommunicationPhrase[]`: `{ phraseId, lessonId, text, conceptPartId: null, sortOrder }`

---

## Legacy API (current frontend contract — must not break)

Documented for safety; behavior unchanged. Errors are `{ "error": string }`.

| Method + path | Auth | Request | Response |
|---|---|---|---|
| GET `/api/health` | none | — | `{ "mode": "local", "awsConnected": false }` |
| POST `/api/session` | none | `{ "role": "teacher" \| "student", "password"?: string }` | `{ "role", "code" }` + cookie |
| GET `/api/session` | any | — | `{ "role", "code" }` |
| DELETE `/api/session` | any | — | `{ "ok": true }` |
| GET `/api/fixtures` | any | — | fixture catalog (metadata only) |
| GET `/api/lessons` | teacher | — | legacy `Lesson[]` (fixture-based drafts) |
| POST `/api/lessons` | teacher | `{ "fixtureId": "heart" \| "water" \| "plant" \| "circuit" \| "pump" }` | legacy Lesson (201) |
| POST `/api/upload` | teacher | `{ "title", "mime", "base64" }` | legacy Lesson (201), manual editor |
| GET `/api/published` | any | — | `Published[]` |
| GET `/api/published/:lessonId?version=n` | any | — | `Published` |
| GET `/api/images/:file` | any (published images) / teacher | — | image bytes |
| GET `/api/lessons/:id` | teacher | — | legacy Lesson |
| PUT `/api/lessons/:id/map` | teacher | `{ revision, map }` | legacy Lesson (resets decisions) |
| POST `/api/lessons/:id/decision` | teacher | `{ revision, itemId, decision, note }` | legacy Lesson |
| POST `/api/lessons/:id/publish` | teacher | `{ revision }` | `Published` snapshot |
| POST `/api/lessons/:id/version` | teacher | `{ revision }` | legacy Lesson (new draft) |
| GET `/api/lessons/:id/audit` | teacher | — | `Audit[]` |
| GET `/api/lessons/:id/questions` | teacher | — | `Question[]` |
| GET `/api/lessons/:id/captions` | any | — | `Caption[]` for current published version |
| POST `/api/lessons/:id/captions` | teacher | `{ text, source: "manual_note" \| "loaded_transcript" }` | Caption (201) |
| POST `/api/questions` | any | `{ lessonId, version, conceptId?, text }` | Question (201) |
| POST `/api/questions/:id/acknowledge` | teacher | — | `{ "ok": true }` |
| POST `/api/captions/:id/correct` | teacher | `{ heard, termId }` | Caption |

Legacy sessions are honored on v1 routes through an explicit local bridge (hashed token lookup in the legacy store) so the current frontend can adopt v1 endpoints without a second login.

## Versioning policy

- v1 is additive: new fields may be added; existing field names/types are frozen while the frontend consumes them.
- Breaking changes → `/api/v2/*` with a migration window, never in-place edits of v1.
- The frontend re-validates every response with shared Zod schemas (`src/api.ts`), so contract breaks surface immediately as errors rather than silent corruption.
