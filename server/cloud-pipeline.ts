import { z } from "zod";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { SFNClient, StartExecutionCommand, DescribeExecutionCommand } from "@aws-sdk/client-sfn";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { id, mapSchema, labelSchema, issueSchema, type Lesson } from "../shared/schema";
import { analyzeWithAws, imageType } from "./providers";
import { readAwsConfig } from "./aws";
import { revalidate, validateMap } from "../shared/domain";

export function cloudConfig(env: NodeJS.ProcessEnv) {
  if (env.SAHPAATH_PIPELINE_MODE !== "step_functions") return null;
  const config = z.object({ region: z.string().min(1), bucket: z.string().min(3),
    table: z.string().min(3), stateMachineArn: z.string().startsWith("arn:") }).parse({
    region: env.AWS_REGION, bucket: env.SAHPAATH_PIPELINE_BUCKET,
    table: env.SAHPAATH_PIPELINE_TABLE, stateMachineArn: env.SAHPAATH_PIPELINE_STATE_MACHINE_ARN,
  });
  return config;
}
function workerConfig(env: NodeJS.ProcessEnv) {
  return z.object({ region: z.string().min(1), bucket: z.string().min(3), table: z.string().min(3) }).parse({
    region: env.AWS_REGION, bucket: env.SAHPAATH_PIPELINE_BUCKET, table: env.SAHPAATH_PIPELINE_TABLE,
  });
}
type CloudConfig = NonNullable<ReturnType<typeof cloudConfig>>;
const jobSchema = z.object({ jobId: id, lessonId: id, key: z.string().regex(/^diagrams\/[\w-]+\/[\w-]+$/) }).strict();
const resultSchema = z.object({
  ok: z.boolean(), labels: z.array(labelSchema).max(100), map: mapSchema.optional(),
  issues: z.array(issueSchema).optional(), valid: z.boolean().optional(),
  reason: z.string().optional(), failedStage: z.enum(["ocr", "model", "validation"]).optional(),
  durations: z.object({ ocrMs: z.number().nullable(), modelMs: z.number().nullable() }),
  retries: z.number().int().min(0).max(1),
});
function clients(region: string) {
  return { s3: new S3Client({ region }), sfn: new SFNClient({ region }),
    db: DynamoDBDocumentClient.from(new DynamoDBClient({ region })) };
}
const executionArn = (config: CloudConfig, jobId: string) =>
  `${config.stateMachineArn.replace(":stateMachine:", ":execution:")}:${jobId}`;

// Called only from the authenticated teacher upload route, with server-generated
// lesson/job IDs and verified image bytes. Never accepts arbitrary S3 locations.
export async function startCloudPipeline(config: CloudConfig, lesson: Lesson, bytes: Buffer) {
  const mime = imageType(bytes);
  if (!mime) throw new Error("Unsupported image");
  const job = jobSchema.parse({ jobId: lesson.jobId, lessonId: lesson.id, key: `diagrams/${lesson.id}/${lesson.jobId}` });
  const { s3, sfn, db } = clients(config.region);
  try {
    await s3.send(new PutObjectCommand({ Bucket: config.bucket, Key: job.key,
      Body: bytes, ContentType: mime, ServerSideEncryption: "AES256", IfNoneMatch: "*" }));
    await db.send(new PutCommand({ TableName: config.table, Item: {
      jobId: job.jobId, lessonId: job.lessonId, status: "queued", createdAt: new Date().toISOString(),
    }, ConditionExpression: "attribute_not_exists(jobId)" }));
    await sfn.send(new StartExecutionCommand({ stateMachineArn: config.stateMachineArn,
      name: job.jobId, input: JSON.stringify(job) }));
    lesson.stages = lesson.stages.map((stage) => stage.name === "Upload & storage"
      ? { ...stage, detail: "Original saved to private S3 and local preview storage." }
      : ["OCR labels", "Analysis", "Validation"].includes(stage.name)
        ? { ...stage, status: "waiting", detail: "AWS processing queued. Teacher review remains locked." } : stage);
    return lesson;
  } finally { s3.destroy(); sfn.destroy(); db.destroy(); }
}

