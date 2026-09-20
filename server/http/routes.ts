import { z } from "zod";
import { Router } from "./router";
import { clientKey, rateLimit, readJson, requireSession, requireTeacher, readSessionCookie, type AuthResolver } from "./context";
import { json } from "./router";
import { requireAdmin, requireAuth, type AuthComponents, type Principal } from "./auth";
import { forbiddenError } from "../core/errors";
import type { LessonService, Actor } from "../services/lesson-service";
import type { ClassroomService } from "../services/classroom-service";
import { sha256Hex } from "../core/ids";
import { entityId, isoTimestamp } from "../../shared/model";
import { appRoleSchema } from "../../shared/schema";
import { notFoundError, validationError } from "../core/errors";
import type { BinaryStorage } from "../core/storage";
import type { AppConfig } from "../core/config";
import type { AppUser } from "../../shared/schema";
import type { DiagramUploadService } from "../services/diagram-upload-service";
import type { DiagramSenseService } from "../services/diagram-sense-service";
import { readMultipart } from "./multipart";

const teacherPasswordSchema = z
  .object({ role: z.literal("teacher"), password: z.string().min(1).max(200) })
  .strict();
const studentLoginSchema = z.object({ role: z.literal("student") }).strict();

const lessonInput = z
  .object({ title: z.string().trim().min(1).max(140), description: z.string().trim().max(2000).optional() })
  .strict();

const diagramInput = z
  .object({
    lessonId: entityId,
    title: z.string().trim().min(1).max(140).optional(),
    mime: z.enum(["image/png", "image/jpeg"]),
    base64: z.string().min(1).max(6_700_000),
    source: z.enum(["upload", "fixture", "public_domain"]).default("upload"),
    license: z.string().trim().min(1).max(120).default("proprietary"),
    attribution: z.string().trim().max(500).default(""),
    sourceUrl: z.string().url().max(500).nullable().default(null),
  })
  .strict();

/** Register-diagram input for the direct-upload flow (metadata only, no bytes). */
const diagramRegisterInput = z
  .object({
    sourceType: z.string().trim().min(1).max(80),
    licenseName: z.string().trim().min(1).max(120),
    attribution: z.string().trim().max(500).default(""),
    sourceUrl: z.string().url().max(500).nullable().default(null),
    /** Declared type for the presigned grant; verified again by magic bytes. */
    contentType: z.enum(["image/png", "image/jpeg"]),
  })
  .strict();

/** Upload-url grant input; contentType optional (defaults to image/png). */
const uploadUrlInput = z
  .object({ contentType: z.enum(["image/png", "image/jpeg"]).optional() })
  .strict();

const structureInput = z
  .object({
    diagramId: entityId,
    expectedVersionCreatedAt: isoTimestamp,
    structure: z.object({
      labels: z.array(z.record(z.string(), z.unknown())).max(100),
      parts: z.array(z.record(z.string(), z.unknown())).max(60),
      relations: z.array(z.record(z.string(), z.unknown())).max(120),
      flows: z.array(z.record(z.string(), z.unknown())).max(20),
    }).strict(),
  })
  .strict();

const decisionInput = z
  .object({
    diagramId: entityId,
    itemId: entityId,
    itemType: z.enum(["part", "relation", "flow"]),
    decision: z.enum(["approve", "reject"]),
    note: z.string().max(1000).default(""),
    expectedVersionCreatedAt: isoTimestamp,
  })
  .strict();

const publishInput = z
  .object({ diagramId: entityId, expectedVersionCreatedAt: isoTimestamp })
  .strict();

const questionInput = z
  .object({
    lessonId: entityId,
    conceptPartId: entityId.nullable(),
    text: z.string().trim().min(1).max(500),
  })
  .strict();

const captionSessionInput = z
  .object({ lessonId: entityId, mode: z.enum(["loaded", "manual"]) })
  .strict();

const segmentInput = z
  .object({ sessionId: entityId, text: z.string().trim().min(1).max(4000) })
  .strict();

