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
import { createLesson, imageType } from "./providers";
import { fixtures } from "../shared/fixtures";
import { decide, revalidate, validateMap } from "../shared/domain";
import {
  approveSchema,
  editSchema,
  revisionSchema,
  uploadSchema,
  questionInput,
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
const hash = (value: string) => createHash("sha256").update(value).digest();
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
async function body(req: IncomingMessage): Promise<unknown> {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new HttpError(415, "Send JSON with application/json content type.");
  let length = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 7_000_000)
      throw new HttpError(413, "Image too large. Use PNG or JPEG below 5 MB.");
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
});
const logger = new Logger(undefined, config.logLevel, { service: "sahpaath" });
const router = new Router(logger.child({ component: "http" }));

const repos = await createRepos(
  config.store === "dynamodb" ? { ...config, store: "memory" } : config,
);
if (config.store === "dynamodb")
  logger.warn("config.dynamodb_downgraded", {
    detail:
      "SAHPAATH_STORE=dynamodb requested, but the table is not provisioned yet (docs/DYNAMODB.md). Running on the in-memory adapter so nothing pretends to persist to AWS.",
  });
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
  : null;
const bedrock = config.bedrockEnabled && config.bedrockModelId && config.awsRegion
  ? new BedrockProposalAdapter(config.bedrockModelId, config.awsRegion)
  : null;
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
    return json(res, { mode: "local", awsConnected: false });
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
    if (token)
      store.db
        .prepare("DELETE FROM sessions WHERE token=?")
        .run(hash(token).toString("hex"));
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
    return json(
      res,
      store.add(await createLesson(null, input.title, name)),
      201,
    );
  }
  if (path === "/api/published" && method === "GET")
    return json(res, store.publishedList());
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
    /^\/api\/lessons\/([\w-]+)(?:\/(map|decision|publish|version|audit|questions|captions))?$/,
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
      lesson.map = decide(lesson.map, input.itemId, input.decision, input.note);
      const saved = store.save(lesson, input.revision);
      store.audit(
        lessonId,
        input.decision,
        `${input.itemId}: ${input.note || "Explicit teacher decision."}`,
      );
      return json(res, saved);
    }
    if (action === "publish" && method === "POST") {
      const input = revisionSchema.parse(await body(req));
      return json(res, store.publish(lessonId, input.revision));
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
      acknowledged: false,
      createdAt: new Date().toISOString(),
    };
    store.addRecord("questions", record);
    return json(res, record, 201);
  }
  const ack = path.match(/^\/api\/questions\/([\w-]+)\/acknowledge$/);
  if (ack && method === "POST") {
    teacher(req);
    store.acknowledge(id.parse(ack[1]));
    return json(res, { ok: true });
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
    `SahPaath local classroom: http://127.0.0.1:${port}\nAWS is not connected. Store: ${config.store}. Local teacher password: ${process.env.SAHPAATH_TEACHER_PASSWORD ? "(configured in environment)" : "sahpaath-local"}`,
  ),
);
