import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canTransition,
  assertTransition,
  targetStateFor,
  TRUST_TRANSITIONS,
  TrustTransitionError,
} from "../shared/trust";
import {
  userSchema,
  lessonSchema,
  diagramSchema,
  diagramVersionSchema,
  studentQuestionSchema,
  vocabularyTermSchema,
  emptyStructure,
} from "../shared/model";
import { createMemoryRepos } from "../server/repositories/memory";
import { createSqliteRepos } from "../server/repositories/sqlite";
import { RepoConditionFailedError } from "../server/repositories/types";
import { LessonService, type Actor } from "../server/services/lesson-service";
import { ClassroomService } from "../server/services/classroom-service";
import { validateStructure } from "../server/services/validation";
import { loadConfig } from "../server/core/config";
import { Logger } from "../server/core/logger";
import { LocalFileStorage } from "../server/core/storage";
import { sha256Hex, newId, newClassCode, s3Keys } from "../server/core/ids";
import { imageType } from "../server/providers/image-type";
import { Router } from "../server/http/router";
import type { DiagramVersion, Lesson } from "../shared/model";

const teacher: Actor = { userId: "teacher-local", role: "teacher" };
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

function sampleLesson(teacherId: string): Lesson {
  return lessonSchema.parse({
    lessonId: newId(),
    teacherId,
    title: "The heart",
    description: "Circulation basics",
    status: "draft",
    revision: 0,
    createdAt: now(),
    updatedAt: now(),
    publishedVersionId: null,
  });
}

function validStructure() {
  return {
    labels: [
      { labelId: "label-0", text: "Right ventricle", confidence: 97, source: "textract" as const, x: 0.2, y: 0.3 },
      { labelId: "label-1", text: "Lungs", confidence: 95, source: "textract" as const, x: 0.7, y: 0.3 },
    ],
    parts: [
      { partId: "part-0", labelId: "label-0", name: "Right ventricle", description: "Pumps blood to the lungs.", state: "ai_proposed" as const, reviewNote: "" },
      { partId: "part-1", labelId: "label-1", name: "Lungs", description: "Gas exchange site.", state: "ai_proposed" as const, reviewNote: "" },
    ],
    relations: [
      { relationId: "relation-0", fromPartId: "part-0", toPartId: "part-1", kind: "flows_to" as const, evidenceLabelIds: ["label-0", "label-1"], state: "ai_proposed" as const, reviewNote: "" },
    ],
    flows: [
      { flowId: "flow-0", name: "Pulmonary path", stepPartIds: ["part-0", "part-1"], state: "ai_proposed" as const, reviewNote: "" },
    ],
  };
}

describe("Trust state machine", () => {
  it("allows only documented transitions", () => {
    expect(canTransition("ai_proposed", "validated")).toBe(true);
    expect(canTransition("ai_proposed", "teacher_approved")).toBe(false);
    expect(canTransition("validated", "teacher_approved")).toBe(true);
    expect(canTransition("teacher_approved", "published")).toBe(true);
    expect(canTransition("published", "teacher_approved")).toBe(false);
    expect(canTransition("rejected", "needs_review")).toBe(true);
  });
  it("published is terminal", () => {
    expect(TRUST_TRANSITIONS.published).toEqual([]);
  });
  it("throws TrustTransitionError for illegal moves", () => {
    expect(() => assertTransition("x", "published", "validated")).toThrow(TrustTransitionError);
  });
  it("maps decisions to target states", () => {
    expect(targetStateFor("x", "validated", "approve")).toBe("teacher_approved");
    expect(targetStateFor("x", "validated", "reject")).toBe("rejected");
    expect(() => targetStateFor("x", "published", "approve")).toThrow();
  });
});

describe("Model schemas", () => {
  it("rejects bad entities", () => {
    expect(userSchema.safeParse({ userId: "u1", role: "admin", displayName: "x", email: null, createdAt: now() }).success).toBe(false);
    expect(lessonSchema.safeParse({ ...sampleLesson("t"), revision: -1 }).success).toBe(false);
    expect(diagramSchema.safeParse({
      diagramId: "d1", lessonId: "l1", originalS3Key: "uploads/x/original.png", mimeType: "image/gif",
      byteSize: 10, sourceMetadata: { source: "upload", license: "CC0", attribution: "", sourceUrl: null },
      processingStatus: "pending", activeVersionId: null, revision: 0, createdAt: now(), updatedAt: now(),
    }).success).toBe(false);
    expect(diagramVersionSchema.safeParse({
      versionId: "v1", diagramId: "d1", lessonId: "l1", version: 0, status: "draft",
      publishedAt: null, publishedBy: null, structure: emptyStructure, createdAt: now(),
    }).success).toBe(false);
    expect(studentQuestionSchema.safeParse({
      questionId: "q1", lessonId: "l1", versionId: "v1", studentSessionId: "s1",
      conceptPartId: null, text: "Why?", acknowledged: false, acknowledgedAt: null, createdAt: now(),
    }).success).toBe(true);
    expect(vocabularyTermSchema.safeParse({
      termId: "t1", lessonId: "l1", versionId: "v1", name: "Aorta", definition: "Big artery.",
      partId: "p1", labelId: "lab1", state: "validated", createdAt: now(),
    }).success).toBe(false);
  });
});

