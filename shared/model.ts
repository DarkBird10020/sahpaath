import { z } from "zod";
import { TRUST_STATES } from "./trust";

/** Identifier used across all entities: URL-safe, bounded. */
export const entityId = z
  .string()
  .regex(/^[a-zA-Z0-9_-]{1,80}$/);
export type EntityId = string;

export const isoTimestamp = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/, {
    message: "Must be an ISO-8601 UTC timestamp",
  });

export const trustStateSchema = z.enum(TRUST_STATES);

/* ------------------------------- User ---------------------------------- */

export const userRoleSchema = z.enum(["teacher", "student"]);

export const userSchema = z
  .object({
    userId: entityId,
    role: userRoleSchema,
    displayName: z.string().trim().min(1).max(120),
    /** Students are anonymous: this is null for student users. */
    email: z.string().email().max(200).nullable(),
    createdAt: isoTimestamp,
  })
  .strict();
export type User = z.infer<typeof userSchema>;

export const sessionSchema = z
  .object({
    sessionId: entityId,
    userId: entityId,
    /** SHA-256 of the opaque cookie token; the raw token is never stored. */
    tokenHash: z.string().length(64),
    /** Anonymous classroom code shown to students, e.g. "A3F9". */
    classCode: z.string().regex(/^[A-Z0-9]{4,8}$/),
    expires: z.number().int().positive(),
  })
  .strict();
export type Session = z.infer<typeof sessionSchema>;

/* ------------------------------ Lesson --------------------------------- */

export const lessonStatusSchema = z.enum(["draft", "published"]);

export const lessonSchema = z
  .object({
    lessonId: entityId,
    teacherId: entityId,
    title: z.string().trim().min(1).max(140),
    description: z.string().trim().max(2000).default(""),
    status: lessonStatusSchema,
    revision: z.number().int().nonnegative(),
    createdAt: isoTimestamp,
    updatedAt: isoTimestamp,
    /** Version id of the currently published version, null while draft-only. */
    publishedVersionId: z.string().nullable(),
  })
  .strict();
export type Lesson = z.infer<typeof lessonSchema>;

/* ------------------------------ Diagram -------------------------------- */

export const diagramLicenseSchema = z
  .object({
    /** Source type of the image, e.g. "teacher_created" | "public_domain" | "licensed" | "scanned". */
    sourceType: z.string().trim().min(1).max(80),
    /** SPDX-style license identifier or "proprietary". */
    licenseName: z.string().trim().min(1).max(120),
    attribution: z.string().trim().max(500).default(""),
    sourceUrl: z.string().url().max(500).nullable().default(null),
  })
  .strict();
export type DiagramLicense = z.infer<typeof diagramLicenseSchema>;

export const diagramSchema = z
  .object({
    diagramId: entityId,
    lessonId: entityId,
    /**
     * S3 object key of the original image. Null until the browser completes
     * the direct-to-S3 upload and the server confirms it (magic bytes etc.).
     * Object bytes themselves never live in DynamoDB.
     */
    originalS3Key: z.string().trim().min(1).max(400).nullable(),
    /** MIME type verified server-side by magic bytes after upload. */
    mimeType: z.enum(["image/png", "image/jpeg"]).nullable(),
    byteSize: z.number().int().nonnegative(),
    sourceMetadata: diagramLicenseSchema,
    processingStatus: z.enum(["pending", "processing", "awaiting_review", "published", "failed"]),
    activeVersionId: z.string().nullable(),
    /** Orchestrator execution id (Step Functions execution ARN in cloud). */
    activeJobId: z.string().nullable(),
    revision: z.number().int().nonnegative(),
    createdAt: isoTimestamp,
    updatedAt: isoTimestamp,
  })
  .strict();
export type Diagram = z.infer<typeof diagramSchema>;

export const processingStatusSchema = z.enum([
  "pending",
  "processing",
  "awaiting_review",
  "published",
  "failed",
]);

/* -------------------------- Diagram content ----------------------------- */

