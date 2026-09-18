import type { Diagram, ProcessingJob } from "../../shared/model";
import { emptyStructure } from "../../shared/model";
import type { Repos } from "../repositories/types";
import { conflictError, forbiddenError, notFoundError, payloadTooLargeError, validationError } from "../core/errors";
import type { Logger } from "../core/logger";
import { newId, nowIso } from "./clock";
import type { Actor } from "./lesson-service";
import type { PresignedUploadProvider } from "../core/presign";
import type { DiagramSenseService } from "./diagram-sense-service";
import type { BinaryStorage } from "../core/storage";
import { imageType } from "../providers/image-type";
import { verifyUploadToken, signUploadToken } from "../core/ids";
import type { AppConfig } from "../core/config";

/** Metadata the teacher supplies when registering a diagram (license required). */
export interface RegisterDiagramInput {
  lessonId: string;
  sourceType: string;
  licenseName: string;
  attribution?: string;
  sourceUrl?: string | null;
  /** Declared content type; verified later by magic bytes, never trusted. */
  contentType: "image/png" | "image/jpeg";
}

export class DiagramUploadService {
  constructor(
    private readonly repos: Repos,
    private readonly presign: PresignedUploadProvider,
    private readonly sense: DiagramSenseService,
    private readonly storage: BinaryStorage,
    private readonly config: AppConfig,
    private readonly log: Logger,
  ) {}

  /** POST /lessons/:lessonId/diagrams — records metadata, no bytes yet. */
  async registerDiagram(actor: Actor, input: RegisterDiagramInput): Promise<Diagram> {
    const lesson = await this.repos.lessons.get(input.lessonId);
    if (!lesson) throw notFoundError("Lesson not found.");
    if (actor.role !== "teacher" || actor.userId !== lesson.teacherId)
      throw forbiddenError("Only the lesson's teacher can add diagrams.");
    // License metadata is required AT REGISTRATION — a diagram without
    // source/license metadata can never enter the pipeline at all.
    if (!input.sourceType?.trim() || !input.licenseName?.trim())
      throw validationError("sourceType and licenseName are required before a diagram can be registered.");
    const now = nowIso();
    const diagram: Diagram = {
      diagramId: newId(),
      lessonId: lesson.lessonId,
      originalS3Key: null,
      mimeType: null,
      byteSize: 0,
      sourceMetadata: {
        sourceType: input.sourceType,
        licenseName: input.licenseName,
        attribution: input.attribution ?? "",
        sourceUrl: input.sourceUrl ?? null,
      },
      processingStatus: "pending",
      activeVersionId: null,
      activeJobId: null,
      revision: 0,
      createdAt: now,
      updatedAt: now,
    };
    await this.repos.diagrams.put(diagram, null);
    // Every diagram needs an editable draft version from birth — the
    // pipeline and manual editor both write into the latest draft.
    await this.repos.versions.create({
      versionId: newId(),
      diagramId: diagram.diagramId,
      lessonId: lesson.lessonId,
      version: 1,
      status: "draft",
      publishedAt: null,
      publishedBy: null,
      structure: emptyStructure,
      createdAt: now,
    });
    await this.audit(lesson.lessonId, actor, "diagram_registered", `Diagram ${diagram.diagramId} registered (${diagram.sourceMetadata.licenseName}).`);
    return diagram;
  }

  /** GET /lessons/:lessonId/diagrams */
  async listDiagrams(actor: Actor, lessonId: string): Promise<Diagram[]> {
    const lesson = await this.repos.lessons.get(lessonId);
    if (!lesson) throw notFoundError("Lesson not found.");
    if (actor.role !== "teacher" || actor.userId !== lesson.teacherId)
      throw forbiddenError("Only the lesson's teacher can list diagrams.");
    return this.repos.diagrams.listByLesson(lessonId);
  }

