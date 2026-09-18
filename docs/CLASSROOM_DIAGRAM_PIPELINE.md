# DiagramSense — feature prompt 3

Implemented against the numbered **“3. The BIG feature — DiagramSense pipeline”** prompt in the supplied ChatGPT report. The existing teacher review UI, local fixtures, immutable publications and student interfaces are preserved.

## Execution modes

- **Local (default):** authored sample proposals are explicitly simulated. Uploaded images use the manual editor. No AWS success is claimed.
- **Direct AWS:** the existing upload API runs Textract and Bedrock in the server process when region, credentials and an explicit model ID are configured. Storage remains local SQLite/files. This mode is not Step Functions.
- **Step Functions:** explicitly set `SAHPAATH_PIPELINE_MODE=step_functions` after deploying the supplied infrastructure. Upload → private S3 → Standard Step Functions → processing Lambda → Textract → OCR normalization → Bedrock Converse → deterministic validator → DynamoDB draft records/private S3 result → teacher review → existing explicit publication.

Step Functions runs one processing task; OCR, model parsing and validation are bounded substeps inside its Lambda. It does not publish. The state-machine input/output contains identifiers and status only, avoiding image/model payloads in execution history. No cloud resources have been deployed or invoked as part of implementation. Account/region/model support and actual cloud execution remain **UNVERIFIED**.

## Proposal and evidence contract

`server/diagram-pipeline.ts` defines the strict runtime schema and derives the model tool JSON schema from it:

```json
{
  "parts": [{
    "id": "part-heart", "name": "Heart", "ocrLabelId": "label-heart",
    "description": "Draft description for teacher review.",
    "descriptions": { "short": "Heart", "normal": "Normal draft.", "detailed": "Detailed draft." },
    "evidence": ["label-heart"]
  }],
  "relationships": [],
  "processFlow": [{ "order": 1, "partId": "part-heart" }]
}
```

Descriptions at three levels are optional; the existing `description` remains the normal UI contract. OCR labels retain stable IDs, text, normalized centers, full normalized bounding boxes and OCR confidence. Model confidence is separate and nullable. OCR LINE labels without valid geometry are omitted; normalization caps labels at 100. Parts are capped at 60, relationships at 120 and flow steps at 60.

The model receives the original image and serialized OCR labels including IDs and geometry. Source content is treated as data, not instructions. It must return exactly one `submit_diagram_map` tool call. Unknown fields, approval states, text-only responses, truncated output and malformed schemas are rejected. Malformed responses get **one** additional model request. Permission/network errors do not trigger another request. SDK automatic retries for OCR/inference are disabled; calls have explicit 60-second OCR / 120-second model timeouts.

Unknown OCR IDs, dangling references, bad evidence, duplicates and broken flows remain visible as deterministic validation issues. Nothing silently substitutes OCR IDs, creates evidence or removes a broken intermediate flow step. Process orders must be contiguous and begin at 1. Validation errors block teacher approval/publication via the existing backend domain logic. Warnings require explicit teacher decisions. `ok: true` means a structured proposal was parsed, **not** that it is valid or approved; `valid` and `issues` report validation separately.

OCR success survives subsequent model failure. The fallback retains source labels for manual editing and attributes failure to the correct stage. Safe error messages exclude raw provider responses. Stage durations and actual malformed-output retry counts are returned. No accuracy figures are fabricated.

## Existing UI/API integration

- `POST /api/upload`: existing authenticated teacher PNG/JPEG + license contract, maximum 5,000,000 bytes. In cloud mode, saves a local preview, uploads the image privately, creates a job and starts processing. Returns the existing Lesson shape with waiting stages.
- `GET /api/lessons/{lessonId}/processing-status`: teacher authentication required. Polls persisted results and the execution status, imports the result into the local draft once, and returns the Lesson shape. Concurrent polls use the existing SQLite revision guard. Errors/timeouts produce a manual-editor fallback. The existing teacher component polls while its selected lesson is processing.
- Map edits, decisions, new versions and publication return HTTP 409 while processing is active.
- Cloud-imported maps have decisions reset and are validated again. Student endpoints still serve only immutable teacher-published versions.

