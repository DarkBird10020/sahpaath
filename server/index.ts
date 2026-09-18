import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  randomBytes,
  randomUUID,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { z } from "zod";
import { Store } from "./store";
import { awsEngine, createLesson, imageType } from "./providers";
import { GeminiProposalAdapter, LocalOcrAdapter, localOcrLines, localTestEngine, readGeminiConfig } from "./local-ai";
import { answerAboutDiagram, answerFromLesson, diagramContextSchema, explainDiagram, explainWord, transcribeMedia } from "./tutor";
import { readAwsConfig } from "./aws";
import { AudioService, pollySynthesizer, readPollyConfig } from "./audio";
import { demoState, resetDemo, startDemo } from "./demo";
import { normalize } from "../shared/domain";
import { cloudConfig, startCloudPipeline, refreshCloudLesson, isProcessing } from "./cloud-pipeline";
import { evaluate, runSchema } from "../shared/evaluation";
import { fixtures } from "../shared/fixtures";
import { decide, revalidate, validateMap, buildExplorer, items } from "../shared/domain";
import { getTermSurfaces } from "../shared/vocabulary";
import {
  approveSchema,
  editSchema,
  revisionSchema,
  uploadSchema,
  questionInput,
  questionSchema,
  captionSourceSchema,
  segmentInput,
  licenseSchema,
  id,
  type Caption,
  type Question,
  type Session,
} from "../shared/schema";
import { loadConfig } from "./core/config";
import { Logger } from "./core/logger";
import { sha256Hex } from "./core/ids";
import { createRepos } from "./repositories";
import { createStorage } from "./core/storage";
import { createPresignedProvider } from "./core/presign";
import { DiagramSenseService } from "./services/diagram-sense-service";
import { TextractAdapter } from "./providers/textract";
import { BedrockProposalAdapter } from "./providers/bedrock";
import { LessonService } from "./services/lesson-service";
import { ClassroomService } from "./services/classroom-service";
import { DiagramUploadService } from "./services/diagram-upload-service";
import { Router } from "./http/router";
import { registerRoutes } from "./http/routes";
import { toErrorResponse } from "./http/router";

if (existsSync(".env")) loadEnvFile(".env");
const production = process.argv.includes("--production");
const port = Number(process.env.PORT || 5173);
const root = resolve(process.env.SAHPAATH_DATA_DIR || ".data");
const store = new Store(resolve(root, "sahpaath.sqlite"));
const password = process.env.SAHPAATH_TEACHER_PASSWORD || "sahpaath-local";
const polly = readPollyConfig(process.env);
const audio = new AudioService(
  resolve(root, "audio"),
  polly ? pollySynthesizer(polly) : null,
  polly ? `${polly.voiceId}:${polly.engine}:${polly.languageCode}` : "none",
);
const hash = (value: string) => createHash("sha256").update(value).digest();
// Diagram analysis: AWS when configured; otherwise, with GEMINI_API_KEY set,
// local OCR + Gemini as a clearly labelled test stand-in; otherwise manual.
const awsConfig = readAwsConfig(process.env);
const gemini = awsConfig ? null : readGeminiConfig(process.env);
const ocrCacheDir = resolve(root, "tesseract");
const analysisEngine = awsConfig ? awsEngine(awsConfig) : gemini ? localTestEngine(gemini, ocrCacheDir) : null;
// The learner AI helper uses Gemini even when AWS handles lesson analysis.
const tutor = readGeminiConfig(process.env);
function needTutor() {
  if (!tutor) throw new HttpError(503, "AI help is not configured. Add GEMINI_API_KEY to the .env file and restart.");
  return tutor;
}
// Our own wording only; provider error text can contain account details.
function aiFailure(error: unknown): never {
  if (error instanceof HttpError) throw error;
  const safe = (error as { userMessage?: unknown } | null)?.userMessage;
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    throw new HttpError(502, "The AI answer was incomplete. Please try again.");
  throw new HttpError(502, typeof safe === "string" ? safe : "AI help is unavailable right now. Please try again.");
}
const mediaTypes = ["video/mp4", "video/webm", "video/quicktime", "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/ogg", "audio/aac", "audio/flac", "audio/mp4", "audio/x-m4a"] as const;
// Interim (non-final) caption text is display-only and never stored.
const partials = new Map<string, string>();
const counters = new Map<string, { count: number; until: number }>();
function limited(key: string, max: number) {
  const now = Date.now();
  if (counters.size > 1000)
    for (const [k, v] of counters) if (v.until < now) counters.delete(k);
  const current = counters.get(key);
  const next =
    !current || current.until < now
      ? { count: 1, until: now + 60_000 }
      : { count: current.count + 1, until: current.until };
  counters.set(key, next);
  if (next.count > max)
    throw new HttpError(429, "Too many requests. Wait a minute and try again.");
}
class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
function json(res: ServerResponse, value: unknown, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
}
async function body(req: IncomingMessage, maxBytes = 7_000_000): Promise<unknown> {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new HttpError(415, "Send JSON with application/json content type.");
  let length = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > maxBytes)
      throw new HttpError(413, maxBytes > 7_000_000 ? "File too large. Use a recording below 10 MB." : "Image too large. Use PNG or JPEG below 5 MB.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new HttpError(400, "Invalid JSON request.");
  }
}
function session(req: IncomingMessage): Session {
  const token = req.headers.cookie
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith("sahpaath="))
    ?.slice(9);
  const row = token
    ? (store.db
        .prepare("SELECT role,code,expires FROM sessions WHERE token=?")
        .get(hash(token).toString("hex")) as
        (Session & { expires: number }) | undefined)
    : undefined;
  if (!row || row.expires < Date.now())
    throw new HttpError(401, "Choose a classroom role to continue.");
  return { role: row.role, code: row.code };
}
function teacher(req: IncomingMessage) {
  const s = session(req);
  if (s.role !== "teacher")
    throw new HttpError(403, "Only teachers can change lesson content.");
  return s;
}

