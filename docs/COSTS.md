# Cost guardrails

Date: 2026-09-18. No AWS resources created or successful AWS API calls. AWS is deferred at the user's request. Higgsfield artwork spending is recorded below. This is an action record, not a statement about the user's external account bill.

## Release gate

The complete demo estimate is **not yet computed**: account region, model, teaching locale and dataset size are unresolved. Do not make billable calls or deploy infrastructure until the estimate is completed from current official pricing and stays within the user's few-dollar limit. Ask before work that could exceed that limit. Do not assume free-tier eligibility or available AWS credits.

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
