import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryRepos } from "../server/repositories/memory";
import { LessonService, type Actor } from "../server/services/lesson-service";
import { DiagramUploadService } from "../server/services/diagram-upload-service";
import { DiagramSenseService } from "../server/services/diagram-sense-service";
import { ClassroomService } from "../server/services/classroom-service";
import { LocalPresignedUpload } from "../server/core/presign";
import { LocalFileStorage } from "../server/core/storage";
import { loadConfig } from "../server/core/config";
import { Logger } from "../server/core/logger";
import { signUploadToken } from "../server/core/ids";
import { imageType } from "../server/providers/image-type";
import { readMultipart } from "../server/http/multipart";
import type { IncomingMessage } from "node:http";

const teacher: Actor = { userId: "teacher-local", role: "teacher" };
const student: Actor = { userId: "student-x", role: "student" };

const log = new Logger(() => {}, "error");

/** Minimal valid PNG (1x1 transparent) for magic-byte tests. */
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
/** Minimal valid JPEG (1x1) — SOI + JFIF header with EOI marker. */
const JPEG_BYTES = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]),
  Buffer.alloc(20, 0x11),
  Buffer.from([0xff, 0xd9]),
]);
/** Not an image: text pretending to be one (wrong extension, wrong MIME). */
const FAKE_BYTES = Buffer.from("this is definitely not an image file");