const correctInput = z
  .object({ sessionId: entityId, segmentId: entityId, heard: z.string().trim().min(1).max(120), termPartId: entityId })
  .strict();

export interface RouteDeps {
  /** Supabase bearer + cookie authentication components. */
  appAuth: AuthComponents;
  listAppUsers: () => AppUser[] | Promise<AppUser[]>;
  findAppUser: (id: string) => AppUser | undefined | Promise<AppUser | undefined>;
  setAppUserRole: (id: string, role: AppUser["role"]) => AppUser | Promise<AppUser>;
  auditAdmin: (
    action: string,
    detail: string,
    actorUserId: string,
    extra?: { targetUserId: string; previousRole: string; newRole: string },
  ) => void;
  lessons: LessonService;
  classroom: ClassroomService;
  uploads: DiagramUploadService;
  sense: DiagramSenseService;
  auth: AuthResolver;
  teacherPasswordHash: string;
  storage: BinaryStorage;
  config: AppConfig;
  /** Optional local bridge: accept legacy-store tokens for v1 routes. */
  legacyAuth?: AuthResolver;
  mirrorSession?: (token: string, role: "teacher" | "student", code: string) => void;
  revokeLegacySession?: (token: string) => void;
}

export function registerRoutes(router: Router, deps: RouteDeps): Router {
  const { lessons, classroom, uploads, sense } = deps;

  /** Session resolution for v1: core store first, then the optional legacy bridge. */
  const auth: AuthResolver = async (token, req) =>
    (await deps.auth(token, req)) ??
    // Bearer tokens skip the legacy cookie bridge by design: a Supabase
    // identity is authoritative and must not fall back to an anonymous
    // classroom session.
    (!req || !req.headers.authorization
      ? deps.legacyAuth
        ? await deps.legacyAuth(token)
        : null
      : null);

  /* --------------------------------- Health --------------------------------- */

  router.get("/api/v1/health", () => ({
    mode: deps.config.store,
    awsConnected: deps.config.store === "dynamodb",
  }));

  /* --------------------------------- Session -------------------------------- */

  router.post("/api/v1/session", async (ctx) => {
    rateLimit(`login:${clientKey(ctx.req)}`, 20);
    const body = await readJson(ctx.req, z.union([teacherPasswordSchema, studentLoginSchema]));
    const result =
      body.role === "teacher"
        ? await classroom.createTeacherSession(body.password, deps.teacherPasswordHash)
        : await classroom.createStudentSession();
    deps.mirrorSession?.(result.token, body.role, result.classCode);
    ctx.res.setHeader(
      "Set-Cookie",
      `sahpaath=${result.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`,
    );
    return { role: body.role, code: result.classCode };
  });

  router.get("/api/v1/session", async (ctx) => {
    const session = await requireSession(ctx.req, auth);
    return { role: session.actor.role, code: session.classCode };
  });

  router.delete("/api/v1/session", async (ctx) => {
    const token = readSessionCookie(ctx.req);
    if (token) {
      await classroom.destroySession(token);
      deps.revokeLegacySession?.(token);
    }
    ctx.res.setHeader("Set-Cookie", "sahpaath=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
    return { ok: true };
  });

  /* ------------------------------ Current user ------------------------------ */

  /**
   * The signed-in account: full application user for Supabase identities.
   * Cookie sessions keep their existing shape (role + class code), so the
   * current frontend contract is untouched.
   */
  router.get("/api/v1/me", async (ctx) => {
    const principal = await requireAuth(ctx.req, deps.appAuth);
    if (principal.via === "supabase") {
      const user = await deps.findAppUser(principal.userId);
      if (!user) throw notFoundError("Application user not found.");
      return { kind: "app" as const, user, supabaseConfigured: true };
    }
    return { kind: "local" as const, user: null, supabaseConfigured: !!deps.appAuth.supabase };
  });

  /* --------------------------- Admin: user roles --------------------------- */

  /** Application users are a Supabase-bearer concept; role data is app-DB only. */
  const requireBearerAdmin = async (ctx: { req: import("node:http").IncomingMessage }) => {
    const principal = await requireAdmin(ctx.req, deps.appAuth);
    if (principal.via !== "supabase")
      throw forbiddenError("Admin APIs require a Supabase authenticated administrator.");
    return principal;
  };

  router.get("/api/v1/admin/users", async (ctx) => {
    await requireBearerAdmin(ctx);
    return deps.listAppUsers();
  });

  const roleChangeInput = z
    .object({ role: appRoleSchema })
    .strict();

  router.patch("/api/v1/admin/users/:userId/role", async (ctx) => {
    const admin = await requireBearerAdmin(ctx);
    const input = await readJson(ctx.req, roleChangeInput);
    if (ctx.params.userId === admin.userId)
      throw forbiddenError("Administrators cannot change their own role.");
    const target = await deps.findAppUser(ctx.params.userId);
    if (!target) throw notFoundError("User not found.");
    // No self-service promotion: an ADMIN grant can only come from another
    // admin (or the bootstrap allowlist), never from the target themselves.
    const updated = await deps.setAppUserRole(ctx.params.userId, input.role);
    deps.auditAdmin("role_changed", `Role of user ${updated.email} changed to ${input.role}.`, admin.userId, {
      targetUserId: updated.id,
      previousRole: target.role,
      newRole: updated.role,
    });
    return updated;
  });

  /* --------------------------------- Lessons -------------------------------- */

  router.post("/api/v1/lessons", async (ctx) => {
    const teacher = await requireTeacher(ctx.req, auth);
    const input = await readJson(ctx.req, lessonInput);
    return lessons.createLesson(teacher.actor, input);
  });

  router.get("/api/v1/lessons", async (ctx) => {
    const teacher = await requireTeacher(ctx.req, auth);
    return lessons.listLessons(teacher.actor);
  });

  router.get("/api/v1/lessons/:lessonId", async (ctx) => {
    const teacher = await requireTeacher(ctx.req, auth);
    return lessons.getLesson(teacher.actor, ctx.params.lessonId);
  });

  /* --------------------------------- Diagrams -------------------------------- */

  router.get("/api/v1/lessons/:lessonId/diagrams", async (ctx) => {
    const teacher = await requireTeacher(ctx.req, auth);
    await lessons.getLesson(teacher.actor, ctx.params.lessonId); // ownership check
    return lessons.listDiagramsForLesson(ctx.params.lessonId);
  });

  router.get("/api/v1/diagrams/:diagramId", async (ctx) => {
    const teacher = await requireTeacher(ctx.req, auth);
    return lessons.getDiagram(teacher.actor, ctx.params.diagramId);
  });

  /* --------------------------- Direct upload flow ---------------------------- */

  /**
   * POST /api/v1/lessons/:lessonId/diagrams — register metadata only; the
   * image bytes arrive later via the presigned upload. License metadata is
   * required up front so nothing unsigned can even start the flow.
   */
  router.post("/api/v1/lessons/:lessonId/diagrams", async (ctx) => {
    const teacher = await requireTeacher(ctx.req, auth);
    const input = await readJson(ctx.req, diagramRegisterInput);
    const diagram = await uploads.registerDiagram(teacher.actor, {
      lessonId: ctx.params.lessonId,
      sourceType: input.sourceType,
      licenseName: input.licenseName,
      attribution: input.attribution,
      sourceUrl: input.sourceUrl,
      contentType: input.contentType,
    });
    return json(ctx.res, diagram, 201);
  });

  /** POST /api/v1/diagrams/:id/upload-url — grant a direct-upload form. */
  router.post("/api/v1/diagrams/:diagramId/upload-url", async (ctx) => {
    const teacher = await requireTeacher(ctx.req, auth);
    const input = await readJson(ctx.req, uploadUrlInput);
    const grant = await uploads.createUploadUrl(teacher.actor, ctx.params.diagramId, input.contentType);
    ctx.log.info("upload.granted", {
      diagramId: ctx.params.diagramId,
      mode: grant.mode,
      contentType: grant.contentType,
      maxBytes: grant.maxBytes,
      expiresAt: new Date(grant.expiresAt).toISOString(),
    });
    return json(ctx.res, grant, 201);
  });

  /**
   * POST /api/v1/uploads/local — LOCAL adapter sink. Only reachable when no
   * S3 bucket is configured; emulates S3 POST field enforcement with an HMAC
   * grant and always reports mode "local". Never presented as AWS success.
   */
  router.post("/api/v1/uploads/local", async (ctx) => {
    if (deps.config.s3Bucket)
      throw notFoundError("Local uploads are disabled when S3 is configured.");
    const teacher = await requireTeacher(ctx.req, auth);
    rateLimit(`upload:${clientKey(ctx.req)}`, 30);
    const form = await readMultipart(ctx.req, deps.config.maxUploadBytes);
    const f = form.fields;
    const file = form.files["file"];
    if (!file)
      throw validationError("The multipart form must include a file field named 'file'.");
    const result = await uploads.confirmLocalUpload(teacher.actor, {
      diagramId: f["x-sahpaath-diagram-id"] ?? "",
      key: f.key ?? "",
      maxSize: Number(f["x-sahpaath-max-size"]),
      contentType: f["Content-Type"] ?? "",
      expiresAt: Number(f["x-sahpaath-expires-at"]),
      token: f["x-sahpaath-token"] ?? "",
      bytes: file.data,
    });
    ctx.log.info("upload.confirmed_local", {
      diagramId: result.diagram.diagramId,
      key: result.diagram.originalS3Key,
      mimeType: result.verified.mimeType,
      byteSize: result.verified.byteSize,
      mode: "local",
    });
    return json(ctx.res, { mode: "local", diagram: result.diagram }, 201);
  });

  /** POST /api/v1/diagrams/:id/process — start the pipeline exactly once. */
  router.post("/api/v1/diagrams/:diagramId/upload-complete", async (ctx) => {
    const teacher = await requireTeacher(ctx.req, auth);
    const input = await readJson(ctx.req, z.object({
      key: z.string().min(1).max(500), maxSize: z.number().int().positive().max(5_000_000),
      contentType: z.enum(["image/png", "image/jpeg"]), expiresAt: z.number().int().positive(),
      token: z.string().regex(/^[a-f0-9]{64}$/),
    }).strict());
    return uploads.confirmS3Upload(teacher.actor, { ...input, diagramId: ctx.params.diagramId });
  });

  router.post("/api/v1/diagrams/:diagramId/process", async (ctx) => {
    const teacher = await requireTeacher(ctx.req, auth);
    const result = await uploads.startProcessing(teacher.actor, ctx.params.diagramId);
    ctx.log.info("processing.requested", {
      diagramId: ctx.params.diagramId,
      jobId: result.job.jobId,
      mode: result.job.mode,
    });
    return json(ctx.res, result, 201);
  });

  /** GET /api/v1/diagrams/:id/processing-status — poll job + stages. */
  router.get("/api/v1/diagrams/:diagramId/processing-status", async (ctx) => {
    const teacher = await requireTeacher(ctx.req, auth);
    return uploads.processingStatus(teacher.actor, ctx.params.diagramId);
  });

  /** GET /api/v1/diagrams/:id/draft — OCR labels + proposed structure for review. */
  router.get("/api/v1/diagrams/:diagramId/draft", async (ctx) => {
    const teacher = await requireTeacher(ctx.req, auth);
    return sense.draftWithLabels(teacher.actor, ctx.params.diagramId);
  });

  /* ---------------------------- Versions & decisions ------------------------- */

  router.get("/api/v1/diagrams/:diagramId/versions", async (ctx) => {
    const teacher = await requireTeacher(ctx.req, auth);
    return lessons.listVersions(teacher.actor, ctx.params.diagramId);
  });

  router.post("/api/v1/diagrams/:diagramId/structure", async (ctx) => {
    const teacher = await requireTeacher(ctx.req, auth);
    const input = await readJson(ctx.req, structureInput);
    return lessons.saveStructure(teacher.actor, {
      diagramId: ctx.params.diagramId === input.diagramId ? input.diagramId : ctx.params.diagramId,
      structure: input.structure as never,
      expectedVersionCreatedAt: input.expectedVersionCreatedAt,
    });
  });

  router.post("/api/v1/diagrams/:diagramId/decision", async (ctx) => {
    const teacher = await requireTeacher(ctx.req, auth);
    const input = await readJson(ctx.req, decisionInput);
    return lessons.decide(teacher.actor, {
      diagramId: ctx.params.diagramId,
      itemId: input.itemId,
      itemType: input.itemType,
      decision: input.decision,
      note: input.note,
      expectedVersionCreatedAt: input.expectedVersionCreatedAt,
    });
  });

  router.post("/api/v1/diagrams/:diagramId/publish", async (ctx) => {
    const teacher = await requireTeacher(ctx.req, auth);
    const input = await readJson(ctx.req, publishInput);
    return lessons.publish(teacher.actor, {
      diagramId: ctx.params.diagramId,
      expectedVersionCreatedAt: input.expectedVersionCreatedAt,
    });
  });

  router.post("/api/v1/diagrams/:diagramId/versions", async (ctx) => {
    const teacher = await requireTeacher(ctx.req, auth);
    return lessons.newDraftVersion(teacher.actor, ctx.params.diagramId);
  });

  /* ------------------------------ Student surface ---------------------------- */

  router.get("/api/v1/published/:diagramId", async (ctx) => {
    await requireSession(ctx.req, auth);
    return lessons.publishedVersionForStudent(ctx.params.diagramId);
  });

  /* -------------------------------- Questions -------------------------------- */

  router.post("/api/v1/questions", async (ctx) => {
    const session = await requireSession(ctx.req, auth);
    rateLimit(`question:${session.actor.userId}`, 30);
    const input = await readJson(ctx.req, questionInput);
    return classroom.askQuestion(session.actor, {
      lessonId: input.lessonId,
      versionId: "",
      conceptPartId: input.conceptPartId,
      text: input.text,
    });
  });

  router.get("/api/v1/lessons/:lessonId/questions", async (ctx) => {
    const teacher = await requireTeacher(ctx.req, auth);
    return classroom.listQuestions(teacher.actor, ctx.params.lessonId);
  });

  router.post("/api/v1/questions/:questionId/acknowledge", async (ctx) => {
    const teacher = await requireTeacher(ctx.req, auth);
    await classroom.acknowledgeQuestion(teacher.actor, ctx.params.questionId);
    return { ok: true };
  });

  /* --------------------------------- Captions -------------------------------- */

  router.post("/api/v1/caption-sessions", async (ctx) => {
    const teacher = await requireTeacher(ctx.req, auth);
    const input = await readJson(ctx.req, captionSessionInput);
    return classroom.startCaptionSession(teacher.actor, input);
  });

  router.post("/api/v1/caption-sessions/:sessionId/segments", async (ctx) => {
    const teacher = await requireTeacher(ctx.req, auth);
    const input = await readJson(ctx.req, segmentInput);
    return classroom.addSegment(teacher.actor, { sessionId: ctx.params.sessionId, text: input.text });
  });

  router.get("/api/v1/caption-sessions/:sessionId/segments", async (ctx) => {
    await requireSession(ctx.req, auth);
    return classroom.listSegments({ userId: "any", role: "student" }, ctx.params.sessionId);
  });

  router.post("/api/v1/caption-sessions/:sessionId/segments/:segmentId/correct", async (ctx) => {
    const teacher = await requireTeacher(ctx.req, auth);
    const input = await readJson(ctx.req, correctInput);
    return classroom.correctSegment(teacher.actor, {
      sessionId: ctx.params.sessionId,
      segmentId: ctx.params.segmentId,
      heard: input.heard,
      termPartId: input.termPartId,
    });
  });

  /* --------------------------------- Phrases --------------------------------- */

  router.get("/api/v1/lessons/:lessonId/phrases", async (ctx) => {
    await requireSession(ctx.req, auth);
    return classroom.ensurePhrases(ctx.params.lessonId);
  });

  return router;
}