/* ----------------------------- Core backend -------------------------------- */

const config = loadConfig({
  ...process.env,
  // Local server defaults: keep dev ergonomics without weakening config rules.
  SAHPAATH_TEACHER_PASSWORD: process.env.SAHPAATH_TEACHER_PASSWORD || password,
  // Local loopback development uses an unpredictable process-only signing key.
  // Unfinished upload grants expire on restart; cloud mode requires configuration.
  SAHPAATH_UPLOAD_TOKEN_SECRET: process.env.SAHPAATH_UPLOAD_TOKEN_SECRET ||
    (!process.env.SAHPAATH_S3_BUCKET && process.env.SAHPAATH_STORE !== "dynamodb"
      ? randomBytes(32).toString("hex") : undefined),
});
const logger = new Logger(undefined, config.logLevel, { service: "sahpaath" });
const router = new Router(logger.child({ component: "http" }));

const repos = await createRepos(config);
const storage = createStorage({
  s3Bucket: config.s3Bucket,
  awsRegion: config.awsRegion,
  localUploadsDir: resolve(config.dataDir, "uploads"),
});
const lessonService = new LessonService(repos, logger.child({ component: "lesson" }));
const classroomService = new ClassroomService(repos, logger.child({ component: "classroom" }));
const presign = createPresignedProvider(config);
// DiagramSense providers: real Textract/Bedrock only when explicitly enabled
// AND the account primitives exist; otherwise the honest local fallback runs.
const textract = config.textractEnabled && config.awsRegion
  ? new TextractAdapter(config.awsRegion)
  : gemini ? new LocalOcrAdapter(ocrCacheDir) : null;
const bedrock = config.bedrockEnabled && config.bedrockModelId && config.awsRegion
  ? new BedrockProposalAdapter(config.bedrockModelId, config.awsRegion)
  : gemini ? new GeminiProposalAdapter(gemini) : null;
const senseService = new DiagramSenseService(repos, storage, textract, bedrock, config, logger.child({ component: "diagram-sense" }));
const uploadService = new DiagramUploadService(
  repos,
  presign,
  senseService,
  storage,
  config,
  logger.child({ component: "diagram-upload" }),
);
registerRoutes(router, {
  lessons: lessonService,
  classroom: classroomService,
  uploads: uploadService,
  sense: senseService,
  auth: async (token) => {
    const resolved = await classroomService.resolveSession(token);
    if (!resolved) return null;
    return { actor: { userId: resolved.userId, role: resolved.role }, classCode: resolved.classCode };
  },
  // Local bridge: the existing frontend logs in via legacy /api/session,
  // whose cookie lives in the legacy store. Accept it on v1 routes so no
  // second login is required. The legacy row stores role+code directly.
  legacyAuth: async (token) => {
    if (!token) return null;
    const row = store.db
      .prepare("SELECT role,code,expires FROM sessions WHERE token=?")
      .get(sha256Hex(token)) as { role: "teacher" | "student"; code: string; expires: number } | undefined;
    if (!row || row.expires < Date.now()) return null;
    return {
      actor: { userId: row.role === "teacher" ? "teacher-local" : `student-${token.slice(0, 8)}`, role: row.role },
      classCode: row.code,
    };
  },
  teacherPasswordHash: sha256Hex(config.teacherPassword),
  mirrorSession: (token, role, code) => {
    store.db.prepare("INSERT OR REPLACE INTO sessions VALUES (?, ?, ?, ?)")
      .run(sha256Hex(token), role, code, Date.now() + 12 * 60 * 60 * 1000);
  },
  revokeLegacySession: (token) => {
    store.db.prepare("DELETE FROM sessions WHERE token=?").run(sha256Hex(token));
  },
  storage,
  config,
});

