import { z } from "zod";

export const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const text = z.string().trim().min(1).max(2000);
export const trustSchema = z.enum([
  "ai_proposed",
  "needs_review",
  "validated",
  "teacher_approved",
  "rejected",
]);
export const labelSchema = z
  .object({
    id,
    text: text.max(120),
    confidence: z.number().min(0).max(100).nullable(),
    source: z.enum(["demo_fixture", "teacher_entered", "textract", "local_ocr"]),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    boundingBox: z.object({
      left: z.number().min(0).max(1), top: z.number().min(0).max(1),
      width: z.number().positive().max(1), height: z.number().positive().max(1),
    }).strict().optional(),
  })
  .strict();
const decision = {
  state: trustSchema,
  reviewNote: z.string().max(1000).default(""),
};
const aliases = z
  .array(z.string().trim().min(1).max(120))
  .max(10)
  .default([]);
const modelConfidence = z.number().min(0).max(100).nullable().default(null);
export const partSchema = z
  .object({
    id,
    labelId: id,
    name: text.max(120),
    description: text,
    descriptions: z.object({ short: text.max(280), normal: text, detailed: text }).strict().optional(),
    evidence: z.array(id).max(30).optional(),
    aliases,
    modelConfidence,
    ...decision,
  })
  .strict();
export const relationSchema = z
  .object({
    id,
    from: id,
    to: id,
    kind: z.enum(["flows_to", "connects_to", "supports"]),
    evidence: z.array(id).max(30),
    modelConfidence,
    ...decision,
  })
  .strict();
export const flowSchema = z
  .object({
    id,
    name: text.max(120),
    steps: z.array(id).min(1).max(60),
    ...decision,
  })
  .strict();
export const mapSchema = z
  .object({
    labels: z.array(labelSchema).max(100),
    parts: z.array(partSchema).max(60),
    relations: z.array(relationSchema).max(120),
    flows: z.array(flowSchema).max(20),
  })
  .strict();
export const issueSchema = z.object({
  itemId: id,
  code: z.string(),
  severity: z.enum(["error", "warning"]),
  message: z.string(),
});
export const stageSchema = z.object({
  name: z.string(),
  status: z.enum(["completed", "waiting", "fallback", "locked"]),
  simulation: z.boolean(),
  durationMs: z.number().nullable(),
  detail: z.string(),
  retries: z.number().int().nonnegative(),
  error: z.string().nullable(),
});
export const licenseSchema = z
  .object({
    sourceUrl: z.string().trim().max(500).default(""),
    licenseName: text.max(120),
    attribution: z.string().trim().max(300).default(""),
    sourceType: z.enum(["self_created", "open_license", "ncert_section_52"]),
  })
  .strict();
