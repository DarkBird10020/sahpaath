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
    source: z.enum(["demo_fixture", "teacher_entered", "textract"]),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  })
  .strict();
const decision = {
  state: trustSchema,
  reviewNote: z.string().max(1000).default(""),
};
export const partSchema = z
  .object({
    id,
    labelId: id,
    name: text.max(120),
    description: text,
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
export const lessonSchema = z.object({
  id,
  title: text.max(140),
  subject: z.string().max(80),
  fixtureId: z.string().nullable(),
  image: z.string().nullable(),
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
  state: z.literal("teacher_approved"),
});
export const publishedSchema = z.object({
  lessonId: id,
  title: z.string(),
  subject: z.string(),
  version: z.number().int().positive(),
  publishedAt: z.string(),
  image: z.string().nullable(),
  map: mapSchema,
  vocabulary: z.array(termSchema),
});
export const questionSchema = z.object({
  id,
  lessonId: id,
  version: z.number().int().positive(),
  conceptId: id.nullable(),
  text: text.max(500),
  sessionCode: z.string(),
  createdAt: z.string(),
  acknowledged: z.boolean(),
});
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
export const auditSchema = z.object({
  id,
  lessonId: id,
  action: z.string(),
  detail: z.string(),
  createdAt: z.string(),
  actor: z.string(),
});
export const sessionSchema = z.object({
  role: z.enum(["teacher", "student"]),
  code: z.string(),
});
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
export type Lesson = z.infer<typeof lessonSchema>;
export type DiagramMap = z.infer<typeof mapSchema>;
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
export const phrases = [
  "I have a question",
  "Please repeat",
  "I don’t understand this step",
  "I need more time",
  "Can I answer?",
] as const;
