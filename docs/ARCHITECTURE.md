# Architecture

## Local implementation

React + strict TypeScript + Vite serve the interface. A Node HTTP server owns authentication, schema validation, uploads, review decisions, publication, captions, questions, and auditing. Zod schemas derive the shared TypeScript types. Node's built-in SQLite module is currently experimental; no claim of production database readiness is made.

The dependency direction is `UI → JSON API → domain rules → SQLite`. `shared/domain.ts` contains deterministic map validation and publication rules; `server/providers.ts` provides explicit simulation/manual fallbacks. The browser receives fixture names but not the private draft fixture content. Source maps are not a security boundary; API authorization and publication serialization are.

## Trust and publication

Proposed items become validated or need review. Unknown label references, invalid graph references, and structurally broken flow steps cannot be approved. Warnings such as manually entered labels, low confidence, or orphan parts require a review note. Every item must receive a teacher decision before publication. Rejected items are excluded; dependencies must still be valid.

Any map edit resets review decisions. Publication revalidates, filters to approved content, derives the canonical vocabulary, then stores an immutable snapshot in a transaction. A revision condition rejects stale mutations. Unique `(lesson_id, version)` keys prevent duplicate publications; SQLite triggers reject updates and deletes of published rows. New versions preserve old snapshots. The student serializer checks approval states and reconstructs vocabulary from the approved parts.

Canonical part IDs join diagram nodes, glossary entries, caption highlights/corrections, browser speech descriptions, and contextual questions. Cloud speech-recognition vocabulary is deferred. Student questions include the publication version so later edits do not silently move their anchor.

## Persistence and security

Tables: lessons, versions, sessions, audit, captions, and questions. Images live in private `.data/uploads`, not database blobs. Session tokens are stored as hashes; the browser cookie is HttpOnly and SameSite=Strict. Teacher and anonymous student routes are separated. Host checks restrict the server to local access, mutations reject cross-origin requests, and request/login/question rates are bounded.

PNG/JPEG uploads have a 5 MiB file cap, an allowed MIME list, and signature checks. This is not a complete hostile-image decoder or malware scanner. Production needs a hardened image normalization pipeline. Development file serving denies private data, server files, environment files, and draft fixtures. Runtime data is excluded from the development file watcher to prevent uploads from resetting unsaved editor state.

The local password is a development convenience. No Cognito, TLS deployment, organization tenancy, durable distributed throttling, retention automation, or cross-device classroom access is implemented. Do not expose this server publicly.

## Pipeline evidence

Local stages record local execution identifiers, state, retry count and measured local duration where applicable. Simulation stages are labeled. These are not AWS execution history or CloudWatch records. Uploaded diagrams bypass unavailable OCR/model services and proceed to manual authoring. Text remains usable if browser speech is unavailable. Loaded transcripts and manual notes remain usable without recognition services.

## Deferred AWS migration

Keep the domain rules independent of storage/providers. Replace local authentication with Cognito roles, private file storage with S3, the store with conditional DynamoDB transactions, and provider boundaries with verified Textract/Bedrock/Polly/Transcribe integrations. Standard Step Functions would orchestrate review callbacks after account and capability verification. No cloud resources or deployment templates are represented as operational.

Proposed DynamoDB keys (design only): `PK=LESSON#id`, `SK=META`; `SK=DRAFT#version`; immutable `SK=VERSION#version`; `SK=APPROVAL#version#item`; `SK=AUDIT#timestamp#id`; `SK=QUESTION#id`; `SK=CAPTION#session#segment`. A publish transaction conditionally creates the version and updates the lesson pointer only if the revision matches. Store S3 object keys rather than large file payloads. Query authorization must precede access to these partitions. TTL/session, classroom membership, tenant boundaries and indexes require design before cloud implementation.
