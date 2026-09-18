# SahPaath backend audit

Date: 2026-09-18. Scope: read-only inspection of the full repository under `sahpaath/`. No files were modified for this audit. No code was run except read-only `git log`/`git status`.

Throughout: **UNVERIFIED** marks any claim that could not be confirmed from repository evidence (AWS capabilities, model IDs, runtime behavior not executed in this session).

---

## 1. Current architecture

**Stack:** React 19 + strict TypeScript + Vite 8 (frontend, `src/`), a single-process Node ≥24 HTTP server (`server/index.ts`) that embeds Vite in middleware mode for dev and serves `dist/` statically with `--production`, Node's built-in `node:sqlite` (`DatabaseSync`) for storage, and Zod 4 schemas in `shared/` as the single source of types for both sides.

**Dependency direction:** `UI (src/) → JSON API (/api/*) → shared/domain.ts (deterministic trust rules) → SQLite (.data/sahpaath.sqlite)`. The server binds to `127.0.0.1` only, rejects non-localhost `Host` headers, and is explicitly a local-only classroom app. There is **no separate deployable backend service**; backend and frontend are one process today.

**Trust pipeline (the core architectural idea, actually implemented):**
`AI proposes → deterministic validation → explicit teacher decision → gated publish → serialized student view`.

- `shared/domain.ts` (303 lines): pure deterministic functions — `validateMap` (structural issues), `revalidate` (recolor trust states), `decide` (approve/reject with note enforcement), `publishSnapshot` (gated immutable snapshot), `studentSerialize` (defense-in-depth serializer that throws on any non-approved item).
- Trust states: `ai_proposed → needs_review | validated → teacher_approved | rejected`, enforced server-side on every mutation, not in UI.
- Publication is transactional (`BEGIN IMMEDIATE`), conditional on revision, protected by unique `(lesson_id, version)` and SQLite triggers that abort any `UPDATE`/`DELETE` on `versions` rows.
- Editing a map resets all decisions (`revalidate(map, true)`); editing a published lesson requires `POST /version` which bumps the version and resets decisions.

**AWS status: none.** No AWS SDK dependency, no credentials, no service calls, no IaC. This is a deliberate, documented local-first decision (README, PROMPT.md user update, docs/AWS_VERIFICATION.md). The API contract has an `awsConnected: false` field ready to change.

## 2. Existing files

