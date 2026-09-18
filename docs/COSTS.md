# Cost guardrails

Date: 2026-09-18. No AWS resources created or successful AWS API calls (no credentials on this machine; see docs/DEPLOYMENT.md). Higgsfield artwork spending is recorded below. This is an action record, not a statement about the user's external account bill.

## Release gate

**Phase 1 estimate (Textract + Bedrock only, per-call, no fixed infrastructure): computed below and inside the few-dollar limit.** Deployment may proceed once credentials are supplied and the user accepts this gate. Phase 2 (standing infrastructure) has no estimate yet and must not be created without a new gate. Do not assume free-tier eligibility or available AWS credits.

## Phase 1 demo estimate (2026-09-18)

Unit prices, sources checked 2026-09-18:

| Unit | Price | Source |
|---|---|---|
| Textract DetectDocumentText | $0.0015 / page (first 1M pages/month) | [Textract pricing](https://aws.amazon.com/textract/pricing) |
| Nova 2 Lite input tokens | $0.33 / 1M | [Amazon Nova pricing](https://aws.amazon.com/nova/pricing) |
| Nova 2 Lite output tokens | $2.75 / 1M | [Amazon Nova pricing](https://aws.amazon.com/nova/pricing) |
| Mumbai regional rates | Verify on the pricing-page region selector at deploy time | Same pages |

Per uploaded diagram (one Textract page + one Converse call; the code makes exactly these two calls per upload, no retry loop):

- Typical (~2,500 input tokens incl. image, ~1,500 output tokens):
  `0.0015 + 2500/1,000,000 × 0.33 + 1500/1,000,000 × 2.75 = 0.0015 + 0.00083 + 0.00413 ≈ $0.0065`
- Worst case (~10,000 input, ~4,000 output): `0.0015 + 0.0033 + 0.011 = $0.0158`

Runs:

| Run | Diagrams | Typical | Worst case |
|---|---|---|---|
| Single verification upload | 1 | $0.007 | $0.016 |
| Hackathon demo run | 100 | $0.65 | $1.58 |
| Extended pilot | 500 | $3.25 | $7.90 — requires explicit approval first |

Everything else in Phase 1 costs $0: no S3, DynamoDB, Lambda, API Gateway, Step Functions, Polly, Transcribe, Cognito or CloudWatch usage — none are created or called. Fixture lessons and the manual editor make no network calls. Tax and regional price variation are excluded; a brand-new account may instead be covered by the Textract free tier (1,000 pages/month for 3 months), which is not assumed.

Cleanup: no standing resources; delete the IAM access key when finished (docs/DEPLOYMENT.md).

## Documented pricing and illustrative arithmetic

[Amazon Polly pricing](https://aws.amazon.com/polly/pricing/), checked 2026-09-18, lists Standard USD 4 per million characters and Neural USD 16 per million characters, outside free tier.

For a hypothetical 5,000-character synthesis, Standard would be `5,000 / 1,000,000 * 4 = USD 0.02`; Neural would be `5,000 / 1,000,000 * 16 = USD 0.08`. These are illustrative synthesis charges, not measured usage, the full demo estimate or a selected engine. Storage, transfer, other services and taxes are excluded. Speech marks may add billable requests. Cached playback avoids repeated synthesis charges, but hosting/transfer still needs budgeting.

## Required estimate before experiment/deployment

Record region, unit prices, source/date, quantities, arithmetic, retries and worst-case total for:

- Textract page count, including bounded retries.
- Bedrock image/text input tokens and capped output tokens, one repair attempt and a verified fallback model.
- Step Functions transitions, including retries and review resumption.
- Lambda duration/memory and API requests.
- DynamoDB on-demand reads/writes and storage.
- Private S3 requests/storage and transfer; frontend hosting/CloudFront.
- Polly characters per published version and engine.
- Transcribe stream duration, minimum billing interval and concurrent sessions.
- Cognito usage and CloudWatch logs/retention.

Use request caps, finite timeouts, bounded retries, log retention and explicit cleanup instructions. Budget alerts alone do not cap spending. Do not introduce always-on compute or provisioned capacity.

## Higgsfield

Current ledger, 2026-09-18: live balance **553.5 credits**, down **44 credits** from the initial observed 597.5. Initial classroom still 1; clay still 1; two rejected Mini clips 15 each; architectural still 4; two natural-room stills 4 each. The old 111-credit chain plan below is cancelled. No charge during reference research; further generation awaits a concrete visual direction. AWS remains deferred.

- User-reported remaining balance/maximum available budget: **598 credits**.
- Initial live balance: **597.5 credits**. Classroom artwork cost 1 credit; balance before the scroll-world sequence: **596.5 credits**.
- Live preflight: `gpt_image_2_5` image 1 credit; `seedance_2_0_mini` six-second 720p clip 15 credits; `seedance_2_0` six-second standard 1080p clip 54 credits. These are connected-tool estimates, not historical skill prices.
- Following the user's instruction to continue, the recommended calm isometric desktop 720p chain is selected. Phones use stills; a separate portrait chain is not ordered. Six clips plus at most six stills estimate 96 credits, with a **111-credit ceiling including retries**. The sequential chain reuses extracted last frames and may need fewer generated stills. No Monid paid service is used.
- The first scroll-world image job was submitted at 1 credit. Final actual spending and balance will be recorded after rendering; do not infer usage from estimates.
- Before generation: inspect actual available capability and price, record a bounded asset plan, reserve credits for necessary revisions, and do not exceed the verified remaining balance or the user's 598-credit ceiling.
- No educational facts or fake UI screenshots may be generated. Record every generated asset in CREDITS.md.

## Higgsfield spend, 2026-09-18 (Claude Code session)

Balances read from `higgsfield workspace list`, not estimated.

| Step | Credits | Outcome |
|---|---|---|
| 2 test stills (GPT Image 2 2K, Nano Banana Pro 4K) | 10.5 | Architectural miniature style; rejected by the user as off-context |
| 4 style-locked scene stills (GPT Image 2 2K) | 26 | Same; rejected |
| 5 dive clips, Kling 3.0 **4K** mode, 5 s each | 150 | Rejected: scenes did not show the product. 4K was unnecessary (1080p "pro" mode is 8.75 credits) |
| 5 student scene stills (GPT Image 2 2K medium) | 10 | Rejected: user wants the product's teaching power shown, not students' disabilities |
| **Total** | **196.5** | 549.5 → 353 |

None of these assets ship. The landing story (`src/DiagramStory.tsx`) is built in code from the heart demo fixture and uses no generated imagery.

## Local AWS code path, 2026-09-18

SDK clients (`@aws-sdk/client-textract`, `@aws-sdk/client-bedrock-runtime`) were installed and the env-gated upload pipeline wired. **No AWS call has been made; nothing was spent.** The path stays dormant without `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `AWS_BEDROCK_MODEL_ID`. Per upload if enabled: 1 Textract DetectDocumentText page (≈ USD 0.0015 first 1M pages/month, regional pricing unconfirmed) plus one Bedrock Converse call (model-dependent token cost; single forced-tool attempt, no retries). Before first real use, compute the demo-run total from the account's region pricing and confirm the model's token rates; anything beyond a few dollars stops for approval.