// Lambda entrypoint. The state machine passes identifiers only, never image or
// model payloads. Large artifacts remain in private S3, outside SFN/DDB limits.
export async function handler(input: unknown) {
  const job = jobSchema.parse(input);
  if (job.key !== `diagrams/${job.lessonId}/${job.jobId}`) throw new Error("Invalid job key");
  const config = workerConfig(process.env);
  const aws = readAwsConfig({ ...process.env, SAHPAATH_AWS_USE_ROLE: "true" });
  if (!config || !aws) throw new Error("Pipeline configuration missing");
  const { s3, sfn, db } = clients(config.region);
  let claimed = false;
  try {
    const existing = await db.send(new GetCommand({ TableName: config.table, Key: { jobId: job.jobId }, ConsistentRead: true }));
    if (existing.Item?.lessonId !== job.lessonId) throw new Error("Unknown processing job");
    if (existing.Item?.resultKey) return { jobId: job.jobId, status: existing.Item.status };
    await db.send(new PutCommand({ TableName: config.table,
      Item: { ...existing.Item, status: "processing", startedAt: new Date().toISOString() },
      ConditionExpression: "#status = :queued AND lessonId = :lesson",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":queued": "queued", ":lesson": job.lessonId } }));
    claimed = true;
    const object = await s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: job.key }));
    if (!object.ContentLength || object.ContentLength > 5_000_000 || !object.Body) throw new Error("Invalid source image");
    const bytes = Buffer.from(await object.Body.transformToByteArray());
    const mime = imageType(bytes);
    if (!mime) throw new Error("Invalid source image");
    const result = await analyzeWithAws(aws, { bytes, mime });
    const resultKey = `results/${job.jobId}.json`;
    await s3.send(new PutObjectCommand({ Bucket: config.bucket, Key: resultKey,
      Body: JSON.stringify(result), ContentType: "application/json", ServerSideEncryption: "AES256" }));
    // Store structured items separately to keep every DynamoDB item small.
    {
      const retainedMap = result.ok ? result.map : { labels: result.labels };
      for (const [kind, rows] of Object.entries(retainedMap)) {
        for (const [index, row] of rows.entries()) await db.send(new PutCommand({ TableName: config.table,
          Item: { jobId: `${job.jobId}#${kind}#${index}`, lessonId: job.lessonId, kind, value: row },
        }));
      }
    }
    const status = result.ok ? "needs_review" : "failed";
    await db.send(new PutCommand({ TableName: config.table, Item: {
      jobId: job.jobId, lessonId: job.lessonId, status, resultKey,
      validationPassed: result.ok ? result.valid : false,
      retries: result.retries, completedAt: new Date().toISOString(),
    }, ConditionExpression: "lessonId = :lesson AND attribute_not_exists(resultKey)",
      ExpressionAttributeValues: { ":lesson": job.lessonId } }));
    console.info(JSON.stringify({ event: "diagram_processing_completed", jobId: job.jobId, status, retries: result.retries }));
    return { jobId: job.jobId, status };
  } catch {
    if (claimed) {
      await db.send(new PutCommand({ TableName: config.table,
        Item: { jobId: job.jobId, lessonId: job.lessonId, status: "failed", errorCode: "pipeline_failed" },
        ConditionExpression: "attribute_not_exists(resultKey)" })).catch(() => {});
    }
    console.error(JSON.stringify({ event: "diagram_processing_failed", jobId: job.jobId, errorCode: "pipeline_failed" }));
    throw new Error("Diagram processing failed. See job status; no content was published.");
  } finally { s3.destroy(); sfn.destroy(); db.destroy(); }
}

export function isProcessing(lesson: Lesson) {
  return lesson.stages.some((s) => s.name === "Analysis" && s.status === "waiting");
}
export async function refreshCloudLesson(config: CloudConfig, lesson: Lesson): Promise<Lesson | null> {
  if (!isProcessing(lesson)) return null;
  if (lesson.status === "published") throw new Error("Cannot replace published content with a processing result");
  const { s3, sfn, db } = clients(config.region);
  try {
    const record = await db.send(new GetCommand({ TableName: config.table, Key: { jobId: lesson.jobId }, ConsistentRead: true }));
    if (record.Item?.lessonId !== lesson.id) throw new Error("Unknown processing job");
    if (!record.Item.resultKey) {
      const execution = await sfn.send(new DescribeExecutionCommand({ executionArn: executionArn(config, lesson.jobId) }));
      if (execution.status === "RUNNING") return null;
      return { ...lesson, stages: lesson.stages.map((s) => ["OCR labels", "Analysis", "Validation"].includes(s.name)
        ? { ...s, status: "fallback", detail: "Cloud processing failed or timed out. Use the manual editor.", error: "pipeline_failed" } : s) };
    }
    const expectedKey = `results/${lesson.jobId}.json`;
    if (record.Item.resultKey !== expectedKey) throw new Error("Invalid result reference");
    const artifact = await s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: expectedKey }));
    if (!artifact.Body || !artifact.ContentLength || artifact.ContentLength > 2_000_000) throw new Error("Invalid result size");
    const result = resultSchema.parse(JSON.parse(await artifact.Body.transformToString()));
    const map = revalidate(result.ok && result.map ? result.map : { labels: result.labels, parts: [], relations: [], flows: [] }, true);
    return { ...lesson, map, stages: lesson.stages.map((s) => {
      if (s.name === "OCR labels") return { ...s, status: result.failedStage === "ocr" ? "fallback" : "completed", durationMs: result.durations.ocrMs, detail: `${result.labels.length} Textract labels retained.` };
      if (s.name === "Analysis") return { ...s, status: result.ok ? "completed" : "fallback", retries: result.retries, durationMs: result.durations.modelMs, detail: result.reason ?? "Bedrock proposal received. Teacher review required." };
      if (s.name === "Validation") return { ...s, status: "completed", detail: `${validateMap(map).length} deterministic validation findings.` };
      return s;
    }) };
  } finally { s3.destroy(); sfn.destroy(); db.destroy(); }
}