describe("Diagram upload flow (local adapter)", () => {
  let repos: ReturnType<typeof createMemoryRepos>;
  let lessons: LessonService;
  let uploads: DiagramUploadService;
  let storage: LocalFileStorage;
  let dir: string;
  let config: ReturnType<typeof loadConfig>;

  beforeEach(() => {
    repos = createMemoryRepos();
    lessons = new LessonService(repos, log);
    storage = new LocalFileStorage((dir = join(mkdtempSync(join(tmpdir(), "sahpaath-up-")), "uploads")));
    config = loadConfig({
      SAHPAATH_STORE: "memory",
      SAHPAATH_TEACHER_PASSWORD: "pw",
      SAHPAATH_UPLOAD_TOKEN_SECRET: "test-secret",
    } as NodeJS.ProcessEnv);
    const sense = new DiagramSenseService(repos, storage, null, null, config, log);
    uploads = new DiagramUploadService(
      repos,
      new LocalPresignedUpload(config.uploadTokenSecret),
      sense,
      storage,
      config,
      log,
    );
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("unauthorized: student and foreign teacher cannot register, list, or process", async () => {
    const lesson = await lessons.createLesson(teacher, { title: "Heart" });
    await expect(
      uploads.registerDiagram(student, {
        lessonId: lesson.lessonId, sourceType: "upload", licenseName: "CC0",
        contentType: "image/png",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(uploads.listDiagrams(student, lesson.lessonId)).rejects.toMatchObject({ code: "forbidden" });

    // Register as owner, then prove other teachers are locked out too.
    const diagram = await uploads.registerDiagram(teacher, {
      lessonId: lesson.lessonId, sourceType: "upload", licenseName: "CC0",
      contentType: "image/png",
    });
    const other: Actor = { userId: "teacher-other", role: "teacher" };
    await expect(uploads.createUploadUrl(other, diagram.diagramId)).rejects.toMatchObject({ code: "forbidden" });
    await expect(uploads.processingStatus(other, diagram.diagramId)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("invalid lesson: registration on a missing lesson 404s", async () => {
    await expect(
      uploads.registerDiagram(teacher, {
        lessonId: "nope", sourceType: "upload", licenseName: "CC0", contentType: "image/png",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("missing license: registration and upload-url are refused without license metadata", async () => {
    const lesson = await lessons.createLesson(teacher, { title: "Heart" });
    await expect(
      uploads.registerDiagram(teacher, {
        lessonId: lesson.lessonId, sourceType: "", licenseName: "CC0", contentType: "image/png",
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
    await expect(
      uploads.registerDiagram(teacher, {
        lessonId: lesson.lessonId, sourceType: "upload", licenseName: "  ", contentType: "image/png",
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("presigned URL generation: local grants expire, bind one type, cap size, use unique keys", async () => {
    const lesson = await lessons.createLesson(teacher, { title: "Heart" });
    const d1 = await uploads.registerDiagram(teacher, {
      lessonId: lesson.lessonId, sourceType: "upload", licenseName: "CC0", contentType: "image/png",
    });
    const d2 = await uploads.registerDiagram(teacher, {
      lessonId: lesson.lessonId, sourceType: "upload", licenseName: "CC0", contentType: "image/png",
    });

    const grant = await uploads.createUploadUrl(teacher, d1.diagramId, "image/png");
    expect(grant.mode).toBe("local");
    expect(grant.fields["Content-Type"]).toBe("image/png");
    expect(grant.maxBytes).toBe(5_000_000);
    expect(grant.expiresAt).toBeGreaterThan(Date.now());
    // Unique key per diagram, never shared:
    expect(grant.key).toContain(d1.diagramId);
    const grant2 = await uploads.createUploadUrl(teacher, d2.diagramId, "image/png");
    expect(grant2.key).not.toBe(grant.key);
    // Grant is bound to the diagram id it was issued for:
    expect(grant.fields["x-sahpaath-diagram-id"]).toBe(d1.diagramId);

    // A second grant for a diagram that already has bytes conflicts.
    await uploads.confirmLocalUpload(teacher, {
      diagramId: d1.diagramId, key: grant.key, maxSize: grant.maxBytes,
      contentType: "image/png", expiresAt: grant.expiresAt, token: grant.fields["x-sahpaath-token"],
      bytes: PNG_BYTES,
    });
    await expect(uploads.createUploadUrl(teacher, d1.diagramId)).rejects.toMatchObject({ code: "conflict" });
  });

  it("invalid file type: text masquerading as PNG is rejected by magic bytes", async () => {
    const lesson = await lessons.createLesson(teacher, { title: "Heart" });
    const diagram = await uploads.registerDiagram(teacher, {
      lessonId: lesson.lessonId, sourceType: "upload", licenseName: "CC0", contentType: "image/png",
    });
    const grant = await uploads.createUploadUrl(teacher, diagram.diagramId, "image/png");
    // Extension and browser MIME say PNG; contents say otherwise.
    await expect(
      uploads.confirmLocalUpload(teacher, {
        diagramId: diagram.diagramId, key: grant.key, maxSize: grant.maxBytes,
        contentType: "image/png", expiresAt: grant.expiresAt,
        token: grant.fields["x-sahpaath-token"],
        bytes: FAKE_BYTES,
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
    // Nothing was stored, diagram still has no object.
    const stored = (await repos.diagrams.get(diagram.diagramId))!;
    expect(stored.originalS3Key).toBeNull();
    expect(imageType(FAKE_BYTES)).toBeNull();
  });

  it("oversized file: bytes beyond the granted cap are rejected", async () => {
    const lesson = await lessons.createLesson(teacher, { title: "Heart" });
    const diagram = await uploads.registerDiagram(teacher, {
      lessonId: lesson.lessonId, sourceType: "upload", licenseName: "CC0", contentType: "image/png",
    });
    const grant = await uploads.createUploadUrl(teacher, diagram.diagramId, "image/png");
    const huge = Buffer.concat([PNG_BYTES, Buffer.alloc(grant.maxBytes + 1)]);
    await expect(
      uploads.confirmLocalUpload(teacher, {
        diagramId: diagram.diagramId, key: grant.key, maxSize: grant.maxBytes,
        contentType: "image/png", expiresAt: grant.expiresAt,
        token: grant.fields["x-sahpaath-token"],
        bytes: huge,
      }),
    ).rejects.toMatchObject({ code: "payload_too_large" });
  });

  it("expired grant is rejected; forged tokens fail signature verification", async () => {
    const lesson = await lessons.createLesson(teacher, { title: "Heart" });
    const diagram = await uploads.registerDiagram(teacher, {
      lessonId: lesson.lessonId, sourceType: "upload", licenseName: "CC0", contentType: "image/png",
    });
    // Expired grant
    await expect(
      uploads.confirmLocalUpload(teacher, {
        diagramId: diagram.diagramId, key: "uploads/x/original.png", maxSize: 5_000_000,
        contentType: "image/png", expiresAt: Date.now() - 1000,
        token: signUploadToken(config.uploadTokenSecret, {
          key: "uploads/x/original.png", maxSize: 5_000_000, contentType: "image/png",
          expiresAt: Date.now() - 1000, diagramId: diagram.diagramId,
        }),
        bytes: PNG_BYTES,
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
    // Forged token (wrong secret)
    await expect(
      uploads.confirmLocalUpload(teacher, {
        diagramId: diagram.diagramId, key: "uploads/x/original.png", maxSize: 5_000_000,
        contentType: "image/png", expiresAt: Date.now() + 60_000,
        token: "0".repeat(64),
        bytes: PNG_BYTES,
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
    // Valid grant shape but bound to a DIFFERENT diagram (signature binds diagramId)
    const other = await uploads.registerDiagram(teacher, {
      lessonId: lesson.lessonId, sourceType: "upload", licenseName: "CC0", contentType: "image/png",
    });
    await expect(
      uploads.confirmLocalUpload(teacher, {
        diagramId: other.diagramId, key: "uploads/x/original.png", maxSize: 5_000_000,
        contentType: "image/png", expiresAt: Date.now() + 60_000,
        token: signUploadToken(config.uploadTokenSecret, {
          key: "uploads/x/original.png", maxSize: 5_000_000, contentType: "image/png",
          expiresAt: Date.now() + 60_000, diagramId: diagram.diagramId,
        }),
        bytes: PNG_BYTES,
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("invalid diagram: upload-url and processing on unknown ids 404", async () => {
    await expect(uploads.createUploadUrl(teacher, "missing")).rejects.toMatchObject({ code: "not_found" });
    await expect(uploads.startProcessing(teacher, "missing")).rejects.toMatchObject({ code: "not_found" });
    await expect(uploads.processingStatus(teacher, "missing")).rejects.toMatchObject({ code: "not_found" });
  });

  it("processing cannot start before upload; duplicate requests are rejected", async () => {
    const lesson = await lessons.createLesson(teacher, { title: "Heart" });
    const diagram = await uploads.registerDiagram(teacher, {
      lessonId: lesson.lessonId, sourceType: "upload", licenseName: "CC0", contentType: "image/png",
    });
    // Not uploaded yet -> conflict
    await expect(uploads.startProcessing(teacher, diagram.diagramId)).rejects.toMatchObject({ code: "conflict" });

    const grant = await uploads.createUploadUrl(teacher, diagram.diagramId, "image/png");
    const { verified } = await uploads.confirmLocalUpload(teacher, {
      diagramId: diagram.diagramId, key: grant.key, maxSize: grant.maxBytes,
      contentType: "image/png", expiresAt: grant.expiresAt,
      token: grant.fields["x-sahpaath-token"],
      bytes: PNG_BYTES,
    });
    expect(verified.mimeType).toBe("image/png");
    expect(verified.byteSize).toBe(PNG_BYTES.length);
    expect(verified.mode).toBe("local");
    // Bytes actually persisted by the local adapter:
    expect(existsSync(join(dir, grant.key))).toBe(true);
    expect(readFileSync(join(dir, grant.key)).equals(PNG_BYTES)).toBe(true);

    const first = await uploads.startProcessing(teacher, diagram.diagramId);
    expect(first.job.mode).toBe("local");
    // No OCR/Bedrock configured in this fixture: the proposal stage falls back
    // honestly and the run is recorded as failed (never faked as success).
    expect(first.job.status).toBe("failed");
    expect(first.job.stages.find((s) => s.name === "Semantic proposal")?.simulation).toBe(true);
    expect(first.diagram.processingStatus).toBe("failed");

    // Duplicate processing request -> 409
    await expect(uploads.startProcessing(teacher, diagram.diagramId)).rejects.toMatchObject({ code: "conflict" });
    // Status endpoint reflects the job and is honestly labeled local.
    const status = await uploads.processingStatus(teacher, diagram.diagramId);
    expect(status.mode).toBe("local");
    expect(status.activeJobId).toBe(first.job.jobId);
    expect(status.stages?.length).toBeGreaterThan(0);
  });

  it("audit events are recorded for register, upload, and processing", async () => {
    const lesson = await lessons.createLesson(teacher, { title: "Heart" });
    const diagram = await uploads.registerDiagram(teacher, {
      lessonId: lesson.lessonId, sourceType: "upload", licenseName: "CC0", contentType: "image/png",
    });
    const grant = await uploads.createUploadUrl(teacher, diagram.diagramId, "image/png");
    await uploads.confirmLocalUpload(teacher, {
      diagramId: diagram.diagramId, key: grant.key, maxSize: grant.maxBytes,
      contentType: "image/png", expiresAt: grant.expiresAt,
      token: grant.fields["x-sahpaath-token"], bytes: PNG_BYTES,
    });
    await uploads.startProcessing(teacher, diagram.diagramId);
    const events = await repos.audit.listForLesson(lesson.lessonId);
    const actions = events.map((e) => e.action);
    expect(actions).toContain("lesson_created");
    expect(actions).toContain("diagram_registered");
    expect(actions).toContain("diagram_uploaded");
    expect(actions).toContain("processing_started");
    // Every event carries actor + timestamp (structured, queryable).
    for (const e of events) {
      expect(e.actorId).toBe("teacher-local");
      expect(e.createdAt).toBeTruthy();
    }
  });

  it("jpeg uploads pass magic-byte verification when granted as jpeg", async () => {
    const lesson = await lessons.createLesson(teacher, { title: "Heart" });
    const diagram = await uploads.registerDiagram(teacher, {
      lessonId: lesson.lessonId, sourceType: "upload", licenseName: "CC0", contentType: "image/jpeg",
    });
    const grant = await uploads.createUploadUrl(teacher, diagram.diagramId, "image/jpeg");
    expect(grant.contentType).toBe("image/jpeg");
    const { verified } = await uploads.confirmLocalUpload(teacher, {
      diagramId: diagram.diagramId, key: grant.key, maxSize: grant.maxBytes,
      contentType: "image/jpeg", expiresAt: grant.expiresAt,
      token: grant.fields["x-sahpaath-token"], bytes: JPEG_BYTES,
    });
    expect(verified.mimeType).toBe("image/jpeg");
  });

  it("publish is blocked without license metadata (license gate)", async () => {
    const lesson = await lessons.createLesson(teacher, { title: "Heart" });
    // Forge a diagram row with missing license to prove the gate fires even
    // when a bad row exists (belt-and-braces beyond registration checks).
    const diagram = await uploads.registerDiagram(teacher, {
      lessonId: lesson.lessonId, sourceType: "upload", licenseName: "CC0", contentType: "image/png",
    });
    const badRow = { ...diagram, sourceMetadata: { ...diagram.sourceMetadata, licenseName: "" } };
    await repos.diagrams.put(badRow, diagram.revision);
    // Publish needs the real draft timestamp first (revision check precedes
    // the license gate), so fetch the draft through the service.
    const { version } = await lessons.draftVersion(teacher, diagram.diagramId);
    await expect(
      lessons.publish(teacher, { diagramId: diagram.diagramId, expectedVersionCreatedAt: version.createdAt }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("S3 presign adapter (unit, no network)", () => {
  it("local adapter grants always declare mode 'local' and embed verifiable tokens", async () => {
    const provider = new LocalPresignedUpload("secret");
    const grant = await provider.createGrant({
      diagramId: "d-123", contentType: "image/png", maxSize: 1234, expiresInSeconds: 60,
    });
    expect(grant.mode).toBe("local");
    expect(grant.url).toBe("/api/v1/uploads/local");
    expect(grant.key.startsWith("uploads/d-123/")).toBe(true);
    expect(grant.fields["x-sahpaath-max-size"]).toBe("1234");
    expect(grant.fields["x-sahpaath-expires-at"]).toBeTruthy();
    expect(grant.fields["x-sahpaath-token"]).toBeTruthy();
  });
});

describe("Multipart parser (local sink)", () => {
  function fakeRequest(body: Buffer, contentType: string): IncomingMessage {
    return Object.assign(
      (async function* () { yield body; })() as unknown as IncomingMessage,
      { headers: { "content-type": contentType } },
    );
  }

  it("parses fields and file parts from an S3-POST-shaped form", async () => {
    const boundary = "----sahpaath";
    const fields = {
      key: "uploads/d-1/original.png",
      "Content-Type": "image/png",
      "x-sahpaath-token": "abc123",
    };
    const parts: Buffer[] = [];
    for (const [name, value] of Object.entries(fields)) {
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ));
    }
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="heart.png"\r\nContent-Type: image/png\r\n\r\n`,
    ));
    parts.push(PNG_BYTES);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
    const body = Buffer.concat(parts);

    const form = await readMultipart(fakeRequest(body, `multipart/form-data; boundary=${boundary}`), 5_000_000);
    expect(form.fields).toMatchObject(fields);
    expect(form.files["file"].data.equals(PNG_BYTES)).toBe(true);
    expect(form.files["file"].contentType).toBe("image/png");
  });

  it("rejects missing boundary and oversized bodies", async () => {
    await expect(readMultipart(fakeRequest(Buffer.from("x"), "application/json"), 100)).rejects.toThrow(/boundary/);
    await expect(
      readMultipart(
        fakeRequest(Buffer.alloc(3000, 1), "multipart/form-data; boundary=b"),
        1000,
      ),
    ).rejects.toMatchObject({ code: "payload_too_large" });
  });
});