export type License = z.infer<typeof licenseSchema>;
export const lessonSchema = z.object({
  id,
  title: text.max(140),
  subject: z.string().max(80),
  fixtureId: z.string().nullable(),
  image: z.string().nullable(),
  // default(null): lessons stored before the license gate existed parse as
  // unlicensed drafts; publishSnapshot still blocks null before publishing.
  license: licenseSchema.nullable().default(null),
  map: mapSchema,
  revision: z.number().int().nonnegative(),
  version: z.number().int().positive(),
  publishedVersion: z.number().int().positive().nullable(),
  status: z.enum(["draft", "published"]),
  stages: z.array(stageSchema),
  jobId: id,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const termSchema = z.object({
  id,
  name: z.string(),
  definition: z.string(),
  labelId: id,
  aliases: z.array(z.string().max(120)).default([]),
  approvedAt: z.string().default(""),
  approvedBy: z.string().default("local-teacher"),
  state: z.literal("teacher_approved"),
});
export const termSurfacesSchema = z
  .object({
    explorer: z.boolean(),
    glossary: z.boolean(),
    audio: z.boolean(),
    captions: z.boolean(),
    communicationAnchor: z.boolean(),
  })
  .strict();
export const publishedSchema = z.object({
  lessonId: id,
  title: z.string(),
  subject: z.string(),
  version: z.number().int().positive(),
  publishedAt: z.string(),
  image: z.string().nullable(),
  // Snapshots are immutable, so versions published before the license gate
  // existed cannot be backfilled; they read as null. publishSnapshot always
  // writes a license, so every new version carries one.
  license: licenseSchema.nullable().default(null),
  map: mapSchema,
  vocabulary: z.array(termSchema),
});
/** One explorable node for the student explorer: everything the UI needs to
 * render, announce and navigate, derived server-side from published content
 * only. `flow.previous`/`flow.next` are part ids or null. */
export const explorerPartSchema = z
  .object({
    partId: id,
    name: z.string(),
    shortDescription: z.string().max(280),
    detailedDescription: z.string(),
    vocabularyTermId: id,
    connectedParts: z
      .array(
        z.object({
          partId: id,
          name: z.string(),
          relationship: z.enum(["flows_to", "connects_to", "supports"]),
          direction: z.enum(["outgoing", "incoming"]),
        }),
      )
      .max(30),
    flow: z
      .object({
        flowId: id,
        name: z.string(),
        position: z.number().int().positive(),
        total: z.number().int().positive(),
        previous: id.nullable(),
        next: id.nullable(),
      })
      .nullable(),
    audio: z
      .object({
        url: z.string(),
        engine: z.enum(["polly", "browser_speech"]),
        cached: z.boolean(),
      })
      .nullable(),
  })
  .strict();
export const explorerSchema = z
  .object({
    lessonId: id,
    version: z.number().int().positive(),
    title: z.string(),
    readingOrder: z.array(id),
    parts: z.array(explorerPartSchema).max(60),
    audioEngine: z.enum(["polly", "browser_speech"]),
  })
  .strict();
export const questionStatusSchema = z.enum([
  "queued",
  "seen",
  "answered",
  "dismissed",
]);
export const questionSchema = z.object({
  id,
  lessonId: id,
  version: z.number().int().positive(),
  conceptId: id.nullable(),
  text: text.max(500),
  sessionCode: z.string(),
  createdAt: z.string(),
  status: questionStatusSchema.default("queued"),
  /** What the AI tutor told the student, kept so the teacher can check it. */
  aiAnswer: z
    .object({ answer: z.string(), outsideLesson: z.boolean(), model: z.string() })
    .nullable()
    .default(null),
});
/** One row of the teacher's cross-lesson question inbox. */
export const inboxRowSchema = questionSchema.extend({
  lessonTitle: z.string(),
  conceptName: z.string().nullable(),
});
export type InboxRow = z.infer<typeof inboxRowSchema>;
export const captionSchema = z.object({
  id,
  lessonId: id,
  version: z.number().int().positive(),
  text: text.max(12000),
  originalText: z.string().max(12000).optional(),
  corrections: z
    .array(z.object({ from: z.string(), to: z.string(), termId: id }))
    .default([]),
  source: z.enum(["loaded_transcript", "manual_note"]),
  createdAt: z.string(),
});
/** Where live caption text comes from. Every source is shown to students;
 * "transcribe" is only used once Amazon Transcribe streaming is verified. */
export const captionSourceSchema = z.enum([
  "transcribe",
  "browser_speech",
  "typed",
  "demo_script",
]);
export const captionSessionSchema = z.object({
  id,
  lessonId: id,
  version: z.number().int().positive(),
  source: captionSourceSchema,
  status: z.enum(["live", "ended"]),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
});
/** A matched approved term inside a caption segment. The raw text is never
 * rewritten; `method` says how the surface was recognised. */
export const termHitSchema = z.object({
  termId: id,
  canonical: z.string(),
  matched: z.string(),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  method: z.enum(["exact", "alias", "near_spelling"]),
});
export const segmentSchema = z.object({
  id,
  sessionId: id,
  lessonId: id,
  version: z.number().int().positive(),
  text: text.max(2000),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  isFinal: z.literal(true),
  matchedTerms: z.array(termHitSchema),
  createdAt: z.string(),
});
export const segmentInput = z
  .object({
    text: z.string().trim().min(1).max(2000),
    isFinal: z.boolean(),
    startMs: z.number().int().nonnegative().max(86_400_000).optional(),
    endMs: z.number().int().nonnegative().max(86_400_000).optional(),
  })
  .strict();
export const liveCaptionSchema = z.object({
  session: captionSessionSchema,
  partial: z.string().nullable(),
  segments: z.array(segmentSchema),
});
export const demoStepSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(["done", "waiting", "simulated", "fallback"]),
  detail: z.string(),
});
export const demoStateSchema = z.object({
  lessonId: id.nullable(),
  steps: z.array(demoStepSchema),
  next: z.string(),
});
export const auditSchema = z.object({
  id,
  lessonId: id,
  action: z.string(),
  detail: z.string(),
  itemId: id.optional(),
  decision: z.enum(["approve", "reject"]).optional(),
  previousState: z.string().optional(),
  newState: z.string().optional(),
  createdAt: z.string(),
  actor: z.string(),
});
export const sessionSchema = z.object({
  role: z.enum(["teacher", "student"]),
  code: z.string(),
});