The local API remains the classroom/teacher-review host. This feature supplies cloud **processing**, not a migration of the entire app, authentication or published-version store to AWS. Do not expose the development teacher login publicly. The processing Lambda cannot publish. A failed start returns a safe 502; a partially written source/job may remain in private storage for operator cleanup.

## Persistence and operational behavior

The DynamoDB table has a string hash key `jobId`:

- `{jobId}`: lesson binding, queued/processing/needs_review/failed status, result key, retry count and validation outcome.
- `{jobId}#{labels|parts|relations|flows}#{index}`: individual structured values. An index rather than the proposed ID prevents invalid duplicate IDs from overwriting evidence.

Source images and complete results live in private encrypted S3. Results include labels, map, validation issues, durations and retry count. Large documents never enter DynamoDB items or Step Functions payloads. Completion uses a conditional write; cached completed invocations skip inference. A conditional queued→processing claim prevents concurrent inference for one job. A worker interruption produces a terminal workflow failure; restart by creating a new upload/job, not by blindly replaying a claimed job. Teacher polling detects workflow timeouts even if Lambda could not persist an error.

The template retains S3/DynamoDB resources on stack deletion. Establish a retention/cleanup policy before use with real classroom data. Lambda logs only event name, job ID, status and retries; it does not log image bytes, OCR text, model output or credentials.

## Build and deployment

1. Run `npm run build:pipeline` to produce `.pipeline-build/index.cjs` (bundled dependencies, Node 22 target).
2. Install/configure AWS SAM CLI separately. Validate `infra/diagram-pipeline.json` using `sam validate --lint --template-file infra/diagram-pipeline.json`.
3. Package/deploy with SAM: `sam deploy --guided --template-file infra/diagram-pipeline.json`. This creates billable resources; it has **not** been run here.
4. Supply `BedrockModelId` and `BedrockResourceArns`. There is deliberately no model default. Verify image inputs, Converse tool use and forced tool selection in the chosen region/account. Cross-region profiles need permissions for the profile and destination model ARNs.
5. Copy the stack Bucket, Table and StateMachineArn outputs into the variables in `.env.example`; set `AWS_REGION` and cloud mode explicitly. The worker uses its IAM execution role. The API uses the normal SDK credential chain (environment credentials or an attached role).
6. Grant the API principal `s3:PutObject` on `diagrams/*`, `s3:GetObject` on `results/*`, `dynamodb:GetItem`/`PutItem` on this table, `states:StartExecution` on this state machine and `states:DescribeExecution` on its execution ARN prefix. The worker policies are in the template; Textract DetectDocumentText requires the service-level `*` resource, while model access is parameter-scoped.
7. Upload a licensed test image. Confirm the real execution, OCR geometry, bounded retry count, persisted findings, teacher review and publication guard. Record measured outcomes separately. SAM deployment validation and this live smoke test remain **UNVERIFIED**.

The app accepts PNG/JPEG up to 5 MB. A configured Bedrock model can impose a lower image limit; such rejection preserves OCR and falls back honestly. This implementation does not claim universal model compatibility.

## Verification

Deterministic tests cover grounding, evidence, confidence separation, invalid flows, malformed output, retries, provider failures and geometry. Mocked SDK tests cover private upload, identifier-only execution payloads, lesson/result binding, terminal failures, revalidation on import, structured persistence and replay behavior. These are local tests, not evidence of live AWS success.

Local verification on 2026-09-18: 70 unit tests passed; type checking, frontend build and Lambda bundle passed; three focused browser regressions passed (teacher review/publication, API security, manual upload fallback). Browser tests used a fresh `.data/e2e-feature3-20260918` database because older reused test records lacked required license metadata. `SAHPAATH_E2E_DATA_DIR` now permits an isolated test database, and browser tests explicitly disable cloud inference. SAM CLI was unavailable, so SAM lint and deployment validation were not run.

Official references checked during implementation:

- [Textract DetectDocumentText](https://docs.aws.amazon.com/textract/latest/APIReference/API_DetectDocumentText.html)
- [Step Functions Lambda integration](https://docs.aws.amazon.com/step-functions/latest/dg/connect-lambda.html)
- [Bedrock Converse documentation entry](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference-call.html)
