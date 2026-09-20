# AWS in SahPaath

SahPaath turns one teacher-approved lesson into several accessible ways into
the same material. The work it does — reading a diagram, proposing a structure,
validating that structure against the picture, holding an approved version
immutably, and speaking it aloud — maps onto AWS services one for one.

This page says exactly which service does which job and which file calls it, so
the claim can be checked rather than taken on trust. It also says plainly where
a service is declared but not yet running.

The app has two editions. The **local edition** runs entirely on one machine
with no AWS account, which is what makes it usable in a classroom with no
budget; the **cloud edition** switches on when the environment carries AWS
configuration, and `server/aws.ts` decides which is in force:

```
server/aws.ts:14   readAwsConfig(env)  -> AwsConfig | null
```

Every integration below is written so that its absence degrades the feature
rather than breaking the app. That is deliberate: a school with no AWS account
still gets a working classroom.

## Services called from application code

| Service | What it does here | Where |
|---|---|---|
| **Amazon Bedrock** | Proposes the structure of a diagram — parts, relationships and reading order — from the picture itself. `InvokeModel` with the image and the prompt in one message at `temperature: 0`, and the reply is parsed against a Zod schema before anything downstream sees it. | `server/providers/bedrock.ts` |
| **Amazon Textract** | Reads the labels that are actually printed on the diagram, with their bounding boxes and confidence, so every proposed part can be traced back to a label that really exists. | `server/providers/textract.ts`, `server/aws.ts` (response parsing) |
| **Amazon Polly** | Speaks an approved description aloud. Cached, so a class of thirty costs one synthesis. Falls back to the browser's own speech when not configured. | `server/audio.ts` |
| **Amazon S3** | Holds the uploaded diagram and the pipeline's results. Uploads are browser-direct through a presigned POST, so the image never passes through the application server. | `server/core/storage.ts`, `server/core/presign.ts` |
| **Amazon DynamoDB** | Stores lessons, diagram versions, approvals, vocabulary and caption segments in a single-table design, and expires classroom sessions through a `ttl` attribute. | `server/repositories/dynamodb.ts`, `server/repositories/dynamodb-client.ts` |
| **AWS Step Functions** | Runs the diagram pipeline as a state machine, retrying transient Lambda faults with exponential backoff so a throttle does not reach a teacher as a failed lesson. The per-stage records — status, duration, retries — are written by the worker and read back on the workspace's Processing details tab. | `server/core/orchestrator.ts`, `server/cloud-pipeline.ts` |
| **AWS Lambda** | The pipeline worker the state machine invokes. | `infra/diagram-pipeline.json` (`PipelineWorker`) |
| **AWS IAM** | Least-privilege policies per task: the worker may read only `diagrams/*`, write only `results/*`, and call exactly one Bedrock model ARN. | `infra/diagram-pipeline.json` (inline policies) |

## Services declared in infrastructure

`infra/diagram-pipeline.json` is a CloudFormation template using the AWS
Serverless Application Model transform. `npx tsx scripts/check-infra.ts`
verifies that every `Ref`, `Fn::GetAtt` and `Fn::Sub` in it resolves.

| Service | What it does here |
|---|---|
| **AWS CloudFormation / SAM** | The whole stack is described as code: bucket, table, worker, state machine, alarms and alerts, with `Retain` on the two resources that hold real work. |
| **Amazon CloudWatch Logs** | The worker's log group is declared rather than left for Lambda to create, so it carries a fourteen-day retention and cannot grow without limit. |
| **Amazon CloudWatch Alarms** | An alarm on the worker's `Errors` metric, published to SNS. |
| **Amazon SNS** | The topic those alerts arrive on. No address is committed; the operator subscribes. |
| **Amazon EventBridge** | Step Functions already publishes execution status changes to the default bus; a rule routes `FAILED`, `TIMED_OUT` and `ABORTED` to the same topic, so a lesson that never finished processing is noticed. |
| **AWS X-Ray** | Tracing on both the worker and the state machine, to see where the time in a diagram analysis actually goes. |

Cost discipline is part of the template rather than an afterthought: the table
is `PAY_PER_REQUEST`, the bucket blocks all public access and encrypts at rest,
incomplete multipart uploads are aborted after seven days, results expire after
thirty and source diagrams after ninety.

## What is not connected

Stated plainly, because a reviewer will check:

- **No AWS credentials are configured in this working copy.** `AWS_REGION` and
  `AWS_BEDROCK_MODEL_ID` are absent, so `readAwsConfig` returns `null` and the
  app runs its local edition. `/api/health` reports `awsConfigured: false`.
- **The stack in `infra/` has not been deployed from this machine.** It
  validates, and it has not been run.
- **Amazon Transcribe is not wired.** Live captions use the browser's own
  speech recognition, and the UI says so rather than implying otherwise.
- In the local edition, diagram reading uses tesseract.js and a Gemini stand-in
  in place of Textract and Bedrock. Every screen that shows their output labels
  it a demo simulation.

## Checking these claims

```bash
npx tsx scripts/check-infra.ts     # template resolves; lists every resource type
curl localhost:5173/api/health     # reports which edition is in force
grep -rn "@aws-sdk/" server/       # every AWS call site
```