/* ------------------------- Application users (Supabase) ------------------- */

/** The three application roles. USER means student/learner. */
export const appRoleSchema = z.enum(["ADMIN", "TEACHER", "USER"]);
export type AppRole = z.infer<typeof appRoleSchema>;

/**
 * Application user mapped from Supabase Auth. Credentials live ONLY in
 * Supabase; this record never carries a password field by design.
 */
export const appUserSchema = z.object({
  id: z.string(),
  supabaseUserId: z.string().min(1),
  email: z.string(),
  name: z.string(),
  role: appRoleSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AppUser = z.infer<typeof appUserSchema>;
export const revisionSchema = z
  .object({ revision: z.number().int().nonnegative() })
  .strict();
export const editSchema = z
  .object({ revision: z.number().int().nonnegative(), map: mapSchema })
  .strict();
export const approveSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    itemId: id,
    decision: z.enum(["approve", "reject"]),
    note: z.string().max(1000).default(""),
  })
  .strict();
export const uploadSchema = z
  .object({
    title: text.max(140),
    mime: z.enum(["image/png", "image/jpeg"]),
    base64: z.string().min(1).max(6_700_000),
    // Optional here: publishSnapshot blocks publishing until a license exists.
    license: licenseSchema.nullable().default(null),
  })
  .strict();
export const questionInput = z
  .object({
    lessonId: id,
    version: z.number().int().positive(),
    conceptId: id.nullable(),
    text: text.max(500),
  })
  .strict();
export const questionStatusInput = z
  .object({ status: z.enum(["seen", "answered", "dismissed"]) })
  .strict();
export type Lesson = z.infer<typeof lessonSchema>;
export type DiagramMap = z.infer<typeof mapSchema>;
export type Label = z.infer<typeof labelSchema>;
export type Part = z.infer<typeof partSchema>;
export type Relation = z.infer<typeof relationSchema>;
export type Flow = z.infer<typeof flowSchema>;
export type Issue = z.infer<typeof issueSchema>;
export type Published = z.infer<typeof publishedSchema>;
export type Stage = z.infer<typeof stageSchema>;
export type Question = z.infer<typeof questionSchema>;
export type Caption = z.infer<typeof captionSchema>;
export type Audit = z.infer<typeof auditSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type Term = z.infer<typeof termSchema>;
export type TermSurfaces = z.infer<typeof termSurfacesSchema>;
export type ExplorerPart = z.infer<typeof explorerPartSchema>;
export type Explorer = z.infer<typeof explorerSchema>;
export type CaptionSession = z.infer<typeof captionSessionSchema>;
export type CaptionSource = z.infer<typeof captionSourceSchema>;
export type TermHit = z.infer<typeof termHitSchema>;
export type Segment = z.infer<typeof segmentSchema>;
export type LiveCaption = z.infer<typeof liveCaptionSchema>;
export type DemoState = z.infer<typeof demoStateSchema>;
export const phrases = [
  "I have a question",
  "Please repeat",
  "I don’t understand this step",
  "I need more time",
  "Can I answer?",
  "Please explain this",
  "I understand",
  "I need help",
] as const;
