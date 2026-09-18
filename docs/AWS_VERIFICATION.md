# AWS verification register

**Phase 1 decision (2026-09-18):** local server with the real AWS path enabled per request — Textract OCR + Bedrock analysis only. Full infrastructure deployment (Amplify/API Gateway/Lambda/Step Functions/Polly/Transcribe/DynamoDB/Cognito) remains deferred and is documented in docs/DEPLOYMENT.md. Account-specific access is still unproven: no credentials exist on this machine (AWS CLI absent, no `~/.aws`, no `AWS_*` variables), so no service has been invoked. A successful bounded upload through the app is the account verification step.

Checked: 2026-09-18 (documentation review, region/model selection). Target region: `ap-south-1` (Mumbai). Target model: Amazon Nova 2 Lite via the Global cross-region inference profile `global.amazon.nova-2-lite-v1:0` (Mumbai has no In-Region or Geo route for this model; Global is supported per the official model card).

## 1. Bedrock account access and exact model IDs

Selected model: **Amazon Nova 2 Lite**. The [official model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-2-lite.html) (checked 2026-09-18) documents:

- In-region model ID `amazon.nova-2-lite-v1:0`; **Global inference ID `global.amazon.nova-2-lite-v1:0`** — the ID to use when the client region is Mumbai.
- ap-south-1 (Mumbai) row: In-Region not offered, Geo not offered, Global supported.
- Multimodal input (text + image + video), 1M context, 64K max output, model lifecycle Active, launch 2025-12-02.
- Bedrock runtime endpoint + Converse API supported; prompt caching exists but is not used by our code path.