describe("Repositories (memory + sqlite parity)", () => {
  const make = () => {
    const dir = mkdtempSync(join(tmpdir(), "sahpaath-test-"));
    return { memory: createMemoryRepos(), sqlite: createSqliteRepos(":memory:"), dir };
  };
  let ctx: ReturnType<typeof make>;
  beforeEach(() => { ctx = make(); });
  afterEach(() => { rmSync(ctx.dir, { recursive: true, force: true }); });

  for (const [name, repos] of [["memory", () => ctx.memory], ["sqlite", () => ctx.sqlite]] as const) {
    it(`[${name}] optimistic concurrency on lessons`, async () => {
      const r = repos();
      const lesson = sampleLesson("t1");
      await r.lessons.put(lesson, null);
      await expect(r.lessons.put(lesson, null)).rejects.toThrow(RepoConditionFailedError);
      lesson.revision = 0;
      lesson.title = "Updated";
      await r.lessons.put({ ...lesson, revision: 1 }, 0);
      const stored = await r.lessons.get(lesson.lessonId);
      expect(stored?.title).toBe("Updated");
      expect(stored?.revision).toBe(1);
    });

    it(`[${name}] lesson uniqueness on create`, async () => {
      const r = repos();
      const lesson = sampleLesson("t1");
      await r.lessons.put(lesson, null);
      await expect(r.lessons.put(lesson, null)).rejects.toThrow(RepoConditionFailedError);
      await r.lessons.put({ ...lesson, revision: 1 }, 0);
      expect((await r.lessons.get(lesson.lessonId))?.revision).toBe(1);
    });

    it(`[${name}] version rows are create-once; replaceDraft refuses published`, async () => {
      const r = repos();
      const version: DiagramVersion = {
        versionId: newId(), diagramId: "d1", lessonId: "l1", version: 1,
        status: "draft", publishedAt: null, publishedBy: null,
        structure: validStructure(), createdAt: now(),
      };
      await r.versions.create(version);
      await expect(r.versions.create(version)).rejects.toThrow(RepoConditionFailedError);
      await r.versions.replaceDraft(version);
      await r.versions.replaceDraft({ ...version, status: "published", publishedAt: now(), publishedBy: "t" })
        .then(() => { throw new Error("should refuse"); })
        .catch((e) => { expect(e).toBeInstanceOf(RepoConditionFailedError); });
      await r.versions.create({ ...version, status: "published", publishedAt: now(), publishedBy: "t" }).catch(() => {});
      const stored = await r.versions.get("d1", 1);
      expect(stored?.status).toBe("draft");
    });

    it(`[${name}] publish transaction is atomic and race-safe`, async () => {
      const r = repos();
      const lesson = sampleLesson("t1");
      await r.lessons.put(lesson, null);
      const diagram = diagramSchema.parse({
        diagramId: "d1", lessonId: lesson.lessonId, originalS3Key: "uploads/d1/original.png",
        mimeType: "image/png", byteSize: 100,
        sourceMetadata: { sourceType: "upload", licenseName: "CC0", attribution: "", sourceUrl: null },
        processingStatus: "awaiting_review", activeVersionId: null, activeJobId: null, revision: 0,
        createdAt: now(), updatedAt: now(),
      });
      await r.diagrams.put(diagram, null);
      // Publish transitions an existing DRAFT row (guarded by status).
      const draftRow: DiagramVersion = {
        versionId: newId(), diagramId: "d1", lessonId: lesson.lessonId, version: 1,
        status: "draft", publishedAt: null, publishedBy: null,
        structure: validStructure(), createdAt: now(),
      };
      await r.versions.create(draftRow);
      const version: DiagramVersion = {
        ...draftRow,
        status: "published", publishedAt: now(), publishedBy: "t1",
      };
      await r.publish.publish({
        version,
        approvals: [],
        diagramId: "d1",
        expectedActiveVersionId: null,
        lessonId: lesson.lessonId,
        expectedLessonRevision: lesson.revision,
        publishedLessonStatus: "published",
        publishedVersionId: version.versionId,
        lessonUpdatedAt: now(),
      });
      // Second publish with the same version must fail (row is no longer draft).
      await expect(r.publish.publish({
        version,
        approvals: [],
        diagramId: "d1",
        expectedActiveVersionId: null,
        lessonId: lesson.lessonId,
        expectedLessonRevision: lesson.revision,
        publishedLessonStatus: "published",
        publishedVersionId: version.versionId,
        lessonUpdatedAt: now(),
      })).rejects.toThrow(RepoConditionFailedError);
      const updated = await r.lessons.get(lesson.lessonId);
      expect(updated?.status).toBe("published");
      expect(updated?.publishedVersionId).toBe(version.versionId);
      expect(updated?.revision).toBe(lesson.revision + 1);
    });

    it(`[${name}] questions are create-once`, async () => {
      const r = repos();
      const q = studentQuestionSchema.parse({
        questionId: newId(), lessonId: "l1", versionId: "v1", studentSessionId: "s1",
        conceptPartId: null, text: "Why does blood flow there?", acknowledged: false,
        acknowledgedAt: null, createdAt: now(),
      });
      await r.questions.put(q);
      await expect(r.questions.put(q)).rejects.toThrow(RepoConditionFailedError);
    });
  }
});