export const diagramLabelSchema = z
  .object({
    labelId: entityId,
    text: z.string().trim().min(1).max(120),
    /** 0..100 when produced by OCR (e.g. Textract); null for teacher-entered. */
    confidence: z.number().min(0).max(100).nullable(),
    source: z.enum(["teacher_entered", "textract", "local_ocr", "fixture"]),
    /** Normalized 0..1 geometry for hotspot rendering. */
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  })
  .strict();
export type DiagramLabel = z.infer<typeof diagramLabelSchema>;

export const diagramPartSchema = z
  .object({
    partId: entityId,
    labelId: entityId,
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(2000),
    /** Optional shorter draft (AI proposals carry all three levels). */
    descriptionShort: z.string().trim().max(400).optional(),
    /** Optional deeper draft for the Explorer's "tell me more" path. */
    descriptionDetailed: z.string().trim().max(4000).optional(),
    state: trustStateSchema,
    reviewNote: z.string().max(1000).default(""),
  })
  .strict();
export type DiagramPart = z.infer<typeof diagramPartSchema>;

export const relationshipKindSchema = z.enum([
  "flows_to",
  "connects_to",
  "supports",
]);

export const relationshipSchema = z
  .object({
    relationId: entityId,
    fromPartId: entityId,
    toPartId: entityId,
    kind: relationshipKindSchema,
    /** Grounding: source label ids that evidence this relationship. */
    evidenceLabelIds: z.array(entityId).max(30),
    state: trustStateSchema,
    reviewNote: z.string().max(1000).default(""),
  })
  .strict();
export type Relationship = z.infer<typeof relationshipSchema>;

export const processFlowSchema = z
  .object({
    flowId: entityId,
    name: z.string().trim().min(1).max(120),
    /** Ordered part ids; every consecutive pair needs a forward relationship. */
    stepPartIds: z.array(entityId).min(1).max(60),
    state: trustStateSchema,
    reviewNote: z.string().max(1000).default(""),
  })
  .strict();
export type ProcessFlow = z.infer<typeof processFlowSchema>;

export const diagramStructureSchema = z
  .object({
    labels: z.array(diagramLabelSchema).max(100),
    parts: z.array(diagramPartSchema).max(60),
    relations: z.array(relationshipSchema).max(120),
    flows: z.array(processFlowSchema).max(20),
  })
  .strict();
export type DiagramStructure = z.infer<typeof diagramStructureSchema>;

export const emptyStructure: DiagramStructure = {
  labels: [],
  parts: [],
  relations: [],
  flows: [],
};

/* --------------------------- DiagramVersion ------------------------------ */

export const versionStatusSchema = z.enum(["draft", "published"]);

export const diagramVersionSchema = z
  .object({
    versionId: entityId,
    diagramId: entityId,
    lessonId: entityId,
    version: z.number().int().positive(),
    status: versionStatusSchema,
    /** Immutable once status becomes "published". */
    publishedAt: isoTimestamp.nullable(),
    publishedBy: entityId.nullable(),
    structure: diagramStructureSchema,
    createdAt: isoTimestamp,
  })
  .strict();
export type DiagramVersion = z.infer<typeof diagramVersionSchema>;

/* ------------------------------ Approval -------------------------------- */

export const approvalSchema = z
  .object({
    approvalId: entityId,
    versionId: entityId,
    itemId: entityId,
    itemType: z.enum(["part", "relation", "flow"]),
    teacherId: entityId,
    decision: z.enum(["approve", "reject"]),
    note: z.string().max(1000).default(""),
    createdAt: isoTimestamp,
  })
  .strict();
export type Approval = z.infer<typeof approvalSchema>;

/* ---------------------------- VocabularyTerm ---------------------------- */

export const vocabularyTermSchema = z
  .object({
    termId: entityId,
    lessonId: entityId,
    versionId: entityId,
    /** Canonical approved name, e.g. "Pulmonary artery". */
    name: z.string().trim().min(1).max(120),
    definition: z.string().trim().min(1).max(2000),
    partId: entityId,
    labelId: entityId,
    state: z.literal("teacher_approved"),
    createdAt: isoTimestamp,
  })
  .strict();
export type VocabularyTerm = z.infer<typeof vocabularyTermSchema>;

/* --------------------------- Captions ----------------------------------- */

