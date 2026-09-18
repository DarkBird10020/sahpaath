# AWS deployment runbook

Feature 14 output. Date: 2026-09-18. Status: **prepared, not deployed** — no AWS
credentials exist on this machine (`~/.aws` absent, no `AWS_*` environment
variables, AWS CLI not installed), so nothing billable has been run and no AWS
resource exists. This document is the exact path to a real, verified, bounded
deployment. Per the build contract, deployment stops until credentials are
supplied and the cost gate below is accepted.

## Deployment phases

- **Phase 1 (this runbook): real Textract + Bedrock behind the existing local
  server.** No AWS infrastructure is created. The already-implemented code path
  (`server/providers.ts` → `analyzeWithAws`) activates for genuine PNG/JPEG
  diagram uploads when four environment variables are set. Fixtures and the
  manual map editor keep working exactly as before; every AWS failure degrades
  to the manual editor with the real OCR labels retained.
- **Phase 2 (not started, not faked): full serverless stack** — API Gateway +
  Lambda + DynamoDB + S3 + Step Functions + Cognito + CloudFront. The current
  backend is a loopback-bound Node server with SQLite storage; porting it to
  Lambda/DynamoDB is the remaining backend work (features 1–3 of the backend
  plan). No placeholder infrastructure for Phase 2 is committed to this repo.

Phase 1 is the honest scope for the hackathon: AWS services are genuinely
invoked per request, per-call billed only, zero fixed cost, zero cleanup
burden.

## Region and model decision

| Item | Value | Source |
|---|---|---|
| Region | `ap-south-1` (Mumbai) | User is in India; Textract runs in-region; Bedrock is reached through a cross-region profile |
| Model | Amazon Nova 2 Lite | Official model card |
| In-region model ID | `amazon.nova-2-lite-v1:0` | [Model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-2-lite.html) |
| **Model ID to use from Mumbai** | `global.amazon.nova-2-lite-v1:0` (Global cross-region inference profile) | Same model card; Mumbai has no In-Region or Geo route for this model, Global is supported |
| Multimodal input | Text + image (PNG/JPEG) + video; 1M context, 64K max output | Same model card |
| API | Converse with `toolConfig` (tool use supported); deterministic grounding still validates everything | Model card + Converse docs |
| OCR | Textract `DetectDocumentText` (synchronous, image bytes, LINE/WORD blocks) | [API reference](https://docs.aws.amazon.com/textract/latest/APIReference/API_DetectDocumentText.html) |

Account-level entitlement (whether this IAM user may invoke this model) can
only be proven by a real call — see the verification steps below.

## Step-by-step

### 0. Install the AWS CLI (this machine does not have it)

Download and run the official Windows MSI:
`https://awscli.amazonaws.com/AWSCLIV2.msi`, then confirm with
`aws --version`. (winget is unavailable on this machine; the MSI is the
supported path.)

### 1. IAM policy for the SahPaath demo user (least privilege)

Attach this to the IAM user whose access keys are used. It allows exactly the
two calls the code makes and nothing else. Replace `123456789012` with the
account ID (visible in `aws sts get-caller-identity`).

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "TextractLabelOcrOnly",
      "Effect": "Allow",
      "Action": "textract:DetectDocumentText",
      "Resource": "*"
    },
    {
      "Sid": "BedrockNova2LiteOnly",
      "Effect": "Allow",
      "Action": "bedrock:InvokeModel",
      "Resource": [
        "arn:aws:bedrock:ap-south-1:123456789012:inference-profile/global.amazon.nova-2-lite-v1:0",
        "arn:aws:bedrock:*:::foundation-model/amazon.nova-2-lite-v1:0"
      ]
    }
  ]
}
```

UNVERIFIED: the exact inference-profile ARN form your account reports — after
step 2, run `aws bedrock list-inference-profiles --region ap-south-1` and copy
the printed ARN into the policy if it differs. Cross-region invocation needs
`InvokeModel` on both the profile (source region, your account) and the
foundation model.

The earlier "Operation not allowed" / "model not running" errors from the AWS
setup session match a missing policy like this one: a brand-new IAM user has no
Bedrock permissions by default.

### 2. Configure credentials and verify identity

```powershell
aws sts get-caller-identity
aws bedrock list-inference-profiles --region ap-south-1 --query "inferenceProfileSummaries[].inferenceProfileId"
aws bedrock list-foundation-models --region ap-south-1 --query "modelSummaries[?starts_with(modelId, 'amazon.nova-2')].modelId"
```

Static IAM access keys only. Bedrock API keys (ABSK…) are a different
mechanism and are not supported by this code path. Never commit keys; set them
as shell environment variables only.

### 3. Start the server with the AWS path enabled

PowerShell, same shell that runs the server (the server does not read `.env`
files):

```powershell
$env:AWS_REGION = "ap-south-1"
$env:AWS_ACCESS_KEY_ID = "<your-access-key-id>"
$env:AWS_SECRET_ACCESS_KEY = "<your-secret-access-key>"
$env:AWS_BEDROCK_MODEL_ID = "global.amazon.nova-2-lite-v1:0"
npm run dev
```

`AWS_SESSION_TOKEN` is only for temporary credentials. Leave it unset for
static keys. Omitting all four variables keeps the pure local demo with zero
network calls.

### 4. Bounded end-to-end test (this is the account verification)

Open http://127.0.0.1:5173, sign in as teacher, and upload one real labelled
diagram (PNG/JPEG ≤ 5 MB, printed English labels). Watch the pipeline stage
list — it is wired to the real calls and reports:

- "OCR labels — Textract DetectDocumentText returned N LINE labels" with the
  measured duration, or the honest fallback with the reason,
- "Analysis — Bedrock global.amazon.nova-2-lite-v1:0 proposal grounded against
  N OCR labels; M parts kept" with the measured duration.

Fixture lessons and uploaded diagrams without AWS configured are unaffected
and keep their **Demo simulation** labels. If both stages complete, the
account, region, model ID, image input and tool-use path are all verified for
this account — record the date in AWS_VERIFICATION.md.

## Deliverable values (Phase 1)

- Deployed AWS resources: **none** (per-call APIs only; nothing to tear down)
- Region: `ap-south-1`
- Frontend/API base URL: `http://127.0.0.1:5173` (same-origin; all API calls
  go to `/api/*` served by the same Node process)