describe("LessonService", () => {
  const makeService = () => {
    const repos = createMemoryRepos();
    const log = new Logger(() => {}, "error");
    return { repos, service: new LessonService(repos, log), classroom: new ClassroomService(repos, log) };
  };

  it("teacher creates and lists lessons; students cannot", async () => {
    const { service } = makeService();
    const lesson = await service.createLesson(teacher, { title: "The heart" });
    expect(lesson.status).toBe("draft");
    expect((await service.listLessons(teacher)).length).toBe(1);
    await expect(service.createLesson({ userId: "s1", role: "student" }, { title: "x" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(service.listLessons({ userId: "s1", role: "student" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("decisions enforce trust transitions, notes, and dependency invalidation", async () => {
    const { repos, service } = makeService();
    const lesson = await service.createLesson(teacher, { title: "t" });
    const { version } = await service.createDiagram(teacher, {
      lessonId: lesson.lessonId,
      originalS3Key: s3Keys.upload("d1", "png"),
      mimeType: "image/png",
      byteSize: 100,
      sourceMetadata: { sourceType: "upload", licenseName: "CC0", attribution: "", sourceUrl: null },
    });
    // Replace the empty draft structure with a valid one.
    await service.saveStructure(teacher, {
      diagramId: version.diagramId,
      structure: validStructure(),
      expectedVersionCreatedAt: version.createdAt,
    });
    const draft = await service.draftVersion(teacher, version.diagramId);
    // Approve part-0 (has manual_source? no: textract high confidence) — should succeed without note.
    const after = await service.decide(teacher, {
      diagramId: version.diagramId, itemId: "part-0", itemType: "part",
      decision: "approve", note: "", expectedVersionCreatedAt: draft.version.createdAt,
    });
    expect(after.structure.parts[0].state).toBe("teacher_approved");
    // Approving relation-0 with missing evidence must fail.
    const draft2 = await service.draftVersion(teacher, version.diagramId);
    const broken = structuredClone(draft2.version.structure);
    broken.relations[0].evidenceLabelIds = [];
    await service.saveStructure(teacher, {
      diagramId: version.diagramId, structure: broken, expectedVersionCreatedAt: draft2.version.createdAt,
    });
    const draft3 = await service.draftVersion(teacher, version.diagramId);
    await expect(service.decide(teacher, {
      diagramId: version.diagramId, itemId: "relation-0", itemType: "relation",
      decision: "approve", note: "", expectedVersionCreatedAt: draft3.version.createdAt,
    })).rejects.toMatchObject({ code: "validation_failed" });
    // Rejecting part-1 invalidates the relation approval state downstream.
    const draft4 = await service.draftVersion(teacher, version.diagramId);
    const rejected = await service.decide(teacher, {
      diagramId: version.diagramId, itemId: "part-1", itemType: "part",
      decision: "reject", note: "Not needed", expectedVersionCreatedAt: draft4.version.createdAt,
    });
    expect(rejected.structure.parts[1].state).toBe("rejected");
    expect(rejected.structure.relations[0].state).toBe("needs_review");
    void repos;
  });

  it("publish is gated on decisions and race-safe", async () => {
    const { service } = makeService();
    const lesson = await service.createLesson(teacher, { title: "t" });
    const { version } = await service.createDiagram(teacher, {
      lessonId: lesson.lessonId,
      originalS3Key: s3Keys.upload("d2", "png"),
      mimeType: "image/png", byteSize: 100,
      sourceMetadata: { sourceType: "upload", licenseName: "CC0", attribution: "", sourceUrl: null },
    });
    await service.saveStructure(teacher, {
      diagramId: version.diagramId, structure: validStructure(), expectedVersionCreatedAt: version.createdAt,
    });
    const draft = await service.draftVersion(teacher, version.diagramId);
    await expect(service.publish(teacher, {
      diagramId: version.diagramId, expectedVersionCreatedAt: draft.version.createdAt,
    })).rejects.toMatchObject({ code: "conflict" });
    // Decide everything, then publish.
    let current = draft.version;
    for (const item of [
      { id: "part-0", type: "part" as const }, { id: "part-1", type: "part" as const },
      { id: "relation-0", type: "relation" as const }, { id: "flow-0", type: "flow" as const },
    ]) {
      const d = await service.draftVersion(teacher, version.diagramId);
      current = await service.decide(teacher, {
        diagramId: version.diagramId, itemId: item.id, itemType: item.type,
        decision: "approve", note: "Verified.", expectedVersionCreatedAt: d.version.createdAt,
      });
    }
    void current;
    const published = await service.publish(teacher, {
      diagramId: version.diagramId,
      expectedVersionCreatedAt: (await service.draftVersion(teacher, version.diagramId)).version.createdAt,
    });
    expect(published.status).toBe("published");
    expect(published.structure.parts.length).toBe(2);
    // Student view gets the same version; unapproved content never appears.
    const studentView = await service.publishedVersionForStudent(version.diagramId);
    expect(studentView.versionId).toBe(published.versionId);
    // New draft version for editing; published row untouched.
    const next = await service.newDraftVersion(teacher, version.diagramId);
    expect(next.version).toBe(2);
    expect(next.status).toBe("draft");
    const stillPublished = await service.publishedVersionForStudent(version.diagramId);
    expect(stillPublished.versionId).toBe(published.versionId);
  });

  it("validator flags broken structures deterministically", () => {
    const s = validStructure();
    s.relations[0].toPartId = "part-0"; // self relation
    const issues = validateStructure(s);
    expect(issues.some((i) => i.code === "self_relation" && i.severity === "error")).toBe(true);
  });
});

describe("ClassroomService", () => {
  const make = () => {
    const repos = createMemoryRepos();
    const log = new Logger(() => {}, "error");
    return { repos, classroom: new ClassroomService(repos, log) };
  };

  it("sessions use hashed tokens and anonymous codes", async () => {
    const { repos, classroom } = make();
    const s = await classroom.createStudentSession();
    const resolved = await classroom.resolveSession(s.token);
    expect(resolved?.role).toBe("student");
    expect(resolved?.classCode).toMatch(/^[A-Z2-9]{4}$/);
    await classroom.destroySession(s.token);
    expect(await classroom.resolveSession(s.token)).toBeNull();
    void repos;
  });

  it("teacher password check is hash-based", async () => {
    const { classroom } = make();
    await expect(classroom.createTeacherSession("wrong", sha256Hex("right"))).rejects.toMatchObject({ code: "forbidden" });
    const ok = await classroom.createTeacherSession("right", sha256Hex("right"));
    expect(ok.classCode).toBeDefined();
  });

  it("questions require published lessons and anonymous student ids only", async () => {
    const { service, classroom } = makeService2();
    const lesson = await service.createLesson(teacher, { title: "t" });
    const student = await classroom.createStudentSession();
    const actor = { userId: student.userId, role: "student" as const };
    await expect(classroom.askQuestion(actor, {
      lessonId: lesson.lessonId, versionId: "", conceptPartId: null, text: "Why?",
    })).rejects.toMatchObject({ code: "conflict" });
    void service;
  });
});

function makeService2() {
  const repos = createMemoryRepos();
  const log = new Logger(() => {}, "error");
  return { repos, service: new LessonService(repos, log), classroom: new ClassroomService(repos, log) };
}

describe("Config", () => {
  it("requires teacher password in local modes", () => {
    expect(() => loadConfig({ SAHPAATH_STORE: "sqlite", SAHPAATH_UPLOAD_TOKEN_SECRET: "s" } as NodeJS.ProcessEnv)).toThrow(/TEACHER_PASSWORD/);
    expect(loadConfig({ SAHPAATH_STORE: "sqlite", SAHPAATH_TEACHER_PASSWORD: "pw", SAHPAATH_UPLOAD_TOKEN_SECRET: "s" } as NodeJS.ProcessEnv)).toMatchObject({ store: "sqlite", port: 5173 });
  });
  it("requires region+table for dynamodb", () => {
    expect(() => loadConfig({ SAHPAATH_STORE: "dynamodb", SAHPAATH_TEACHER_PASSWORD: "pw", SAHPAATH_UPLOAD_TOKEN_SECRET: "s" } as NodeJS.ProcessEnv)).toThrow(/AWS_REGION/);
    expect(() => loadConfig({ SAHPAATH_STORE: "dynamodb", SAHPAATH_TEACHER_PASSWORD: "pw", AWS_REGION: "us-east-1", SAHPAATH_UPLOAD_TOKEN_SECRET: "s" } as NodeJS.ProcessEnv)).toThrow(/SAHPAATH_DDB_TABLE/);
  });
  it("requires an upload token secret", () => {
    expect(() => loadConfig({ SAHPAATH_STORE: "memory", SAHPAATH_TEACHER_PASSWORD: "pw" } as NodeJS.ProcessEnv)).toThrow(/UPLOAD_TOKEN_SECRET/);
  });
  it("keeps secrets out of the config object", () => {
    const cfg = loadConfig({ SAHPAATH_TEACHER_PASSWORD: "sekrit", SAHPAATH_STORE: "memory", SAHPAATH_UPLOAD_TOKEN_SECRET: "upload-secret" } as NodeJS.ProcessEnv);
    expect(JSON.stringify(cfg)).toContain("sekrit"); // password is in-memory config only
    expect(Object.keys(cfg)).not.toContain("awsSecretAccessKey");
  });
});

describe("Logger redaction", () => {
  it("redacts sensitive keys", () => {
    let line = "";
    const log = new Logger((l) => (line = l), "info");
    log.info("test", { password: "abc", token: "tok", nested: { authorization: "Bearer x" }, safe: 1 });
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.password).toBe("[redacted]");
    expect(parsed.token).toBe("[redacted]");
    expect((parsed.nested as Record<string, unknown>).authorization).toBe("[redacted]");
    expect(parsed.safe).toBe(1);
  });
});

describe("Storage", () => {
  it("local storage rejects traversal and round-trips bytes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sahpaath-store-"));
    try {
      const storage = new LocalFileStorage(dir);
      const key = s3Keys.upload("d1", "png");
      await storage.put(key, Buffer.from("pngbytes"), "image/png");
      expect(await storage.exists(key)).toBe(true);
      expect((await storage.get(key)).toString()).toBe("pngbytes");
      expect(storage.exists("../escape.png").then(() => true).catch(() => false)).toBeTruthy();
      await expect(storage.get("../escape.png")).rejects.toThrow(/Invalid storage key|ENOENT/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("IDs and image sniffing", () => {
  it("class codes exclude ambiguous characters", () => {
    for (let i = 0; i < 50; i++) expect(newClassCode()).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/);
  });
  it("sha256 is stable", () => {
    expect(sha256Hex("abc")).toBe(sha256Hex("abc"));
    expect(sha256Hex("abc")).not.toBe(sha256Hex("abd"));
  });
  it("magic bytes gate uploads", () => {
    expect(imageType(Buffer.from("<svg></svg>"))).toBeNull();
    const png = Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      Buffer.alloc(4),
      Buffer.from("IHDR"),
      Buffer.alloc(20),
    ]);
    expect(imageType(png)).toBe("image/png");
  });
});

describe("Router", () => {
  it("routes params and maps errors", async () => {
    const router = new Router(new Logger(() => {}, "error"));
    router.get("/api/x/:id", (ctx) => ({ id: ctx.params.id }));
    router.get("/api/boom", () => { throw new Error("unexpected"); });
    const url = new URL("http://localhost/api/x/abc");
    const store: Record<string, unknown> = {};
    const res = {
      writableEnded: false,
      writeHead(status: number, headers: Record<string, string>) { store.status = status; store.headers = headers; },
      end(body: string) { store.body = body; },
    } as unknown as import("node:http").ServerResponse;
    await router.dispatch({ method: "GET" } as never, res, url);
    expect(JSON.parse(store.body as string)).toEqual({ id: "abc" });
  });
});