export const captionSessionSchema = z
  .object({
    sessionId: entityId,
    lessonId: entityId,
    versionId: entityId,
    /** "live" is future Transcribe streaming; "loaded" transcripts only today. */
    mode: z.enum(["loaded", "manual", "live"]),
    startedAt: isoTimestamp,
    revision: z.number().int().nonnegative(),
  })
  .strict();
export type CaptionSession = z.infer<typeof captionSessionSchema>;

export const captionSegmentSchema = z
  .object({
    segmentId: entityId,
    sessionId: entityId,
    lessonId: entityId,
    index: z.number().int().nonnegative(),
    text: z.string().trim().min(1).max(4000),
    /** Retained original when a teacher corrects vocabulary. */
    originalText: z.string().max(4000).optional(),
    corrections: z
      .array(
        z
          .object({
            from: z.string().min(1).max(120),
            to: z.string().min(1).max(120),
            termId: entityId,
          })
          .strict(),
      )
      .max(100)
      .default([]),
    createdAt: isoTimestamp,
  })
  .strict();
export type CaptionSegment = z.infer<typeof captionSegmentSchema>;

/* ------------------------ Communication --------------------------------- */

export const communicationPhraseSchema = z
  .object({
    phraseId: entityId,
    lessonId: entityId,
    text: z.string().trim().min(1).max(200),
    /** null for fixed fast phrases; set for "Ask about <term>" anchors. */
    conceptPartId: entityId.nullable(),
    sortOrder: z.number().int().nonnegative(),
  })
  .strict();
export type CommunicationPhrase = z.infer<typeof communicationPhraseSchema>;

export const studentQuestionSchema = z
  .object({
    questionId: entityId,
    lessonId: entityId,
    versionId: entityId,
    /** Anonymous student session, never a student name. */
    studentSessionId: entityId,
    conceptPartId: entityId.nullable(),
    text: z.string().trim().min(1).max(500),
    acknowledged: z.boolean(),
    acknowledgedAt: isoTimestamp.nullable(),
    createdAt: isoTimestamp,
  })
  .strict();
export type StudentQuestion = z.infer<typeof studentQuestionSchema>;

/* ---------------------------- ProcessingJob ------------------------------ */

export const processingJobSchema = z
  .object({
    jobId: entityId,
    diagramId: entityId,
    lessonId: entityId,
    kind: z.enum(["ocr", "ai_analysis", "audio", "custom"]),
    status: z.enum(["queued", "running", "succeeded", "failed"]),
    /** Provider-agnostic stages with honest simulation flags. */
    stages: z
      .array(
        z
          .object({
            name: z.string().min(1).max(80),
            status: z.enum(["completed", "waiting", "fallback", "locked", "failed", "running"]),
            simulation: z.boolean(),
            detail: z.string().max(500),
            durationMs: z.number().nonnegative().nullable(),
          })
          .strict(),
      )
      .max(20),
    error: z.string().max(1000).nullable(),
    createdAt: isoTimestamp,
    updatedAt: isoTimestamp,
  })
  .strict();
export type ProcessingJob = z.infer<typeof processingJobSchema>;

/* ------------------------------ AuditEvent ------------------------------- */

export const auditEventSchema = z
  .object({
    eventId: entityId,
    lessonId: entityId.nullable(),
    actorId: entityId.nullable(),
    actorRole: userRoleSchema.nullable(),
    action: z.string().min(1).max(80),
    detail: z.string().max(1000),
    createdAt: isoTimestamp,
  })
  .strict();
export type AuditEvent = z.infer<typeof auditEventSchema>;

/* ------------------------------ Re-exports ------------------------------- */

export const allEntitySchemas = {
  user: userSchema,
  session: sessionSchema,
  lesson: lessonSchema,
  diagram: diagramSchema,
  diagramVersion: diagramVersionSchema,
  approval: approvalSchema,
  vocabularyTerm: vocabularyTermSchema,
  captionSession: captionSessionSchema,
  captionSegment: captionSegmentSchema,
  communicationPhrase: communicationPhraseSchema,
  studentQuestion: studentQuestionSchema,
  processingJob: processingJobSchema,
  auditEvent: auditEventSchema,
} as const;