- Frontend integration values: none to change — the frontend already talks to
  same-origin `/api`; the AWS path is server-side only
- Environment variables: `AWS_REGION`, `AWS_ACCESS_KEY_ID`,
  `AWS_SECRET_ACCESS_KEY`, `AWS_BEDROCK_MODEL_ID` (server process only; never
  `VITE_` variables)
- Estimated demo cost: see COSTS.md — under one US dollar for a 100-diagram
  demo run, zero fixed cost
- Cleanup: see below

## Cost gate

Worst-case arithmetic is in COSTS.md. Phase 1 has no fixed infrastructure
cost; charges accrue only per uploaded diagram (~$0.006 typical, ~$0.016
worst case). Do not run bulk loads beyond a few hundred diagrams without
re-estimating. Budget alerts are not set (no standing resources to attach them
to); the cap is behavioural: bounded uploads, bounded retries (the code makes
at most one Textract + one Bedrock call per upload, no retry loop).

## Cleanup (Phase 1)

```powershell
# 1. Stop using the credentials
Remove-Item Env:AWS_ACCESS_KEY_ID, Env:AWS_SECRET_ACCESS_KEY, Env:AWS_BEDROCK_MODEL_ID, Env:AWS_REGION -ErrorAction SilentlyContinue

# 2. Delete the demo IAM access key if it was created only for this project
#    IAM console -> Users -> <user> -> Security credentials -> Delete access key
#    (or: aws iam delete-access-key --user-name <user> --access-key-id <key-id>)

# 3. Optionally remove local classroom data
#    Remove-Item -Recurse -Force .data
```

There are no buckets, tables, functions or workflows to delete. If Phase 2 is
ever built, its stack must ship its own teardown command and a standing-cost
table.
