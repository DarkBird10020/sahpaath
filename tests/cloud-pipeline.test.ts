import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ s3: vi.fn(), sfn: vi.fn(), db: vi.fn(), analyze: vi.fn() }));
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class { send = mocks.s3; destroy() {} },
  PutObjectCommand: class { constructor(public input: unknown) {} },
  GetObjectCommand: class { constructor(public input: unknown) {} },
}));
vi.mock("@aws-sdk/client-sfn", () => ({
  SFNClient: class { send = mocks.sfn; destroy() {} },
  StartExecutionCommand: class { constructor(public input: unknown) {} },
  DescribeExecutionCommand: class { constructor(public input: unknown) {} },
}));
vi.mock("@aws-sdk/client-dynamodb", () => ({ DynamoDBClient: class {} }));
vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mocks.db, destroy() {} }) },
  PutCommand: class { constructor(public input: unknown) {} },
  GetCommand: class { constructor(public input: unknown) {} },
}));
vi.mock("../server/providers", async (original) => ({ ...await original<typeof import("../server/providers")>(), analyzeWithAws: mocks.analyze }));
import { cloudConfig, handler, refreshCloudLesson, startCloudPipeline } from "../server/cloud-pipeline";
import { createLesson } from "../server/providers";

const config = { region: "example-region", bucket: "private-bucket", table: "pipeline-table", stateMachineArn: "arn:aws:states:example-region:123456789012:stateMachine:diagrams" };
const png = Buffer.alloc(24);
Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
png.write("IHDR", 12);
beforeEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
describe("cloud processing boundary (mocked SDK, no network)", () => {
  it("requires explicit cloud mode and complete configuration", () => {
    expect(cloudConfig({})).toBeNull();
    expect(() => cloudConfig({ SAHPAATH_PIPELINE_MODE: "step_functions" })).toThrow();
  });
  it("uploads privately and starts an identifier-only job with conditional creation", async () => {
    const lesson = await createLesson(null);
    await startCloudPipeline(config, lesson, png);
    expect(mocks.s3.mock.calls[0][0].input).toMatchObject({ ServerSideEncryption: "AES256", IfNoneMatch: "*" });
    expect(mocks.db.mock.calls[0][0].input.ConditionExpression).toBe("attribute_not_exists(jobId)");
    const execution = mocks.sfn.mock.calls[0][0].input;
    expect(JSON.parse(execution.input)).toEqual({ jobId: lesson.jobId, lessonId: lesson.id, key: `diagrams/${lesson.id}/${lesson.jobId}` });
    expect(lesson.stages.find((s) => s.name === "Analysis")?.status).toBe("waiting");
  });
  it("rejects bad image bytes before any cloud side effect", async () => {
    await expect(startCloudPipeline(config, await createLesson(null), Buffer.from("bad"))).rejects.toThrow();
    expect(mocks.s3).not.toHaveBeenCalled();
  });
  it("returns a fallback after a terminal execution failure", async () => {
    const lesson = await createLesson(null);
    lesson.stages.find((s) => s.name === "Analysis")!.status = "waiting";
    mocks.db.mockResolvedValue({ Item: { lessonId: lesson.id } });
    mocks.sfn.mockResolvedValue({ status: "TIMED_OUT" });
    const result = await refreshCloudLesson(config, lesson);
    expect(result?.stages.find((s) => s.name === "Analysis")?.status).toBe("fallback");
    expect(mocks.s3).not.toHaveBeenCalled();
  });
  it("refuses a result associated with another lesson", async () => {
    const lesson = await createLesson(null);
    lesson.stages.find((s) => s.name === "Analysis")!.status = "waiting";
    mocks.db.mockResolvedValue({ Item: { lessonId: "other" } });
    await expect(refreshCloudLesson(config, lesson)).rejects.toThrow("Unknown processing job");
  });
  it("imports maps only as unapproved drafts, validating again at the API boundary", async () => {
    const lesson = await createLesson("heart");
    lesson.stages.find((s) => s.name === "Analysis")!.status = "waiting";
    lesson.map.parts.forEach((p) => p.state = "teacher_approved");
    const artifact = JSON.stringify({ ok: true, map: lesson.map, labels: lesson.map.labels, durations: { ocrMs: 1, modelMs: 2 }, retries: 0 });
    mocks.db.mockResolvedValue({ Item: { lessonId: lesson.id, resultKey: `results/${lesson.jobId}.json` } });
    mocks.s3.mockResolvedValue({ ContentLength: artifact.length, Body: { transformToString: async () => artifact } });
    const result = await refreshCloudLesson(config, lesson);
    expect(result?.status).toBe("draft");
    expect(result?.map.parts.some((p) => p.state === "teacher_approved")).toBe(false);
    expect(result?.stages.find((s) => s.name === "Publish")?.status).toBe("locked");
  });
  it("replayed completed Lambda jobs do not call the model again", async () => {
    vi.stubEnv("AWS_REGION", config.region); vi.stubEnv("AWS_BEDROCK_MODEL_ID", "configured-model");
    vi.stubEnv("SAHPAATH_PIPELINE_BUCKET", config.bucket); vi.stubEnv("SAHPAATH_PIPELINE_TABLE", config.table);
    mocks.db.mockResolvedValue({ Item: { lessonId: "lesson", resultKey: "results/job.json", status: "needs_review" } });
    expect(await handler({ lessonId: "lesson", jobId: "job", key: "diagrams/lesson/job" })).toEqual({ jobId: "job", status: "needs_review" });
    expect(mocks.analyze).not.toHaveBeenCalled();
  });
  it("persists structured map rows and a review-only result, never a publication", async () => {
    vi.stubEnv("AWS_REGION", config.region); vi.stubEnv("AWS_BEDROCK_MODEL_ID", "configured-model");
    vi.stubEnv("SAHPAATH_PIPELINE_BUCKET", config.bucket); vi.stubEnv("SAHPAATH_PIPELINE_TABLE", config.table);
    const lesson = await createLesson("heart");
    mocks.db.mockResolvedValue({ Item: { lessonId: "lesson", status: "queued" } });
    mocks.s3.mockResolvedValue({ ContentLength: png.length, Body: { transformToByteArray: async () => png } });
    mocks.analyze.mockResolvedValue({ ok: true, valid: false, map: lesson.map, labels: lesson.map.labels, issues: [], retries: 0, durations: { ocrMs: 1, modelMs: 1 } });
    expect(await handler({ lessonId: "lesson", jobId: "job", key: "diagrams/lesson/job" })).toEqual({ jobId: "job", status: "needs_review" });
    const writes = mocks.db.mock.calls.map((c) => c[0].input).filter((i) => i.Item);
    expect(writes.some((w) => w.Item.kind === "parts")).toBe(true);
    expect(writes.at(-1).Item).toMatchObject({ status: "needs_review", validationPassed: false, resultKey: "results/job.json" });
    expect(JSON.stringify(writes)).not.toContain('"status":"published"');
  });
});
