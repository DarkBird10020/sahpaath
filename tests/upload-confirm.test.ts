import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryRepos } from "../server/repositories/memory";
import { LessonService, type Actor } from "../server/services/lesson-service";
import { DiagramUploadService } from "../server/services/diagram-upload-service";
import { DiagramSenseService } from "../server/services/diagram-sense-service";
import { LocalPresignedUpload } from "../server/core/presign";
import { LocalFileStorage } from "../server/core/storage";
import { loadConfig } from "../server/core/config";
import { Logger } from "../server/core/logger";

const teacher: Actor = { userId: "teacher-local", role: "teacher" };
const log = new Logger(() => {}, "error");
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

function setup(env: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "sahpaath-confirm-"));
  const repos = createMemoryRepos();
  // A local folder stands in for the private bucket: no AWS call is made.
  const storage = new LocalFileStorage(dir);
  const config = loadConfig({
    SAHPAATH_STORE: "memory",
    SAHPAATH_TEACHER_PASSWORD: "pw",
    SAHPAATH_UPLOAD_TOKEN_SECRET: "test-secret",
    ...env,
  } as NodeJS.ProcessEnv);
  const sense = new DiagramSenseService(repos, storage, null, null, config, log);
  const uploads = new DiagramUploadService(repos, new LocalPresignedUpload(config.uploadTokenSecret), sense, storage, config, log);
  return { dir, repos, storage, uploads, lessons: new LessonService(repos, log) };
}
async function registered(ctx: ReturnType<typeof setup>) {
  const lesson = await ctx.lessons.createLesson(teacher, { title: "Heart" });
  return ctx.uploads.registerDiagram(teacher, {
    lessonId: lesson.lessonId, sourceType: "upload", licenseName: "CC0", contentType: "image/png",
  });
}

describe("S3 upload confirmation", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup({ SAHPAATH_S3_BUCKET: "private-test-bucket", AWS_REGION: "ap-south-1" });
  });
  afterEach(() => rmSync(ctx.dir, { recursive: true, force: true }));

  it("requires a region whenever a bucket is configured", () => {
    expect(() =>
      loadConfig({ SAHPAATH_TEACHER_PASSWORD: "pw", SAHPAATH_UPLOAD_TOKEN_SECRET: "s", SAHPAATH_S3_BUCKET: "b" } as NodeJS.ProcessEnv),
    ).toThrow("AWS_REGION");
  });
  it("verifies the uploaded object, copies it to a verified key and refuses a second confirmation", async () => {
    const diagram = await registered(ctx);
    const grant = await ctx.uploads.createUploadUrl(teacher, diagram.diagramId, "image/png");
    await ctx.storage.put(grant.key, PNG_BYTES, "image/png");
    const input = {
      diagramId: diagram.diagramId, key: grant.key, maxSize: grant.maxBytes,
      contentType: "image/png" as const, expiresAt: grant.expiresAt, token: grant.confirmationToken,
    };
    const updated = await ctx.uploads.confirmS3Upload(teacher, input);
    expect(updated.originalS3Key).toMatch(new RegExp(`^verified/${diagram.diagramId}/.+\\.png$`));
    expect(updated.revision).toBe(diagram.revision + 1);
    expect((await ctx.storage.get(updated.originalS3Key!)).equals(PNG_BYTES)).toBe(true);
    await expect(ctx.uploads.confirmS3Upload(teacher, input)).rejects.toMatchObject({ code: "conflict" });
  });
  it("rejects forged tokens, expired grants and objects that are not the granted image", async () => {
    const diagram = await registered(ctx);
    const grant = await ctx.uploads.createUploadUrl(teacher, diagram.diagramId, "image/png");
    const base = {
      diagramId: diagram.diagramId, key: grant.key, maxSize: grant.maxBytes,
      contentType: "image/png" as const, expiresAt: grant.expiresAt, token: grant.confirmationToken,
    };
    await ctx.storage.put(grant.key, Buffer.from("not an image at all"), "image/png");
    await expect(ctx.uploads.confirmS3Upload(teacher, { ...base, token: "0".repeat(64) })).rejects.toMatchObject({ code: "validation_failed" });
    await expect(ctx.uploads.confirmS3Upload(teacher, { ...base, maxSize: base.maxSize - 1 })).rejects.toMatchObject({ code: "validation_failed" });
    await expect(ctx.uploads.confirmS3Upload(teacher, base)).rejects.toMatchObject({ code: "validation_failed" });
    expect((await ctx.repos.diagrams.get(diagram.diagramId))!.originalS3Key).toBeFalsy();
  });
});

describe("Local upload replay protection", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup({});
  });
  afterEach(() => rmSync(ctx.dir, { recursive: true, force: true }));

  it("does not let a reused grant replace an uploaded image", async () => {
    const diagram = await registered(ctx);
    const grant = await ctx.uploads.createUploadUrl(teacher, diagram.diagramId, "image/png");
    const input = {
      diagramId: diagram.diagramId, key: grant.key, maxSize: grant.maxBytes, contentType: "image/png",
      expiresAt: grant.expiresAt, token: grant.fields["x-sahpaath-token"], bytes: PNG_BYTES,
    };
    await ctx.uploads.confirmLocalUpload(teacher, input);
    await expect(ctx.uploads.confirmLocalUpload(teacher, input)).rejects.toMatchObject({ code: "conflict" });
    await expect(ctx.uploads.createUploadUrl(teacher, diagram.diagramId, "image/png")).rejects.toMatchObject({ code: "conflict" });
  });
});
