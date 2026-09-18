# AWS verification register

**Local-first override:** The user requested setup without AWS and will configure it later. No AWS services are integrated or deployed in this local build. This documentation review does not establish account access, model availability, quota allocation, or successful API execution. Resume account-specific verification and the grounding experiment before cloud implementation.

Checked: 2026-09-18. **Preliminary documentation review only. Not account verification.**

Target region, account, profile and locale are not configured. No service was invoked. See PREFLIGHT.md for actual local diagnostics. No model IDs have been selected or guessed.

## 1. Bedrock account access and exact model IDs

UNVERIFIED: Enabled models and inference profiles in the target account/region — STS could not run because the AWS CLI is unavailable, and no standard credentials or region were found — authenticated account queries and a bounded successful invocation would confirm access.

The [model catalog](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards.html) is documentation, not evidence of account entitlement. [GetFoundationModelAvailability](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_GetFoundationModelAvailability.html) provides model availability details to inspect after authentication. Record returned model/profile identifiers, authorization, entitlement and regional status before selecting a model.

## 2. Image input, schema output and forced tool choice

UNVERIFIED: The selected model supports image input, Converse, structured output and forced tool choice — consulted the [model compatibility entry point](https://docs.aws.amazon.com/bedrock/latest/userguide/models.html), but no account-enabled model can yet be selected — exact model documentation plus a successful grounded-image experiment would confirm the required combination.

Do not equate tool support with guaranteed schema compliance or forced choice. Deterministic validation is required even when a model offers structured output. No dependent code is written.

## 3. Textract label extraction

Use [DetectDocumentText](https://docs.aws.amazon.com/textract/latest/APIReference/API_DetectDocumentText.html) for text extraction. Its Document input accepts Bytes or S3Object. Inspect LINE/WORD blocks for text, confidence and geometry; the mapping must preserve the source block IDs.

[Document](https://docs.aws.amazon.com/textract/latest/APIReference/API_Document.html) documents raw image bytes or an S3 object reference, with the bucket in the same region. AWS CLI does not support this operation's Bytes input; use S3 for a CLI experiment.

[Set quotas](https://docs.aws.amazon.com/textract/latest/dg/limits-document.html) states a 10 MB synchronous document limit, with PDF/TIFF restricted to one page, and minimum text height of 15 pixels. Printed-text languages include English, French, German, Italian, Portuguese and Spanish; handwriting is English only. Hindi OCR must not be claimed.

**Documentation discrepancy:** the Document field descriptions still state 5 MB, whereas the synchronous operation/limits pages state 10 MB and the Bytes length constraint is 10,485,760. Proposed conservative product policy: accept PNG/JPEG up to 5,000,000 bytes until tested. This is our planned limit, not a reconciled AWS quota claim.

UNVERIFIED: Actual Textract access, regional throughput and boundary behavior — reviewed the official documentation but could not invoke the account — target-region query and a small real diagram extraction would confirm operation.

## 4. Human approval with Step Functions

[Integration patterns](https://docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource.html) documents callback task tokens for Standard workflows, not Express, including human approval waits bounded by the one-year execution limit. Pass the context Task.Token through a supported `.waitForTaskToken` integration. A backend resumes with [SendTaskSuccess](https://docs.aws.amazon.com/step-functions/latest/apireference/API_SendTaskSuccess.html) or SendTaskFailure.

Proposed design: deliver the token to a backend task that stores it privately with job/version identity; a teacher-authorized endpoint verifies all decisions before resuming. Never expose tokens to students, URLs or ordinary logs. Timeout, rejection, replay and expired-token behavior need tests.

UNVERIFIED: Deployed callback execution and regional quotas — no stack/account access — a real pause/resume test and applied-quota query would confirm them.

## 5. Polly voices, engines and price

Locale not selected. For possible Indian English scope, the [voice matrix](https://docs.aws.amazon.com/polly/latest/dg/available-voices.html) lists Aditi and Raveena for Standard, and Kajal for Neural and Generative. These are candidates, not an engine/voice choice or account-region assertion.

[Official pricing](https://aws.amazon.com/polly/pricing/) lists USD 4 per million Standard characters, 16 Neural, 100 Long-Form, and 30 Generative, outside free tier. See COSTS.md for a limited illustrative calculation; a full demo estimate is pending.

UNVERIFIED: Selected locale/voice/engine availability in the target region — consulted voice/pricing pages but locale and region are missing — DescribeVoices in the target region and a bounded synthesis request would confirm the chosen pair.

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