The [Bedrock regional availability page](https://docs.aws.amazon.com/bedrock/latest/userguide/models-region-compatibility.html) is the source of truth for re-checking these routes before deployment.

UNVERIFIED: this account may invoke the model — STS could not run because the AWS CLI is unavailable and no credentials were found on this machine; `aws sts get-caller-identity`, `aws bedrock list-inference-profiles --region ap-south-1`, and one bounded Converse call through the app would confirm access. The required least-privilege IAM policy (InvokeModel on the inference profile + foundation model, Textract DetectDocumentText only) is written out in docs/DEPLOYMENT.md.

## 2. Image input, schema output and forced tool choice

Nova 2 Lite accepts image input (PNG/JPEG) through Converse content blocks and supports tool use; the code path (`server/providers.ts` → `analyzeWithAws`) sends the diagram image plus the OCR label list and forces a single tool, `submit_diagram_map`, via `toolChoice`. Officially documented capability of the model family; see the [model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-2-lite.html) and Converse/tool-use documentation.

UNVERIFIED: forced tool choice returns a schema-valid proposal for real diagrams on this account — a bounded upload through the app is the confirming experiment. Per the trust model this does not matter for correctness: the proposal is parsed with zod, deterministically grounded against OCR labels (`groundProposal`), revalidated, and gated behind teacher approval; any model failure degrades to the manual map editor with the OCR labels retained.

## 3. Textract label extraction

Use [DetectDocumentText](https://docs.aws.amazon.com/textract/latest/APIReference/API_DetectDocumentText.html) for text extraction. Its Document input accepts Bytes or S3Object. Inspect LINE/WORD blocks for text, confidence and geometry; the mapping must preserve the source block IDs.

[Document](https://docs.aws.amazon.com/textract/latest/APIReference/API_Document.html) documents raw image bytes or an S3 object reference, with the bucket in the same region. AWS CLI does not support this operation's Bytes input; use S3 for a CLI experiment.

[Set quotas](https://docs.aws.amazon.com/textract/latest/dg/limits-document.html) states a 10 MB synchronous document limit, with PDF/TIFF restricted to one page, and minimum text height of 15 pixels. Printed-text languages include English, French, German, Italian, Portuguese and Spanish; handwriting is English only. Hindi OCR must not be claimed.

**Documentation discrepancy:** the Document field descriptions still state 5 MB, whereas the synchronous operation/limits pages state 10 MB and the Bytes length constraint is 10,485,760. Proposed conservative product policy: accept PNG/JPEG up to 5,000,000 bytes until tested. This is our planned limit, not a reconciled AWS quota claim.

[Textract pricing](https://aws.amazon.com/textract/pricing) (checked 2026-09-18) lists DetectDocumentText at USD 0.0015 per page for the first 1M pages/month (pricing example shown for US West (Oregon); confirm the Mumbai figure on the pricing page selector at deployment time). The free tier covers 1,000 DetectDocumentText pages/month for three months for new accounts — eligibility of this account is not assumed.

UNVERIFIED: Actual Textract access, regional throughput and boundary behavior — reviewed the official documentation but could not invoke the account — target-region query and a small real diagram extraction would confirm operation.

## 4. Human approval with Step Functions

[Integration patterns](https://docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource.html) documents callback task tokens for Standard workflows, not Express, including human approval waits bounded by the one-year execution limit. Pass the context Task.Token through a supported `.waitForTaskToken` integration. A backend resumes with [SendTaskSuccess](https://docs.aws.amazon.com/step-functions/latest/apireference/API_SendTaskSuccess.html) or SendTaskFailure.

Proposed design: deliver the token to a backend task that stores it privately with job/version identity; a teacher-authorized endpoint verifies all decisions before resuming. Never expose tokens to students, URLs or ordinary logs. Timeout, rejection, replay and expired-token behavior need tests.

UNVERIFIED: Deployed callback execution and regional quotas — no stack/account access — a real pause/resume test and applied-quota query would confirm them.

## 5. Polly voices, engines and price

Locale not selected. For possible Indian English scope, the [voice matrix](https://docs.aws.amazon.com/polly/latest/dg/available-voices.html) lists Aditi and Raveena for Standard, and Kajal for Neural and Generative. These are candidates, not an engine/voice choice or account-region assertion.

[Official pricing](https://aws.amazon.com/polly/pricing/) lists USD 4 per million Standard characters, 16 Neural, 100 Long-Form, and 30 Generative, outside free tier. See COSTS.md for a limited illustrative calculation; a full demo estimate is pending.

UNVERIFIED: Selected locale/voice/engine availability in the target region — consulted voice/pricing pages but locale and region are missing — DescribeVoices in the target region and a bounded synthesis request would confirm the chosen pair.

Code path (added 2026-09-18, `server/audio.ts`): `SynthesizeSpeech` with `Text`, `VoiceId`, `Engine`, `LanguageCode`, `OutputFormat: mp3`; field names checked against the installed `@aws-sdk/client-polly` type definitions, not against a live call. Off unless `SAHPAATH_POLLY_VOICE` is set. Runs once per published version after publish, cached by a hash of version + part + voice + exact approved text, stored in the private local data directory (S3 when deployed). Failures are recorded in the audit log and the explorer falls back to text/browser speech. Cache, idempotency and failure fallback are unit-tested with a stub synthesizer; **no real Polly request has been made**.

## 6. Transcribe streaming and vocabulary

[Language support](https://docs.aws.amazon.com/transcribe/latest/dg/supported-languages.html) lists Indian English (`en-IN`) streaming and custom vocabulary support. Final locale remains unspecified. [StartStreamTranscription](https://docs.aws.amazon.com/transcribe/latest/APIReference/API_streaming_StartStreamTranscription.html) accepts VocabularyName for a fixed-language stream; automatic language identification uses VocabularyNames. Vocabulary language must match; verify regional availability and vocabulary readiness before opening a stream.

[Vocabulary table specification](https://docs.aws.amazon.com/en_en/transcribe/latest/dg/custom-vocabulary-create-table.html): include all four headers, `Phrase`, `SoundsLike`, `IPA`, `DisplayAs`. Use tabs or commas consistently, retaining empty columns. Multiword Phrase entries use hyphens; DisplayAs permits spaces. SoundsLike and IPA are no longer supported and should remain empty. Plan a tab-separated plain-text file; the following notation is illustrative, with `[TAB]` replaced by actual tabs:

```text
Phrase[TAB]SoundsLike[TAB]IPA[TAB]DisplayAs
Pulmonary-artery[TAB][TAB][TAB]Pulmonary artery
```

[Custom vocabulary overview](https://docs.aws.amazon.com/en_en/transcribe/latest/dg/custom-vocabulary.html) requires the vocabulary and transcription to share a region. Provision only approved terms and track vocabulary readiness by published version.

UNVERIFIED: Streaming with the approved glossary in the target account/region — no credentials, locale or microphone experiment — successful vocabulary creation and a recorded real streaming test would confirm operation. Loaded transcript/manual notes remain the required labeled fallback.

## 7. Browser credentials and least privilege

[Cognito identity pools](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-identity.html) exchange federated identity for temporary AWS credentials. [User-pool integration](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-integrating-user-pools-with-identity-pools.html) supports obtaining these credentials after sign-in. [IAM role guidance](https://docs.aws.amazon.com/cognito/latest/developerguide/iam-roles.html) describes identity-pool trust restrictions.

Planned design: authenticated teacher role only for starting classroom transcription; no unauthenticated streaming role; browser credentials grant only the streaming action required by the selected transport. Upload, approval, vocabulary creation and other services remain behind the API.

UNVERIFIED: Exact browser-transport IAM action/resource scoping — the attempted Transcribe service-authorization page redirected to an empty index — resolve the current official action table, select the browser transport and run positive/negative IAM tests before writing the policy. No broad-permission browser policy has been created.

## 8. Quotas and rate limits

UNVERIFIED: Applied quotas for Bedrock, Textract, Step Functions, Polly, Transcribe and Cognito in the target region — account/region unavailable; public quota guidance reviewed — query applied account quotas and compare with the planned request/concurrency budget before deployment.

Sources checked: [AWS quota guidance](https://docs.aws.amazon.com/general/latest/gr/aws_service_limits.html), [Textract regional quotas](https://docs.aws.amazon.com/general/latest/gr/textract.html), [Polly regional quotas](https://docs.aws.amazon.com/en_en/general/latest/gr/pol.html). Defaults are not proof of the account's applied quota. Do not fill this register with guessed regional numbers.

Pending register for every service: operation, region, applied quota, adjustable status, requested concurrency/rate, throttling strategy, verification date and evidence. Bedrock additionally needs model/profile-specific token and request limits. Full verification is incomplete.

## Local AWS integration path (added 2026-09-18)

An env-gated real AWS path now exists for uploaded diagrams (`server/aws.ts`, `server/providers.ts`):

- Activation requires all of `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_BEDROCK_MODEL_ID` (optional `AWS_SESSION_TOKEN`). Any missing value keeps the manual-editor fallback; `/api/health` reports `awsConfigured` only, which is configuration presence, not a successful call.
- Static IAM credentials only. Bedrock API keys (`ABSK...`) are a different mechanism and are deliberately not wired here; they must not be pasted into the IAM key fields.
- Pipeline: Textract `DetectDocumentText` (LINE blocks, confidence, geometry) → Bedrock `Converse` with a forced `submit_diagram_map` tool → deterministic grounding in code (`groundProposal`): parts survive only with a matching OCR label, relations only between surviving parts, evidence attached from endpoint labels, flows only along forward relations. Everything else is dropped for the teacher to add by hand.
- Stages record real measured durations; failures degrade to the manual editor while keeping the real OCR labels. No retry loop beyond the single attempt; retries stay at 0 until implemented and measured.

UNVERIFIED: Any live call — no credentials on this machine, and the model ID must come from the account owner via `AWS_BEDROCK_MODEL_ID`; nothing is hardcoded or guessed. A single bounded diagram upload would confirm Textract access, model availability, tool-choice support and grounding quality. Run that experiment and record the raw result here before relying on this path. Estimate per-upload cost in COSTS.md (Textract ≈ 1 page + one model call) before enabling.