async function api(req: IncomingMessage, res: ServerResponse, url: URL) {
  const method = req.method || "GET";
  const path = url.pathname;
  limited(req.socket.remoteAddress || "local", 500);
  if (method !== "GET") {
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}`)
      throw new HttpError(403, "Cross-origin changes are not allowed.");
    if (req.headers["sec-fetch-site"] === "cross-site")
      throw new HttpError(403, "Cross-site changes are not allowed.");
  }
  // Core backend routes first (versioned contract in docs/API_CONTRACT.md).
  const handled = await router.dispatch(req, res, url);
  if (handled) return;
  if (path === "/api/health")
    return json(res, {
      mode: "local",
      awsConfigured: cloudConfig(process.env) !== null || readAwsConfig(process.env) !== null,
      pollyConfigured: audio.enabled,
      tutor: tutor ? { model: tutor.model } : null,
      analysis: analysisEngine
        ? { ocr: analysisEngine.ocrName, model: analysisEngine.modelName, standIn: !awsConfig }
        : null,
    });
  if (path === "/api/session" && method === "POST") {
    limited(`login:${req.socket.remoteAddress}`, 20);
    const input = z
      .object({
        role: z.enum(["teacher", "student"]),
        password: z.string().max(200).optional(),
      })
      .strict()
      .parse(await body(req));
    if (
      input.role === "teacher" &&
      !timingSafeEqual(hash(input.password || ""), hash(password))
    )
      throw new HttpError(
        403,
        "Incorrect local teacher password. Check your .env or use the documented development password.",
      );
    const token = randomBytes(32).toString("hex");
    const code = randomBytes(3).toString("hex").toUpperCase();
    store.db.prepare("DELETE FROM sessions WHERE expires < ?").run(Date.now());
    store.db
      .prepare("INSERT INTO sessions VALUES (?, ?, ?, ?)")
      .run(
        hash(token).toString("hex"),
        input.role,
        code,
        Date.now() + 12 * 60 * 60 * 1000,
      );
    res.setHeader(
      "Set-Cookie",
      `sahpaath=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`,
    );
    return json(res, { role: input.role, code });
  }
  if (path === "/api/session" && method === "GET")
    return json(res, session(req));
  if (path === "/api/session" && method === "DELETE") {
    const token = req.headers.cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("sahpaath="))
      ?.slice(9);
    if (token) {
      await classroomService.destroySession(token);
      store.db
        .prepare("DELETE FROM sessions WHERE token=?")
        .run(hash(token).toString("hex"));
    }
    res.setHeader(
      "Set-Cookie",
      "sahpaath=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
    );
    return json(res, { ok: true });
  }
  session(req);
  if (path === "/api/fixtures" && method === "GET") return json(res, fixtures);
  if (path === "/api/lessons" && method === "GET") {
    teacher(req);
    return json(res, store.list());
  }
  if (path === "/api/lessons" && method === "POST") {
    teacher(req);
    const input = z
      .object({
        fixtureId: z.enum(["heart", "water", "plant", "circuit", "pump"]),
      })
      .strict()
      .parse(await body(req));
    return json(res, store.add(await createLesson(input.fixtureId)), 201);
  }
  if (path === "/api/evaluation/summary" && method === "GET")
    return json(res, store.evaluationSummary());
  if (path === "/api/evaluation/runs" && method === "POST") {
    teacher(req);
    const input = (await body(req)) as Record<string, unknown>;
    const record = runSchema.parse({
      ...input,
      runId:
        typeof input.runId === "string" && input.runId
          ? input.runId
          : randomUUID(),
    });
    store.addEvaluationRun(record);
    return json(res, evaluate(record), 201);
  }
  if (path === "/api/upload" && method === "POST") {
    teacher(req);
    const input = uploadSchema.parse(await body(req));
    const bytes = Buffer.from(input.base64, "base64");
    if (imageType(bytes) !== input.mime)
      throw new HttpError(
        400,
        "File contents do not match a supported PNG or JPEG image below 5 MB.",
      );
    const name = `${randomUUID()}.${input.mime === "image/png" ? "png" : "jpg"}`;
    await mkdir(resolve(root, "uploads"), { recursive: true });
    await writeFile(resolve(root, "uploads", name), bytes);
    const cloud = cloudConfig(process.env);
    if (cloud) {
      const lesson = await createLesson(null, input.title, name, undefined, null, input.license);
      try { await startCloudPipeline(cloud, lesson, bytes); }
      catch { throw new HttpError(502, "Cloud processing could not be started. Check AWS configuration and retry the upload."); }
      store.add(lesson);
      store.audit(lesson.id, "processing_started", `Step Functions job ${lesson.jobId} queued.`);
      return json(res, lesson, 201);
    }
    return json(
      res,
      store.add(
        // AWS runs only when fully configured; otherwise the manual editor.
        await createLesson(
          null,
          input.title,
          name,
          bytes,
          analysisEngine,
          input.license,
        ),
      ),
      201,
    );
  }
  if (path === "/api/published" && method === "GET")
    return json(res, store.publishedList());
  // Student explorer view: derived server-side from published content only.
  const explorer = path.match(
    /^\/api\/published\/([\w-]+)\/explorer(?:\/parts\/([\w-]+))?$/,
  );
  if (explorer && method === "GET") {
    const published = store.published(id.parse(explorer[1]));
    const view = buildExplorer(published, {
      cachedUrl: (partId) =>
        audio.has(published, partId)
          ? `/api/published/${published.lessonId}/audio/${partId}?version=${published.version}`
          : null,
    });
    if (!explorer[2]) return json(res, view);
    const part = view.parts.find((p) => p.partId === explorer[2]!);
    if (!part)
      throw new HttpError(404, "This part is not in the published lesson.");
    return json(res, part);
  }
  // Cached Polly audio of an approved description; same-origin and session-only.
  const audioRoute = path.match(/^\/api\/published\/([\w-]+)\/audio\/([\w-]+)$/);
  if (audioRoute && method === "GET") {
    const published = store.published(
      id.parse(audioRoute[1]),
      url.searchParams.has("version")
        ? z.coerce.number().int().positive().parse(url.searchParams.get("version"))
        : undefined,
    );
    const data = await audio.read(published, id.parse(audioRoute[2]));
    if (!data)
      throw new HttpError(404, "No cached audio for this part. Read the text description or use Read aloud.");
    res.writeHead(200, { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=3600" });
    return res.end(data);
  }
  const pub = path.match(/^\/api\/published\/([\w-]+)$/);
  if (pub && method === "GET")
    return json(
      res,
      store.published(
        id.parse(pub[1]),
        url.searchParams.has("version")
          ? z.coerce
              .number()
              .int()
              .positive()
              .parse(url.searchParams.get("version"))
          : undefined,
      ),
    );
  const vocabulary = path.match(
    /^\/api\/published\/([\w-]+)\/vocabulary(?:\/([\w-]+)\/surfaces)?$/,
  );
  if (vocabulary && method === "GET") {
    const published = store.published(id.parse(vocabulary[1]));
    if (!vocabulary[2]) return json(res, published.vocabulary);
    const termId = id.parse(vocabulary[2]);
    if (!published.vocabulary.some((t) => t.id === termId))
      throw new HttpError(
        404,
        "This term is not part of the approved lesson version.",
      );
    return json(
      res,
      getTermSurfaces(termId, published, [
        ...store
          .records<Caption>("captions", published.lessonId)
          .filter((c) => c.version === published.version),
        ...store.lessonSegments(published.lessonId, published.version),
      ]),
    );
  }
  const media = path.match(/^\/api\/images\/([\w-]+\.(?:png|jpg))$/);
  if (media && method === "GET") {
    const s = session(req);
    if (
      s.role !== "teacher" &&
      !store.publishedList().some((l) => l.image === media[1])
    )
      throw new HttpError(403, "This diagram has not been published.");
    const data = await readFile(resolve(root, "uploads", media[1]));
    res.writeHead(200, {
      "Content-Type": media[1].endsWith("png") ? "image/png" : "image/jpeg",
      "Cache-Control": "private, no-store",
    });
    return res.end(data);
  }
  const lessonRoute = path.match(
    /^\/api\/lessons\/([\w-]+)(?:\/(map|decision|publish|version|audit|questions|captions|processing-status|license))?$/,
  );
  if (lessonRoute) {
    const lessonId = id.parse(lessonRoute[1]);
    const action = lessonRoute[2];
    if (action === "captions" && method === "GET") {
      const p = store.published(lessonId);
      return json(
        res,
        store
          .records<Caption>("captions", lessonId)
          .filter((c) => c.version === p.version),
      );
    }
    teacher(req);
    if (action === "processing-status" && method === "GET") {
      const lesson = store.get(lessonId);
      const cloud = cloudConfig(process.env);
      const updated = cloud ? await refreshCloudLesson(cloud, lesson) : null;
      if (updated) {
        // Another poll or edit may have completed while AWS was responding.
        if (store.get(lessonId).revision !== lesson.revision) return json(res, store.get(lessonId));
        const saved = store.save(updated, lesson.revision);
        store.audit(lessonId, "processing_finished", `Job ${lesson.jobId} imported for teacher review.`);
        return json(res, saved);
      }
      return json(res, lesson);
    }
    if (["map", "decision", "publish", "version"].includes(action) && method !== "GET" && isProcessing(store.get(lessonId)))
      throw new HttpError(409, "Diagram processing is still running. Wait for teacher review.");
    if (!action && method === "GET") return json(res, store.get(lessonId));
    if (action === "audit" && method === "GET")
      return json(res, store.events(lessonId));
    if (action === "questions" && method === "GET")
      return json(res, store.records<Question>("questions", lessonId));
    if (action === "map" && method === "PUT") {
      const input = editSchema.parse(await body(req));
      const lesson = store.get(lessonId);
      if (lesson.status === "published")
        throw new HttpError(
          409,
          "Create a new version before editing published content.",
        );
      lesson.map = revalidate(input.map, true);
      lesson.stages = lesson.stages.map((s) =>
        s.name === "Validation"
          ? {
              ...s,
              detail: `${validateMap(lesson.map).length} deterministic validation finding(s).`,
              durationMs: null,
            }
          : s,
      );
      const saved = store.save(lesson, input.revision);
      store.audit(
        lessonId,
        "map_edited",
        "Map edited; all decisions reset to prevent stale approvals.",
      );
      return json(res, saved);
    }
    if (action === "decision" && method === "POST") {
      const input = approveSchema.parse(await body(req));
      const lesson = store.get(lessonId);
      if (lesson.status === "published")
        throw new HttpError(409, "Published decisions are immutable.");
      const previous =
        items(lesson.map).find((i) => i.id === input.itemId)?.state ??
        "missing";
      lesson.map = decide(lesson.map, input.itemId, input.decision, input.note);
      const saved = store.save(lesson, input.revision);
      store.audit(
        lessonId,
        input.decision,
        `${input.itemId}: ${input.note || "Explicit teacher decision."}`,
        "local-teacher",
        {
          itemId: input.itemId,
          decision: input.decision,
          previousState: previous,
          newState:
            items(saved.map).find((i) => i.id === input.itemId)?.state ??
            "missing",
        },
      );
      return json(res, saved);
    }
    if (action === "publish" && method === "POST") {
      const input = revisionSchema.parse(await body(req));
      const snapshot = store.publish(lessonId, input.revision);
      if (audio.enabled) {
        // Audio follows approval and never blocks publication.
        const started = performance.now();
        const counts = await audio.prepare(store.published(lessonId, snapshot.version));
        store.audit(
          lessonId,
          counts.failed ? "audio_partial" : "audio_ready",
          `Polly audio for version ${snapshot.version}: ${counts.generated} generated, ${counts.cached} cached, ${counts.failed} failed (text remains available) in ${Math.round(performance.now() - started)} ms.`,
        );
      }
      return json(res, snapshot);
    }
    if (action === "license" && method === "PUT") {
      const input = z.object({ revision: z.number().int().nonnegative(), license: licenseSchema }).strict().parse(await body(req));
      const lesson = store.get(lessonId);
      if (lesson.status === "published")
        throw new HttpError(409, "Create a new version before changing the license.");
      lesson.license = input.license;
      const saved = store.save(lesson, input.revision);
      store.audit(lessonId, "license_recorded", `License recorded: ${input.license.licenseName}.`);
      return json(res, saved);
    }
    if (action === "version" && method === "POST") {
      const input = revisionSchema.parse(await body(req));
      return json(res, store.newVersion(lessonId, input.revision));
    }
    if (action === "captions" && method === "POST") {
      const input = z
        .object({
          text: z.string().trim().min(1).max(12000),
          source: z.enum(["manual_note", "loaded_transcript"]),
        })
        .strict()
        .parse(await body(req));
      const published = store.published(lessonId);
      const record: Caption = {
        ...input,
        corrections: [],
        id: randomUUID(),
        lessonId,
        version: published.version,
        createdAt: new Date().toISOString(),
      };
      store.addRecord("captions", record);
      return json(res, record, 201);
    }
  }
  if (path === "/api/questions" && method === "POST") {
    const s = session(req);
    limited(`question:${s.code}`, 30);
    const input = questionInput.parse(await body(req));
    const published = store.published(input.lessonId, input.version);
    if (
      input.conceptId &&
      !published.vocabulary.some((t) => t.id === input.conceptId)
    )
      throw new HttpError(
        400,
        "Choose a concept from this approved lesson version.",
      );
    const record: Question = {
      ...input,
      id: randomUUID(),
      sessionCode: s.code,
      createdAt: new Date().toISOString(),
      status: "queued",
      aiAnswer: null,
    };
    store.addRecord("questions", record);
    store.audit(
      input.lessonId,
      "question_received",
      `Question from session ${s.code}${input.conceptId ? ` anchored to ${input.conceptId}` : ""}. Exact student wording preserved.`,
      `student-${s.code}`,
    );
    return json(res, record, 201);
  }
  if (path === "/api/questions/mine" && method === "GET") {
    const s = session(req);
    const lessonIdParam = url.searchParams.get("lessonId");
    if (!lessonIdParam) throw new HttpError(400, "lessonId is required.");
    const lessonId = id.parse(lessonIdParam);
    return json(
      res,
      store
        .records<Question>("questions", lessonId)
        .filter((q) => q.sessionCode === s.code),
    );
  }
  const statusMatch = path.match(/^\/api\/questions\/([\w-]+)\/status$/);
  if (statusMatch && method === "POST") {
    teacher(req);
    const input = z
      .object({ status: z.enum(["seen", "answered", "dismissed"]) })
      .strict()
      .parse(await body(req));
    return json(
      res,
      store.setQuestionStatus(id.parse(statusMatch[1]), input.status),
    );
  }
  const correction = path.match(/^\/api\/captions\/([\w-]+)\/correct$/);
  if (correction && method === "POST") {
    teacher(req);
    const input = z
      .object({ heard: z.string().trim().min(1).max(120), termId: id })
      .strict()
      .parse(await body(req));
    return json(
      res,
      store.correctCaption(id.parse(correction[1]), input.heard, input.termId),
    );
  }
  // Learner AI help. Works without a teacher; every answer is labelled as AI.
  if (path === "/api/ai/explain-diagram" && method === "POST") {
    const s = session(req);
    limited(`ai-diagram:${s.code}`, 10);
    const input = z.object({
      mime: z.enum(["image/png", "image/jpeg"]),
      base64: z.string().min(1).max(6_700_000),
      question: z.string().trim().max(300).nullable().default(null),
    }).strict().parse(await body(req));
    const bytes = Buffer.from(input.base64, "base64");
    if (imageType(bytes) !== input.mime) throw new HttpError(400, "Choose a PNG or JPEG image below 5 MB.");
    const config = needTutor();
    // OCR runs once and feeds both the explanation and the explorer map.
    let ocrRun: ReturnType<typeof localOcrLines> | null = null;
    const ocr = () => (ocrRun ??= localOcrLines(bytes, ocrCacheDir));
    try {
      const [explanation, structure] = await Promise.all([
        explainDiagram(config, { bytes, mime: input.mime }, ocr, input.question || null),
        // The explorer map is optional: if it fails, the explanation still opens.
        localTestEngine(config, ocrCacheDir, fetch, () => ocr()).run({ bytes, mime: input.mime }).catch(() => null),
      ]);
      return json(res, {
        ...explanation,
        model: config.model,
        map: structure?.ok ? structure.map : null,
        mapFindings: structure?.ok ? structure.issues.length : null,
      });
    } catch (error) { aiFailure(error); }
  }
  if (path === "/api/ai/ask-diagram" && method === "POST") {
    const s = session(req);
    limited(`ai-ask:${s.code}`, 20);
    const input = z.object({
      context: diagramContextSchema,
      question: z.string().trim().min(1).max(300),
      focus: z.string().trim().max(120).nullable().default(null),
    }).strict().parse(await body(req));
    const config = needTutor();
    try { return json(res, { answer: await answerAboutDiagram(config, input.context, input.question, input.focus), model: config.model }); }
    catch (error) { aiFailure(error); }
  }
  if (path === "/api/ai/ask" && method === "POST") {
    const s = session(req);
    limited(`ai-ask:${s.code}`, 20);
    const input = questionInput.parse(await body(req));
    const published = store.published(input.lessonId, input.version);
    if (input.conceptId && !published.vocabulary.some((t) => t.id === input.conceptId))
      throw new HttpError(400, "Choose a concept from this approved lesson version.");
    const config = needTutor();
    let answer;
    try { answer = await answerFromLesson(config, published, input.text, input.conceptId); }
    catch (error) { aiFailure(error); }
    // The question and the AI's answer both go to the teacher's queue.
    const record: Question = {
      ...input,
      id: randomUUID(),
      sessionCode: s.code,
      createdAt: new Date().toISOString(),
      status: "queued",
      aiAnswer: { answer: answer.answer, outsideLesson: answer.outsideLesson, model: config.model },
    };
    store.addRecord("questions", record);
    store.audit(input.lessonId, "ai_answer_given", `AI tutor answered session ${s.code}${answer.outsideLesson ? " (beyond the lesson)" : ""}. Queued for the teacher.`, `student-${s.code}`);
    return json(res, { question: record, conceptIds: answer.conceptIds }, 201);
  }
  if (path === "/api/ai/explain-word" && method === "POST") {
    const s = session(req);
    limited(`ai-word:${s.code}`, 30);
    const input = z.object({
      word: z.string().trim().min(1).max(80),
      context: z.string().trim().max(600).nullable().default(null),
      lessonId: id.nullable().default(null),
    }).strict().parse(await body(req));
    let published = null;
    if (input.lessonId) { try { published = store.published(input.lessonId); } catch { published = null; } }
    try { return json(res, await explainWord(tutor, input.word, input.context, published)); }
    catch (error) {
      if (!tutor) throw new HttpError(503, "AI help is not configured. Add GEMINI_API_KEY to the .env file and restart.");
      aiFailure(error);
    }
  }
  if (path === "/api/ai/transcribe" && method === "POST") {
    const s = session(req);
    limited(`ai-media:${s.code}`, 5);
    const input = z.object({ mime: z.enum(mediaTypes), base64: z.string().min(1).max(14_000_000) }).strict().parse(await body(req, 14_500_000));
    const bytes = Buffer.from(input.base64, "base64");
    if (!bytes.length || bytes.length > 10_000_000) throw new HttpError(413, "File too large. Use a recording below 10 MB.");
    const config = needTutor();
    try { return json(res, { ...(await transcribeMedia(config, { bytes, mime: input.mime })), model: config.model }); }
    catch (error) { aiFailure(error); }
  }
  // ClassCaption: live sessions of timed final segments on a published version.
  if (path === "/api/caption-sessions" && method === "POST") {
    teacher(req);
    const input = z
      .object({ lessonId: id, source: captionSourceSchema })
      .strict()
      .parse(await body(req));
    if (input.source === "transcribe")
      throw new HttpError(503, "Amazon Transcribe streaming is not configured. Use browser speech recognition or typed captions.");
    return json(res, store.startCaptionSession(input.lessonId, input.source), 201);
  }
  if (path === "/api/caption-sessions" && method === "GET") {
    const lessonId = id.parse(url.searchParams.get("lessonId"));
    const published = store.published(lessonId);
    return json(res, store.captionSessions(lessonId).filter((s) => s.version === published.version));
  }
  const captionSession = path.match(
    /^\/api\/caption-sessions\/([\w-]+)(?:\/(segments|search|export|end|credentials))?$/,
  );
  if (captionSession) {
    const sessionId = id.parse(captionSession[1]);
    const action = captionSession[2];
    const cs = store.captionSession(sessionId);
    if (!action && method === "GET")
      return json(res, { session: cs, partial: partials.get(sessionId) ?? null, segments: store.segments(sessionId) });
    if (action === "segments" && method === "GET") return json(res, store.segments(sessionId));
    if (action === "search" && method === "GET") {
      const q = normalize(url.searchParams.get("q") ?? "");
      const termId = url.searchParams.get("termId");
      if (!q && !termId) throw new HttpError(400, "Give a search word (q) or an approved term (termId).");
      return json(
        res,
        store.segments(sessionId).filter(
          (s) =>
            (q && normalize(s.text).includes(q)) ||
            (termId && s.matchedTerms.some((h) => h.termId === termId)),
        ),
      );
    }
    if (action === "export" && method === "GET") {
      const segs = store.segments(sessionId);
      const clock = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
      const terms = new Map<string, number[]>();
      for (const s of segs) for (const h of s.matchedTerms) terms.set(h.canonical, [...(terms.get(h.canonical) ?? []), s.startMs]);
      const text = [
        `SahPaath captions · session ${cs.id} · lesson version ${cs.version} · source: ${cs.source}`,
        "Captions support, and do not replace, sign-language interpretation.",
        "",
        ...segs.map((s) => `[${clock(s.startMs)}] ${s.text}`),
        "",
        "Approved terms heard (first mentions):",
        ...[...terms].map(([name, at]) => `- ${name}: ${at.map(clock).join(", ")}`),
      ].join("\n");
      res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="sahpaath-captions-${cs.id}.txt"`,
      });
      return res.end(text);
    }
    teacher(req);
    if (action === "segments" && method === "POST") {
      limited(`segment:${sessionId}`, 240);
      const input = segmentInput.parse(await body(req));
      if (cs.status !== "live") throw new HttpError(409, "This caption session has ended. Start a new one.");
      if (!input.isFinal) {
        partials.set(sessionId, input.text);
        return json(res, { partial: input.text });
      }
      partials.delete(sessionId);
      return json(res, store.addSegment(sessionId, input.text, input.startMs, input.endMs), 201);
    }
    if (action === "end" && method === "POST") {
      partials.delete(sessionId);
      return json(res, store.endCaptionSession(sessionId));
    }
    if (action === "credentials" && method === "POST")
      // Browser credentials must come from a Cognito identity pool scoped to
      // streaming only (docs/CLASSCAPTION.md); never from server keys.
      throw new HttpError(503, "Amazon Transcribe streaming is not configured. Use browser speech recognition or typed captions.");
  }
  if (path.startsWith("/api/demo/")) {
    teacher(req);
    if (path === "/api/demo/state" && method === "GET") return json(res, demoState(store, audio));
    if (path === "/api/demo/start" && method === "POST") {
      await startDemo(store);
      return json(res, demoState(store, audio));
    }
    if (path === "/api/demo/reset" && method === "POST") {
      resetDemo(store);
      return json(res, demoState(store, audio));
    }
  }
  throw new HttpError(404, "This resource was not found.");
}