| Area | Files |
|---|---|
| Server | `server/index.ts` (457 lines: HTTP routing, auth, rate limiting, CSP-ish headers, static serving), `server/store.ts` (SQLite Store class), `server/providers.ts` (DemoAnalysisProvider, `imageType` magic-byte sniffing, `createLesson` pipeline stages) |
| Shared domain | `shared/schema.ts` (all Zod schemas + inferred types), `shared/domain.ts` (validator/decide/publish/serialize), `shared/vocabulary.ts` (term regex + `correctVocabulary`), `shared/fixtures.ts` + `shared/catalog.ts` (5 authored demo fixtures, demo transcript), `shared/evaluation.ts` (metric scorers returning `null` when unmeasured) |
| Frontend (teammate's domain — do not redesign) | `src/App.tsx`, `Teacher.tsx`, `Student.tsx`, `Captions.tsx`, `CaptionCorrection.tsx`, `MapEditor.tsx`, `SpatialGraph.tsx` (lazy three.js), `WorldStory.tsx`, `LessonJourney.tsx`, `PathwayEmblem.tsx`, `components.tsx`, `api.ts` (single fetch wrapper with response re-validation via Zod), CSS files |
| Tests | `tests/domain.test.ts` (trust boundaries + store publication), `tests/vocabulary.test.ts`, `tests/evaluation.test.ts`, `tests/e2e/classroom.spec.ts` (Playwright + axe, separate port 5174 and `.data/e2e`) |
| Scripts/tooling | `scripts/evaluate.ts` (CLI scorer), `vitest.config.ts`, `playwright.config.ts`, `package.json` scripts (`dev`, `build`, `start`, `typecheck`, `test`, `test:e2e`, `evaluate`) |
| Docs | README, PROMPT.md, `docs/ARCHITECTURE.md`, `docs/AWS_VERIFICATION.md` (UNVERIFIED register), `docs/COSTS.md`, `docs/EVALUATION.md`, `docs/ACCESSIBILITY.md`, `docs/PREFLIGHT.md`, `CREDITS.md`, `LEARNINGS.md`, axe/Playwright reports |
| Runtime data (gitignored) | `.data/sahpaath.sqlite`, `.data/uploads/*.png|jpg` |

## 3. Existing API contracts

All endpoints are under `/api/*`, session-cookie auth (`sahpaath` cookie, HttpOnly, SameSite=Strict), JSON in/out, errors as `{ error: string }` with 400/401/403/404/409/413/415/429. Rate limits: 500 req/min/IP overall, 20/min login, 30/min questions per session code.

| Method + path | Role | Purpose | Notes |
|---|---|---|---|
| GET `/api/health` | public | `{ mode: "local", awsConnected: false }` | |
| POST `/api/session` | public | teacher (password) or anonymous student login; sets cookie, returns `{ role, code }` | 6-char hex class code per session |
| GET `/api/session` | any | current session | |
| DELETE `/api/session` | any | logout | |
| GET `/api/fixtures` | any | fixture catalog metadata only (not draft content) | |
| GET `/api/lessons` | teacher | list drafts | |
| POST `/api/lessons` | teacher | create from fixture `{ fixtureId }` | runs demo analysis + validation |
| POST `/api/upload` | teacher | `{ title, mime, base64 }` → lesson with image | magic-byte check, 5 MiB cap, saved to `.data/uploads/`, goes to manual editor (no OCR) |
| GET `/api/published` | any session | list of published versions (student-safe serialization) | UI polls every 5 s |
| GET `/api/published/:lessonId?version=n` | any session | one published snapshot | |
| GET `/api/images/:file` | teacher, or any session if image belongs to a published lesson | uploaded diagram bytes | path allow-list `\w+-\.(png\|jpg)` |
| GET `/api/lessons/:id` | teacher | draft with map + stages | |
| PUT `/api/lessons/:id/map` | teacher | replace map; **resets all decisions** | conflict-safe via revision |
| POST `/api/lessons/:id/decision` | teacher | `{ itemId, decision: approve\|reject, note }` | approves blocked on errors; warnings require note |
| POST `/api/lessons/:id/publish` | teacher | gated immutable publish `{ revision }` | all items decided, ≥1 approved part, no errors |
| POST `/api/lessons/:id/version` | teacher | new draft version after publish | |
| GET `/api/lessons/:id/audit` | teacher | audit events | |
| GET `/api/lessons/:id/questions` | teacher | student questions for lesson | |
| GET `/api/lessons/:id/captions` | any session | captions for current published version | |
| POST `/api/lessons/:id/captions` | teacher | add loaded transcript / manual note | **not** live recognition |
| POST `/api/questions` | any session (student) | `{ lessonId, version, conceptId?, text }` | conceptId must exist in published vocabulary; 30/min |
| POST `/api/questions/:id/acknowledge` | teacher | teacher acknowledges question | no un-acknowledge / no student-visible status |
| POST `/api/captions/:id/correct` | teacher | `{ heard, termId }` → `correctVocabulary` rewrite | preserves `originalText`, appends correction log |

Mutation routes additionally reject cross-origin `Origin` mismatches and `Sec-Fetch-Site: cross-site` (CSRF defense in depth for the local-only deployment).

## 4. Database / storage

`node:sqlite` (`DatabaseSync`, WAL, foreign keys) — tables: `lessons (id, revision, body JSON)`, `versions (lesson_id, version, body JSON)` with immutability triggers, `audit`, `questions`, `captions` (all body-JSON keyed by id + lesson_id), `sessions (token-hash, role, code, expires)`. Images are files in private `.data/uploads`, never DB blobs. Optimistic concurrency via `revision` everywhere (`WHERE id=? AND revision=?`). `ARCHITECTURE.md` documents a proposed (design-only) DynamoDB single-table key layout.

## 5. Authentication

- Teacher: single shared password from `SAHPAATH_TEACHER_PASSWORD` (default `sahpaath-local`), SHA-256 + `timingSafeEqual`. No per-user accounts, no salt, no KDF (acceptable for local dev; documented as non-deployable).
- Student: anonymous, no password; server issues a random 3-byte hex class code bound to the session. No student PII stored (matches the minimization requirement).
- Sessions: 32-byte random token, only the SHA-256 hash stored, 12 h expiry, HttpOnly + SameSite=Strict cookie, cleanup of expired rows on login.
- Authorization: `teacher()` guard on every mutating/draft route; student-safe content only via `studentSerialize`.

## 6. Environment variables

`.env.example`: `SAHPAATH_TEACHER_PASSWORD`, `PORT`, and a comment that AWS is unconfigured. Actually read by code: `PORT` (default 5173), `SAHPAATH_DATA_DIR` (default `.data`), `SAHPAATH_TEACHER_PASSWORD`. Server loads `.env` via `loadEnvFile` if present (no dotenv dependency). Playwright e2e overrides all three. No AWS, no `VITE_` variables.

## 7. Existing AWS integrations

**None.** Confirmed: no `@aws-sdk/*` in package.json or lockfile usage, no service clients, no IaC (no CDK/SAM/Terraform), no credentials files. `docs/AWS_VERIFICATION.md` is a documentation-review register with explicit UNVERIFIED entries for: Bedrock model availability/IDs, image+structured-output+forced tool choice support, Textract access/quotas (notes a 5 MB vs 10 MB doc discrepancy; product policy is 5,000,000 bytes until tested), Step Functions callback tokens (Standard only), Polly voices/engines/pricing, Transcribe streaming + custom vocabulary table format, Cognito identity-pool browser credential scoping, and applied regional quotas. No AWS capability has been account-verified. **No model IDs exist anywhere in the repo — none may be invented.**

## 8. Existing AI integrations

**None live.** `DemoAnalysisProvider.analyze()` returns authored fixture maps synchronously and is labeled `simulation: true` in the stage data; the UI renders a "Demo simulation" badge. The `AnalysisProvider` interface (`{ ok: true, map } | { ok: false, reason, fallback: "manual_editor" }`) is the correct seam to implement a real Bedrock/Textract provider later — failures return results, never throw. Uploads (real PNG/JPEG) skip AI entirely and enter the manual map editor with `source: "teacher_entered"` labels, keeping provenance honest.

## 9. Existing schemas / types

`shared/schema.ts` is comprehensive and strict (`.strict()` on input schemas): `labelSchema` (with `confidence`, `source: demo_fixture|teacher_entered|textract`, normalized x/y geometry), `partSchema`, `relationSchema` (`flows_to|connects_to|supports` + `evidence` label ids), `flowSchema` (ordered steps), `mapSchema`, `issueSchema` (validator output), `stageSchema` (pipeline visibility incl. `simulation` flag), `lessonSchema` (revision/version/status/stages/jobId), `termSchema` (vocabulary: `state: "teacher_approved"` literal), `publishedSchema`, `questionSchema`, `captionSchema` (with `corrections` + preserved `originalText`), `auditSchema`, `sessionSchema`, and route-input schemas (`uploadSchema`, `editSchema`, `approveSchema`, `revisionSchema`, `questionInput`). `shared/evaluation.ts` defines `runSchema` requiring `source: "actual_run"` provenance.

## 10. UI/API assumptions (contract the frontend depends on — must not break)

- `src/api.ts` re-validates every response with the same Zod schemas; any backend response-shape change will throw in the UI.
- Polling: `GET /api/published` every 5 s for live updates; no WebSockets/SSE anywhere.
- Teacher UI expects `stages[]` with `{ name, status, simulation, detail, durationMs, retries, error }`; simulation stages are labeled.
- Students fetch published snapshots only; server never sends draft/rejected content to non-teachers (test-covered).
- Captions reference published version; corrections must match an approved term of that exact version.
- Questions pin `version` so anchors survive re-publication.
- The three features link through canonical part/vocabulary ids (`conceptId` = part id).

## 11. What is already implemented (and real)

Deterministic validator with 10 issue codes (duplicate_id, unknown_label, name_drift, low_ocr, manual_source, orphan, dangling, self_relation, missing_evidence, unknown_evidence, incomplete_evidence, duplicate_relation, direction_conflict, duplicate_step, broken_step, broken_flow); decision engine with dependency invalidation; revision-safe persistence; gated transactional immutable publish; new-version flow; student-safe serialization; audit trail; sessions/roles/rate limiting/CSRF-in-depth headers; magic-byte upload validation; caption correction preserving originals; evaluation scorer returning nulls; unit tests + e2e + axe reports; honest stage simulation labeling.

## 12. What is missing

1. **OCR** — `source: "textract"` exists in the schema but nothing produces it; uploads go straight to manual editor.
2. **AI proposal provider** — no real Bedrock call; `AnalysisProvider` seam exists.
3. **Live captions (Transcribe streaming)** — none; only loaded transcript/manual notes.
4. **TTS (Polly)** — none; browser `speechSynthesis` only, honestly labeled.
5. **Cloud auth (Cognito), cloud storage (S3), cloud DB (DynamoDB), orchestration (Step Functions), API layer (API Gateway/Lambda), observability (CloudWatch)** — none.
6. **Evaluation runs** — scorer exists, no measured run ("Not measured yet." is displayed, honestly).
7. **Local dev-DB hardening**: `node:sqlite` is fine for local but a real DB decision is needed for any shared deployment.
8. Multi-teacher / per-classroom tenancy, un-acknowledge, notification push (currently 5 s polling), audio asset storage/caching, schema-repair retry loop for model output, vocab export for Transcribe (format documented in AWS_VERIFICATION.md, generator not written).

## 13. What should be preserved (do not refactor away)

- `shared/domain.ts` trust pipeline and its exact semantics — tests encode them; the frontend depends on issue codes and stage naming.
- `shared/schema.ts` as the single contract; response re-validation in `src/api.ts`.
- Immutability triggers + conditional publish transaction.
- The `AnalysisProvider` failure-result (non-throwing) seam and `fallback: "manual_editor"` degradation.
- Honest simulation labeling (`simulation: true` stages, "Demo simulation" badge, `awsConnected: false`).
- Session hashing, teacher/student route split, `studentSerialize` as last line of defense.
- Evaluation "null until measured" rule and `source: "actual_run"` provenance marker.

## 14. What should be refactored

- `server/index.ts` is one 457-line module mixing routing, auth, rate limiting, static serving, error mapping. Extract route table/middleware before adding cloud providers (carefully — the frontend depends only on wire format, not file layout).
- `Store` re-parses full lesson JSON on every mutation (fine locally; reconsider under cloud DB with item-level records — the documented DynamoDB key design already anticipates this).
- Rate limiter is per-process in-memory (fine local; needs shared store when multi-instance).
- `body()` limit (7 MB) and `uploadSchema` max (6.7 MB base64) are magic numbers co-located with the 5 MB decoded cap; centralize when Textract limits are verified.
- Captions/questions store as opaque JSON rows; extracting queryable columns will be needed for teacher inbox scale (low priority).
- Note: `counters` map is bounded only when size > 1000 — acceptable locally, revisit in production.

## 15. Security problems found

| # | Severity | Finding |
|---|---|---|
| 1 | High (if ever deployed) | Single shared teacher password, unsalted SHA-256, no lockout beyond 20/min rate limit. Documented as dev-only; must be replaced before any non-local deployment. |
| 2 | Medium (local-only risk) | Student sessions are anonymous and unauthenticated beyond a cookie; any local user can obtain one. By design for classrooms, but no classroom join-code gating — anyone with the URL is "in". |
| 3 | Medium | No `Content-Security-Policy` header (only nosniff / no-referrer / X-Frame-Options). Fine offline; required before any hosting. |
| 4 | Low | Uploaded images served back without any re-encode/sanitization; magic-byte check is good but not a hostile-image defense (README admits this). |
| 5 | Low | Sessions have no rotation on privilege use and no absolute cap on concurrent sessions per code. |
| 6 | Low | `GET /api/images/:file` authorization relies on `publishedList()` which re-parses all lessons each request (also a perf smell, not just security). |
| 7 | Info | Rate limiting keyed by `req.socket.remoteAddress` is behind no proxy today; deploying behind ALB/CloudFront would let all clients share one bucket and make the limit wrong (must use forwarded-for + proxy trust). |
| 8 | Info | No TLS anywhere — loopback only, enforced by Host check. Any exposure breaks the security model. |

No secrets are committed: `.env` is gitignored, `.env.example` has placeholders, and the default dev password is documented as development-only.

## 16. Fake/mock functionality presented as real (honesty check)

The repo is unusually disciplined here. **Everything simulated is labeled**: fixture OCR/proposals are `simulation: true` with "Demo simulation" badges and code comments; README/docs explicitly say Textract/Bedrock/Polly/Transcribe are not connected; evaluation prints "Not measured yet." rather than fake numbers; CREDITS.md records generated-art provenance. Items to keep watching:

- `GET /api/health` returns `awsConnected: false` — good; ensure any future provider wiring flips this only when a real call succeeds, not at config time.
- The demo transcript (`shared/fixtures.ts`) is a *loaded transcript* — the Captions UI must keep saying that (it currently does).
- OCR confidence is `null` for fixture labels and stage detail says confidence is not measured — keep it that way until real Textract exists.

---

## Missing functionality → recommended implementation order

Rationale: keep every cloud step behind the existing seams; each phase ships behind a feature flag with the fallback path already in the code (manual editor, loaded transcript, browser speech).

1. **Backend hardening (local, no AWS)** — extract routing/middleware; centralize limits; add CSP; add integration tests for role isolation and question/version pinning; keep wire format unchanged.
2. **Provider configuration layer** — env-driven provider selection (`demo` | real), a `config.ts` that reads AWS region/keys from environment only, and a health endpoint that reports *verified* connectivity after a real call.
3. **Textract provider** — implement `source: "textract"` labels (text, confidence, geometry, preserved block ids) behind the upload route; on failure, return the existing `fallback: "manual_editor"` result. Requires the AWS_VERIFICATION.md items 3 + 8 first.
4. **Bedrock proposal provider** — implement `AnalysisProvider` with Converse structured output; validate with the existing deterministic validator; one schema-repair retry, then fallback model, then manual editor. Requires verification items 1, 2 + the grounding experiment before writing dependent code. **No model IDs until account-verified.**
5. **Shared vocabulary export** — generate the Transcribe custom-vocabulary table from approved terms per published version (format already documented), track readiness state.
6. **Polly audio** — synthesize approved descriptions per published version, cache audio files, expose via authenticated media route; text remains the fallback.
7. **Live captions** — Transcribe streaming with the versioned vocabulary; keep loaded-transcript path as the labeled fallback.
8. **Cloud migration** — Cognito (teacher/student roles, identity-pool scoped credentials for streaming only), S3 (private uploads + audio), DynamoDB (the documented single-table design + conditional publish transaction), API Gateway/Lambda packaging, Step Functions Standard workflow with stored task tokens for the teacher-approval wait.
9. **Observability** — structured logs/metrics/trace of pipeline executions (CloudWatch), evaluation harness against real runs; flip "Not measured yet." only with real runs.

## Risks

- **AWS capability risk (all UNVERIFIED):** no account, no region, no model entitlement, no quotas. Every AWS phase above has a hard gate at docs/AWS_VERIFICATION.md; nothing may be coded against guessed model IDs or quotas.
- **Wire-format risk:** the teammate's frontend re-validates responses with Zod; any change to response shapes breaks the UI at runtime. Cloud migration must preserve the exact contract (or be a coordinated, versioned change).
- **Trust-pipeline regression risk:** the validator semantics are load-bearing (tests + teacher workflow + student safety). Cloud providers must feed *into* `revalidate`/`decide`, never bypass.
- **Cost risk:** Textract/Bedrock/Polly/Transcribe are metered; COSTS.md requires a bounded estimate before any billable call; no always-on compute.
- **Local-only assumptions baked into security:** Host check, same-origin checks, in-memory rate limits, loopback binding — all need rework before any networked deployment.
- **node:sqlite experimental status:** acceptable locally; not a claim of production DB readiness (README says so).
- **Single-process:** publish/store are transactional per process; multi-instance deployment without DynamoDB conditional writes would break immutability guarantees.

## Dependencies

Runtime: Node ≥24 (`node:sqlite`), React 19, Vite 8, Zod 4, three.js (lazy), lucide-react, Fontsource fonts. Dev/test: tsx, TypeScript strict, Vitest 5, Playwright + @axe-core/playwright, prettier. Future (uninstalled, to be added only at their phase): `@aws-sdk/client-textract`, `@aws-sdk/client-bedrock-runtime`, `@aws-sdk/client-polly`, `@aws-sdk/client-transcribe-streaming`, `@aws-sdk/client-s3`, `@aws-sdk/client-dynamodb` / `lib-dynamodb`, `@aws-sdk/client-cognito-identity`, `@aws-sdk/client-sfn`, plus hosting/packaging tooling — versions and APIs UNVERIFIED until AWS setup begins.

## AWS dependencies (per PROMPT.md's target table — none currently integrated)

| Concern | Planned service | Status |
|---|---|---|
| Frontend hosting | Amplify Hosting or S3 + CloudFront | Not started |
| API | API Gateway (HTTP API) + Lambda | Not started |
| Files | S3 (private uploads, audio, transcripts) | Not started |
| OCR | Textract | Doc-reviewed only; quota discrepancy noted |
| Reasoning | Bedrock (Converse, image + structured output) | UNVERIFIED: no account/model |
| Orchestration | Step Functions Standard (task-token approval wait) | Doc-reviewed only |
| Data | DynamoDB (single-table, conditional publish) | Design-only keys documented |
| TTS | Polly (voice/engine/pricing per locale) | Doc-reviewed only |
| Live captions | Transcribe streaming + custom vocabulary | Doc-reviewed only |
| Auth | Cognito (teacher/student roles, scoped browser creds) | Doc-reviewed only |
| Observability | CloudWatch | Not started |

## Questions that must be verified before implementation

1. **AWS account/region**: which account, which region, are credentials available, and does `sts get-caller-identity` succeed? (Blocks everything AWS.)
2. **Bedrock**: which models are enabled and their exact model IDs/inference profiles; does the chosen model support image input + Converse structured output (and forced tool choice) for the grounding experiment? (docs/AWS_VERIFICATION.md §1–2)
3. **Textract**: synchronous API choice, real byte-size limit in region (5 vs 10 MB discrepancy), minimum text height, and whether target languages cover the teaching locale (Hindi OCR must not be assumed). (§3)
4. **Step Functions**: confirm Standard workflow + `.waitForTaskToken` callback in-region and quota; where tokens will be stored and who may resume. (§4)
5. **Polly**: target locale(s), available voices/engines, per-character price for the chosen engine, caching policy. (§5)
6. **Transcribe**: streaming support for `en-IN` (or chosen locale), custom-vocabulary attachment to streaming, vocabulary readiness latency. (§6)
7. **Cognito**: exact IAM action scoping for the browser streaming credential; positive/negative IAM tests before writing the policy. (§7)
8. **Deployment shape**: does the user actually want Amplify vs S3+CloudFront, and Lambda vs long-running container? Affects auth/Cognito choice and the rate-limit/DB refactor.
9. **Tenancy**: one teacher per deployment, or multiple teachers/classes? Decides classroom-code gating, DynamoDB partition design, and student session rules.
10. **Locales**: English only first, or Hindi/multilingual from the start? Blocks Textract/Transcribe/Polly selection and the validator's locale-specific normalization.
11. **Dataset**: confirm the 5–10 self-authored diagrams and who hand-verifies them (needed before any accuracy claim).
12. **Data retention**: how long are questions/captions/audit retained, and is deletion-on-request required? (Currently nothing expires except sessions.)
13. **Cost ceiling**: confirm the few-dollar demo budget in writing before any billable call (COSTS.md gate).

---

## Final summary

### A. What already exists

A complete, honest, local-only classroom application: React+Vite frontend (teammate's domain), one Node process serving the JSON API, SQLite storage with immutable-version triggers, cookie sessions with hashed tokens and anonymous student codes, full deterministic trust pipeline (validate → decide → gated immutable publish → student-safe serialization), audit trail, rate limiting and CSRF-in-depth, magic-byte upload validation, five labeled demo fixtures ("Demo simulation"), manual map editor fallback, loaded-transcript captions with teacher corrections preserving originals, contextual student questions pinned to versions, an evaluation scorer that returns nulls until a real run exists, unit + e2e + axe test suites, and disciplined documentation including an UNVERIFIED AWS register. **No AWS and no live AI anywhere — by explicit design, and nothing is disguised as real.**

### B. What needs to be built

Everything cloud-facing, behind existing seams: Textract label provider (`source: "textract"`), Bedrock analysis provider (Converse structured output + repair retry + fallback, feeding the existing validator), Transcribe streaming captions with approved-vocabulary tables, Polly audio for approved descriptions with caching, Cognito auth replacing the shared password, S3 replacing `.data/uploads`, DynamoDB replacing SQLite (documented single-table design + conditional publish), Step Functions orchestration with stored approval task tokens, API Gateway/Lambda packaging or an explicitly chosen alternative, CloudWatch observability, real evaluation runs, plus local hardening first (routing extraction, CSP, centralized limits, more integration tests).

### C. Recommended order of implementation

1. Local backend hardening (no contract changes) → 2. provider config/health layer → 3. AWS account + capability verification (docs/AWS_VERIFICATION.md gates, cost estimate) → 4. Textract provider with manual-editor fallback → 5. Bedrock grounding experiment, then proposal provider → 6. vocabulary export per published version → 7. Polly audio (text stays the fallback) → 8. Transcribe streaming (loaded transcript stays the labeled fallback) → 9. Cognito + S3 + DynamoDB + Step Functions migration preserving the exact wire contract → 10. observability + first real evaluation runs.

### D. Files expected to be created / changed

**Created (likely):**
- `server/config.ts` — env-driven provider/config layer, no secrets in code.
- `server/providers/textract.ts`, `server/providers/bedrock.ts`, `server/providers/polly.ts`, `server/providers/transcribe.ts` — real providers implementing/following `AnalysisProvider`'s non-throwing result pattern.
- `server/routes.ts` (or similar) — extracted route table/middleware from `server/index.ts`.
- `server/audio.ts` — Polly caching + authenticated media route.
- `server/vocabularyExport.ts` — Transcribe custom-vocabulary table generator per published version.
- `tests/providers.test.ts`, `tests/routes.test.ts` — provider fallbacks, role isolation, contract tests.
- `docs/` updates: `AWS_VERIFICATION.md` entries filled per verification, `COSTS.md` estimate, plus IaC directory (`infra/`) when cloud work is authorized.

**Changed (likely):**
- `server/index.ts` — decomposed into routes + providers; health reflects verified connectivity.
- `server/store.ts` — storage interface so DynamoDB can implement the same operations (conditional publish).
- `shared/schema.ts` — additive only: `source: "textract"` producers, vocabulary-export/readiness types, possibly provider-status on stages; never rename/remove existing fields (frontend re-validates).
- `.env.example` — AWS placeholders (region, feature flags) when that phase starts; secrets stay env-only.
- `package.json` — AWS SDK modular clients added per phase.

**Not touched:** all of `src/` except `src/api.ts` only if a versioned contract change is agreed with the frontend owner; UI components, styles, and story/3D layers are out of backend scope.
