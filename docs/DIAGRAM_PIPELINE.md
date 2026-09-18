# DiagramSense — diagram processing pipeline

Status: **implemented in-process; Step Functions layout designed, deployment UNVERIFIED.**
No model ids are hardcoded. No accuracy metrics are claimed anywhere.

The pipeline turns one uploaded diagram into a **structured accessibility map** —
OCR labels with coordinates and confidence, semantic parts, relationships, a
process flow, and three-level description drafts — under the project's trust
principle: *AI proposes → deterministic code validates → teacher approves →
student uses*. The model never writes trusted content directly and never publishes.

## Flow

```
Upload (presigned POST)
   |
   v
S3 (private) ....................... local adapter: .data/uploads
   |
   v
Step Functions (cloud layout) ...... in-process orchestrator (implemented)
   |
   v
Textract: text + boxes + confidence  [SAHPAATH_TEXTRACT_ENABLED=1]
   |
   v
OCR normalization (deterministic)
   |
   v
Bedrock multimodal model            [SAHPAATH_BEDROCK_ENABLED=1 + MODEL_ID]
   |   input:  image bytes + OCR label list with ids
   |   output: structured JSON proposal (schema-validated, retry once)
   v
Deterministic TypeScript validator
   |
   v
Draft version (ai_proposed items)
   |
   v
Teacher review -> Publish  (existing decision/publish endpoints)
```

In the cloud layout, the Step Functions state machine would orchestrate
Textract → normalization → Bedrock → validator, writing the job record the API
already serves via `GET /diagrams/{id}/processing-status`. The state machine is
**not deployed**; the in-process orchestrator runs the identical stage sequence
and records identical job shapes, so the swap is an infrastructure change, not a
contract change. Deploying it requires an authenticated AWS account — UNVERIFIED.

## Stage 1 — OCR (Textract)

Adapter: `server/providers/textract.ts` (`TextractAdapter`, `DetectDocumentText`).

Extracts per LINE block: `text`, `Confidence` (0..100), bounding box. Failures
surface as real errors — the job stage is recorded `failed` with the AWS error
message; nothing is simulated.

### Deterministic normalization (`normalizeOcr`)

- LINE detections → canonical `OcrLabel` records (`shared/proposal.ts`)
- deduplication, whitespace trimming, confidence clamped/rounded
- coordinates: bounding-box center, normalized 0..1, origin **top-left**
- **ids are assigned in geometric reading order** (row bands of 10% image
  height, then left→right) — the same image always yields the same label ids
- capped at 100 labels

## Stage 2 — Proposal (Bedrock)

Adapter: `server/providers/bedrock.ts` (`BedrockProposalAdapter`, `InvokeModel`).

**Model id comes only from configuration** (`SAHPAATH_BEDROCK_MODEL_ID`) —
never hardcoded, no guessed ARNs or inference profiles. The exact multimodal
input/response behavior of any configured model is **UNVERIFIED** until
validated against the real account; invoke failures surface as errors, not fakes.

**Input:** the original image (base64) + the normalized OCR label list, each
with `id`, exact `text`, `confidence`, normalized `position`, plus the lesson
title. The prompt (`buildProposalPrompt`, version-tagged `diagramsense-v1`)
contains the grounding contract:

1. every part MUST use the `ocrLabelId` of a supplied label — inventing ids or
   text is rejected automatically
2. `name` must be the exact OCR text (no paraphrasing)
3. relationships only between defined parts, evidence = both endpoints' labels
4. `processFlow` = meaningful reading order, each part at most once
5. three description levels: `description` (~1 sentence), `descriptionShort`
   (≤8 words), `descriptionDetailed` (2–4 sentences with location + function)
6. JSON-only answer in the documented shape

**Response parsing** (`parseProposalText`): fence-tolerant JSON extraction,
then `diagramProposalSchema` (Zod, strict). **Malformed output is retried
exactly once** (parse failures only); a second failure is terminal and honest
(`job.status = "failed"` with the real error). Invoke failures are not retried.

## Stage 3 — Conversion + grounding enforcement

`server/services/pipeline-structure.ts` (`proposalToStructure`, pure):

- model part ids are **never trusted** — parts are remapped to
  `part-<ocrLabelId>` derived from the referenced label
- **unknown `ocrLabelId` → part dropped with a recorded `unknown_label` error**
  (the model cannot invent content; the rest of a partially-grounded proposal
  still converts, flagged for the teacher)
- relationship evidence must include both endpoints' labels
  (`incomplete_evidence` otherwise)
- flow steps must resolve to grounded parts (`broken_step`), duplicates
  rejected (`duplicate_step`); a flow needs ≥2 valid steps
- name drift vs OCR text is a **warning**; OCR text stays authoritative
- re-runs skip labels already present/used, so re-running never duplicates

## Stage 4 — Deterministic validation

`server/services/validation.ts` (unchanged semantics, now fed by the pipeline).
All 10+ issue codes apply (unknown_label, missing/unknown/incomplete evidence,
dangling, self_relation, duplicate_relation, broken_step, broken_flow, …).
Errors block teacher approval; warnings require a review note. This stage also
gained a fix: flow steps referencing missing parts are now flagged
(`broken_step`) instead of silently skipped.

## Stage 5 — Draft + teacher review

The validated structure is written into the diagram's **draft version** with
every item `ai_proposed` (`processingStatus: "awaiting_review"`). Approval,
rejection, dependency invalidation, and the gated transactional publish are the
existing endpoints (`POST /diagrams/{id}/decision`, `POST /diagrams/{id}/publish`)
— the pipeline cannot publish.

## Configuration

| Variable | Effect |
|---|---|
| `SAHPAATH_BEDROCK_MODEL_ID` | Model id passed to InvokeModel verbatim. No default. |
| `SAHPAATH_BEDROCK_ENABLED` | `1`/`true` to enable the real proposal call. |
| `SAHPAATH_TEXTRACT_ENABLED` | `1`/`true` to enable real OCR. |
| `AWS_REGION` | Region for both clients. |

Without the enable flags the pipeline runs with **no providers**: OCR returns
zero labels, the proposal stage records `fallback` with `simulation: true` and
an honest detail message, and the job ends `failed` — never faked as success.

## Observability

- `processing_started` / `pipeline_completed` audit events (actor, lesson, counts)
- structured logs: `pipeline.completed` (labels/parts/blocking/totalMs),
  `pipeline.failed`, `pipeline.retry_malformed`
- job record with per-stage `status`/`simulation`/`detail`/`durationMs`, served
  by `GET /api/v1/diagrams/{id}/processing-status`

## Tests

`tests/diagram-pipeline.test.ts` — deterministic fixtures, no network:
OCR id-stability/normalization, proposal schema/parser (fence, invalid,
retry), prompt grounding contract, conversion grounding enforcement
(unknown label, incomplete evidence, broken/duplicate flow steps, name drift,
re-run idempotency), and service-level runs with fake providers (success,
OCR failure, fallback honesty, retry-once, double-parse failure, duplicate
processing).