const vite = !production
  ? await (
      await import("vite")
    ).createServer({
      server: { middlewareMode: true, ws: { port: port + 20000 } },
      appType: "spa",
    })
  : null;
const server = createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  const started = performance.now();
  try {
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || ""))
      throw new HttpError(403, "Local host only.");
    const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
    if (url.pathname.startsWith("/api/")) await api(req, res, url);
    else if (vite) vite.middlewares(req, res);
    else {
      const requested = resolve("dist", "." + decodeURIComponent(url.pathname));
      const dist = resolve("dist");
      if (
        !requested.startsWith(dist + "/") &&
        !requested.startsWith(dist + "\\") &&
        requested !== dist
      )
        throw new HttpError(403, "Invalid path.");
      const file = extname(requested) ? requested : resolve("dist/index.html");
      const contents = await readFile(file);
      const types: Record<string, string> = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".webp": "image/webp",
        ".mp4": "video/mp4",
        ".woff2": "font/woff2",
      };
      res.writeHead(200, {
        "Content-Type": types[extname(file)] || "application/octet-stream",
      });
      res.end(contents);
    }
  } catch (error) {
    // Core backend errors carry structured codes; legacy routes keep the old shape.
    if (error instanceof Error && error.name === "AppError") {
      const mapped = toErrorResponse(error);
      json(res, mapped.body, mapped.status);
    } else {
      const status =
        error instanceof HttpError
          ? error.status
          : error instanceof z.ZodError
            ? 400
            : 409;
      json(
        res,
        {
          error:
            error instanceof z.ZodError
              ? error.issues
                  .map((i) => `${i.path.join(".")}: ${i.message}`)
                  .join("; ")
              : error instanceof Error
                ? error.message
                : "Request failed. Retry or reload the lesson.",
        },
        status,
      );
    }
  } finally {
    if (req.url?.startsWith("/api/"))
      console.log(
        JSON.stringify({
          event: "request",
          method: req.method,
          path: req.url.split("?")[0],
          status: res.statusCode,
          durationMs: Math.round((performance.now() - started) * 100) / 100,
        }),
      );
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    `SahPaath local classroom: http://127.0.0.1:${port}\n${cloudConfig(process.env) ? "Step Functions processing configured (live verification required)." : readAwsConfig(process.env) ? "Direct AWS processing configured (live verification required)." : analysisEngine ? `AWS is not connected. Diagram analysis test stand-in: ${analysisEngine.ocrName} + ${analysisEngine.modelName}.` : "AWS is not connected."} Local teacher password: ${process.env.SAHPAATH_TEACHER_PASSWORD ? "(configured in environment)" : "sahpaath-local"}`,
  ),
);