  /**
   * POST /diagrams/:diagramId/upload-url — grants a direct-upload form
   * (real S3 POST policy in cloud mode; HMAC-signed local grant otherwise).
   * The grant expires, allows exactly one content type, caps the size and
   * targets a unique server-generated key; the bucket stays private.
   */
  async createUploadUrl(actor: Actor, diagramId: string, contentType?: "image/png" | "image/jpeg"): Promise<{
    url: string;
    fields: Record<string, string>;
    expiresAt: number;
    key: string;
    mode: "s3" | "local";
    maxBytes: number;
    contentType: "image/png" | "image/jpeg";
    confirmationToken: string;
  }> {
    const { diagram } = await this.getOwnedDiagram(actor, diagramId);
    if (diagram.originalS3Key)
      throw conflictError("This diagram already has an uploaded image.");
    const grant = await this.presign.createGrant({
      diagramId,
      contentType: contentType ?? "image/png",
      maxSize: this.config.maxUploadBytes,
      expiresInSeconds: this.config.presignExpiresSeconds,
    });
    return {
      url: grant.url,
      fields: grant.fields,
      expiresAt: grant.expiresAt,
      key: grant.key,
      mode: grant.mode,
      maxBytes: grant.maxSize,
      contentType: grant.contentType,
      confirmationToken: signUploadToken(this.config.uploadTokenSecret, {
        diagramId, key: grant.key, contentType: grant.contentType, maxSize: grant.maxSize, expiresAt: grant.expiresAt,
      }),
    };
  }

  /**
   * Local-mode sink: accepts the raw bytes of a previously granted local
   * upload, verifies the HMAC grant (binding key, size cap, content type,
   * expiry, diagram) then runs magic-byte validation — the same rules the
   * S3 POST policy enforces in cloud mode. This is the LOCAL adapter only:
   * responses never claim an S3 upload happened.
   */
  async confirmLocalUpload(actor: Actor, input: {
    diagramId: string;
    key: string;
    maxSize: number;
    contentType: string;
    expiresAt: number;
    token: string;
    bytes: Buffer;
  }): Promise<{ diagram: Diagram; verified: { mimeType: "image/png" | "image/jpeg"; byteSize: number; mode: "local" } }> {
    const { diagram } = await this.getOwnedDiagram(actor, input.diagramId);
    if (diagram.originalS3Key) throw conflictError("This diagram already has an uploaded image.");
    const contentType = input.contentType;
    if (contentType !== "image/png" && contentType !== "image/jpeg")
      throw validationError("Only PNG or JPEG uploads are accepted.");
    const valid = verifyUploadToken(
      this.config.uploadTokenSecret,
      { key: input.key, maxSize: input.maxSize, contentType, expiresAt: input.expiresAt, diagramId: input.diagramId },
      input.token,
    );
    if (!valid) throw validationError("Invalid upload grant.");
    if (input.expiresAt < Date.now())
      throw validationError("Upload grant expired. Request a new upload URL.");
    if (input.bytes.length > this.config.maxUploadBytes)
      throw payloadTooLargeError("Image exceeds the 5 MB limit.");
    if (input.bytes.length > input.maxSize)
      throw payloadTooLargeError("Image exceeds the granted size limit.");
    if (input.bytes.length === 0)
      throw validationError("Empty upload.");
    // Magic bytes only: extension and browser MIME type are never trusted.
    const detected = imageType(input.bytes);
    if (!detected || detected !== contentType)
      throw validationError("File contents do not match a supported PNG or JPEG image below 5 MB.");
    await this.storage.put(input.key, input.bytes, detected);
    const updated: Diagram = {
      ...diagram,
      originalS3Key: input.key,
      mimeType: detected,
      byteSize: input.bytes.length,
      updatedAt: nowIso(),
      revision: diagram.revision + 1,
    };
    await this.repos.diagrams.put(updated, diagram.revision);
    await this.audit(diagram.lessonId, actor, "diagram_uploaded", `Diagram ${diagram.diagramId} stored locally (${detected}, ${input.bytes.length} bytes).`);
    return { diagram: updated, verified: { mimeType: detected, byteSize: input.bytes.length, mode: "local" } };
  }

  /** Verify an owned S3 grant and freeze its bytes under a non-uploadable key. */
  async confirmS3Upload(actor: Actor, input: {
    diagramId: string; key: string; maxSize: number; contentType: "image/png" | "image/jpeg";
    expiresAt: number; token: string;
  }): Promise<Diagram> {
    if (!this.config.s3Bucket) throw conflictError("S3 uploads are not configured.");
    const { diagram } = await this.getOwnedDiagram(actor, input.diagramId);
    if (diagram.originalS3Key) throw conflictError("This diagram already has an uploaded image.");
    if (!verifyUploadToken(this.config.uploadTokenSecret, input, input.token) || input.expiresAt < Date.now())
      throw validationError("Invalid or expired upload confirmation grant.");
    const bytes = await this.storage.get(input.key);
    if (!bytes.length || bytes.length > Math.min(input.maxSize, this.config.maxUploadBytes))
      throw payloadTooLargeError("Uploaded image exceeds the allowed size.");
    const mime = imageType(bytes);
    if (!mime || mime !== input.contentType) throw validationError("Uploaded object is not the granted image type.");
    const key = `verified/${diagram.diagramId}/${newId()}.${mime === "image/png" ? "png" : "jpg"}`;
    await this.storage.put(key, bytes, mime);
    const updated = { ...diagram, originalS3Key: key, mimeType: mime, byteSize: bytes.length,
      revision: diagram.revision + 1, updatedAt: nowIso() };
    await this.repos.diagrams.put(updated, diagram.revision);
    await this.audit(diagram.lessonId, actor, "diagram_uploaded", `Diagram ${diagram.diagramId} verified from private S3.`);
    return updated;
  }

  /**
   * POST /diagrams/:diagramId/process — kicks off the DiagramSense pipeline
   * (OCR → proposal → validator → teacher review). One run per diagram;
   * duplicate requests 409. Cloud Step Functions layout: docs/DIAGRAM_PIPELINE.md.
   */
  async startProcessing(actor: Actor, diagramId: string): Promise<{
    diagram: Diagram;
    job: { jobId: string; mode: string; status: ProcessingJob["status"]; stages: ProcessingJob["stages"] };
    issues: Array<{ code: string; severity: "error" | "warning"; itemId: string; message: string }>;
  }> {
    const { diagram } = await this.getOwnedDiagram(actor, diagramId);
    if (!diagram.originalS3Key || !diagram.mimeType)
      throw conflictError("Upload the diagram image before starting processing.");
    if (diagram.processingStatus === "processing")
      throw conflictError("Processing is already running for this diagram.");
    if (diagram.processingStatus === "published")
      throw conflictError("This diagram is already published.");
    if (diagram.activeJobId)
      throw conflictError("A processing job already exists for this diagram.");
    await this.audit(diagram.lessonId, actor, "processing_started", `DiagramSense pipeline started for diagram ${diagramId}.`);
    const result = await this.sense.runPipeline(actor, diagramId);
    return {
      diagram: result.diagram,
      job: { jobId: result.job.jobId, mode: "local", status: result.job.status, stages: result.job.stages },
      issues: result.issues,
    };
  }

  /** GET /diagrams/:diagramId/processing-status */
  async processingStatus(actor: Actor, diagramId: string): Promise<{
    diagramId: string;
    processingStatus: Diagram["processingStatus"];
    activeJobId: string | null;
    stages: ProcessingJob["stages"] | null;
    error: string | null;
    mode: "stepfunctions" | "local" | "none";
  }> {
    await this.getOwnedDiagram(actor, diagramId);
    const diagram = (await this.repos.diagrams.get(diagramId)) as Diagram;
    if (!diagram.activeJobId)
      return { diagramId, processingStatus: diagram.processingStatus, activeJobId: null, stages: null, error: null, mode: "none" };
    const job = await this.repos.jobs.get(diagram.activeJobId);
    if (!job)
      return { diagramId, processingStatus: diagram.processingStatus, activeJobId: diagram.activeJobId, stages: null, error: null, mode: "none" };
    const mode = job.jobId.startsWith("arn:aws:states:") ? "stepfunctions" : "local";
    return {
      diagramId,
      processingStatus: diagram.processingStatus,
      activeJobId: diagram.activeJobId,
      stages: job.stages,
      error: job.error,
      mode,
    };
  }

  private async getOwnedDiagram(actor: Actor, diagramId: string): Promise<{ diagram: Diagram; lessonId: string }> {
    const diagram = await this.repos.diagrams.get(diagramId);
    if (!diagram) throw notFoundError("Diagram not found.");
    const lesson = await this.repos.lessons.get(diagram.lessonId);
    if (!lesson) throw notFoundError("Lesson for diagram not found.");
    if (actor.role !== "teacher" || actor.userId !== lesson.teacherId)
      throw forbiddenError("Only the lesson's teacher can manage this diagram.");
    return { diagram, lessonId: diagram.lessonId };
  }

  private async audit(lessonId: string, actor: Actor, action: string, detail: string) {
    await this.repos.audit.put({
      eventId: newId(),
      lessonId,
      actorId: actor.userId,
      actorRole: actor.role,
      action,
      detail,
      createdAt: nowIso(),
    });
  }
}
