import {
  type Approval,
  type Diagram,
  type DiagramPart,
  type DiagramStructure,
  type DiagramVersion,
  type Lesson,
  type ProcessFlow,
  type Relationship,
  type VocabularyTerm,
  emptyStructure,
} from "../../shared/model";
import {
  TRUST_TRANSITIONS,
  assertTransition,
  targetStateFor,
  type TrustState,
} from "../../shared/trust";
import type { Repos } from "../repositories/types";
import { RepoConditionFailedError } from "../repositories/types";
import {
  conflictError,
  forbiddenError,
  immutableError,
  notFoundError,
  revisionConflictError,
  validationError,
} from "../core/errors";
import type { Logger } from "../core/logger";
import { newId, nowIso } from "./clock";
import { validateStructure } from "./validation";

export interface Actor {
  userId: string;
  role: "teacher" | "student";
}

const REVIEWABLE: readonly TrustState[] = ["ai_proposed", "needs_review", "validated"];

/**
 * Lesson/diagram domain service. All trust-state transitions, immutability
 * and publish gating are enforced HERE (backend), never trusted from the UI.
 */
export class LessonService {
  constructor(
    private readonly repos: Repos,
    private readonly log: Logger,
  ) {}

  /* ----------------------------- Lesson --------------------------------- */

  async createLesson(actor: Actor, input: { title: string; description?: string }): Promise<Lesson> {
    if (actor.role !== "teacher") throw forbiddenError("Only teachers can create lessons.");
    const now = nowIso();
    const lesson: Lesson = {
      lessonId: newId(),
      teacherId: actor.userId,
      title: input.title,
      description: input.description ?? "",
      status: "draft",
      revision: 0,
      createdAt: now,
      updatedAt: now,
      publishedVersionId: null,
    };
    await this.repos.lessons.put(lesson, null);
    await this.audit(lesson.lessonId, actor, "lesson_created", `Created lesson "${lesson.title}".`);
    this.log.info("lesson.created", { lessonId: lesson.lessonId, teacherId: actor.userId });
    return lesson;
  }

  async getLesson(actor: Actor, lessonId: string): Promise<Lesson> {
    const lesson = await this.repos.lessons.get(lessonId);
    if (!lesson) throw notFoundError("Lesson not found.");
    if (actor.role !== "teacher" && actor.userId !== lesson.teacherId) {
      // Students may only learn that a lesson exists via published routes;
      // metadata stays teacher-scoped.
      throw forbiddenError("This lesson belongs to another teacher.");
    }
    return lesson;
  }

  async listLessons(actor: Actor): Promise<Lesson[]> {
    if (actor.role !== "teacher") throw forbiddenError("Only teachers can list lessons.");
    return this.repos.lessons.listByTeacher(actor.userId);
  }

  /* ----------------------------- Diagram -------------------------------- */

  async createDiagram(
    actor: Actor,
    input: {
      lessonId: string;
      /** Set when bytes are already on the server; null for presigned flow. */
      originalS3Key: string | null;
      mimeType: "image/png" | "image/jpeg" | null;
      byteSize: number;
      sourceMetadata: Diagram["sourceMetadata"];
      /** Optional caller-supplied id so the S3 key matches the diagram id. */
      diagramId?: string;
    },
  ): Promise<{ diagram: Diagram; version: DiagramVersion }> {
    const lesson = await this.repos.lessons.get(input.lessonId);
    if (!lesson) throw notFoundError("Lesson not found.");
    if (actor.role !== "teacher" || actor.userId !== lesson.teacherId)
      throw forbiddenError("Only the lesson's teacher can add diagrams.");
    const now = nowIso();
    const diagram: Diagram = {
      diagramId: input.diagramId ?? newId(),
      lessonId: lesson.lessonId,
      originalS3Key: input.originalS3Key,
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      sourceMetadata: input.sourceMetadata,
      processingStatus: "awaiting_review",
      activeVersionId: null,
      activeJobId: null,
      revision: 0,
      createdAt: now,
      updatedAt: now,
    };
    await this.repos.diagrams.put(diagram, null);
    const version = await this.createDraftVersion(diagram.diagramId, lesson.lessonId, 1, emptyStructure, now);
    await this.audit(lesson.lessonId, actor, "diagram_created", `Diagram ${diagram.diagramId} created.`);
    return { diagram, version };
  }

  async getDiagram(actor: Actor, diagramId: string): Promise<{ diagram: Diagram; lesson: Lesson }> {
    const diagram = await this.repos.diagrams.get(diagramId);
    if (!diagram) throw notFoundError("Diagram not found.");
    const lesson = await this.repos.lessons.get(diagram.lessonId);
    if (!lesson) throw notFoundError("Lesson for diagram not found.");
    if (actor.role !== "teacher" || actor.userId !== lesson.teacherId)
      throw forbiddenError("Only the lesson's teacher can view draft diagrams.");
    return { diagram, lesson };
  }

  async listDiagramsForLesson(lessonId: string): Promise<Diagram[]> {
    return this.repos.diagrams.listByLesson(lessonId);
  }

  /* ------------------------- Draft structure ----------------------------- */

  async createDraftVersion(
    diagramId: string,
    lessonId: string,
    version: number,
    structure: DiagramStructure,
    now: string,
  ): Promise<DiagramVersion> {
    const versionRecord: DiagramVersion = {
      versionId: newId(),
      diagramId,
      lessonId,
      version,
      status: "draft",
      publishedAt: null,
      publishedBy: null,
      structure,
      createdAt: now,
    };
    await this.repos.versions.create(versionRecord);
    await this.repos.structure.putAll(versionRecord.versionId, diagramId, version, structure);
    return versionRecord;
  }

  /** Current editable (draft) version; throws when the diagram only has published versions. */
  async draftVersion(actor: Actor, diagramId: string): Promise<{ version: DiagramVersion; lesson: Lesson }> {
    const { diagram, lesson } = await this.getDiagram(actor, diagramId);
    const versions = await this.repos.versions.list(diagramId);
    const draft = versions.filter((v) => v.status === "draft").sort((a, b) => b.version - a.version)[0];
    if (!draft)
      throw conflictError("No editable draft version. Create a new version to edit published content.");
    return { version: draft, lesson };
  }

  /**
   * Replace the draft structure. Editing re-runs the deterministic validator
   * and resets item states to ai_proposed (no stale approvals survive an edit).
   */
  async saveStructure(
    actor: Actor,
    input: { diagramId: string; structure: DiagramStructure; expectedVersionCreatedAt: string },
  ): Promise<DiagramVersion> {
    const { version, lesson } = await this.draftVersion(actor, input.diagramId);
    if (version.createdAt !== input.expectedVersionCreatedAt)
      throw revisionConflictError("This draft changed in another window. Reload before saving.");
    const reset = this.resetStates(input.structure);
    const issues = validateStructure(reset);
    const revalidated = this.applyValidationStates(reset, issues);
    const next: DiagramVersion = { ...version, structure: revalidated };
    // Draft structure updates rewrite the same draft version row: allowed
    // because it has never been published (immutability applies to published rows).
    await this.repos.structure.putAll(version.versionId, input.diagramId, version.version, revalidated);
    await this.rewriteDraftVersion(next, input.diagramId, version.version);
    this.log.info("structure.saved", {
      diagramId: input.diagramId,
      version: version.version,
      issues: issues.length,
    });
    return next;
  }

  private async rewriteDraftVersion(version: DiagramVersion, _diagramId: string, _versionNumber: number): Promise<void> {
    // Draft rows may be rewritten; published rows are immutable and every
    // adapter refuses replaceDraft on them (second line of defense).
    await this.repos.versions.replaceDraft(version);
  }

  private resetStates(structure: DiagramStructure): DiagramStructure {
    const resetItem = <T extends { state: TrustState; reviewNote: string }>(item: T): T => ({
      ...item,
      state: "ai_proposed",
      reviewNote: "",
    });
    return {
      labels: structure.labels,
      parts: structure.parts.map(resetItem),
      relations: structure.relations.map(resetItem),
      flows: structure.flows.map(resetItem),
    };
  }

  private applyValidationStates(structure: DiagramStructure, issues: { itemId: string }[]): DiagramStructure {
    const flagged = new Set(issues.map((i) => i.itemId));
    const mapItem = <T extends { state: TrustState; partId?: string; relationId?: string; flowId?: string }>(item: T): T => {
      const id = item.partId ?? item.relationId ?? item.flowId ?? "";
      if (item.state === "teacher_approved" || item.state === "rejected") return item;
      return { ...item, state: flagged.has(id) ? "needs_review" : "validated" };
    };
    return {
      labels: structure.labels,
      parts: structure.parts.map(mapItem),
      relations: structure.relations.map(mapItem),
      flows: structure.flows.map(mapItem),
    };
  }

  /* ----------------------------- Decisions -------------------------------- */

  async decide(
    actor: Actor,
    input: {
      diagramId: string;
      itemId: string;
      itemType: "part" | "relation" | "flow";
      decision: "approve" | "reject";
      note: string;
      expectedVersionCreatedAt: string;
    },
  ): Promise<DiagramVersion> {
    const { version, lesson } = await this.draftVersion(actor, input.diagramId);
    if (version.createdAt !== input.expectedVersionCreatedAt)
      throw revisionConflictError("This draft changed in another window. Reload before deciding.");
    if (version.status !== "draft") throw immutableError("Published versions are immutable.");

    const structure = structuredClone(version.structure);
    const item = this.findItem(structure, input.itemId, input.itemType);
    if (!item) throw notFoundError("Content item not found in this draft.");

    const from = item.state;
    if (input.decision === "approve") {
      // Approving a rejected item re-opens it first; rejection must not bypass validation.
      if (from === "rejected") assertTransition(input.itemId, from, "needs_review");
      // Re-run the deterministic validator as if the item were active,
      // so rejection cannot hide structural errors.
      const evaluate = from === "rejected" ? "needs_review" : from;
      item.state = evaluate;
      const issues = validateStructure(structure).filter((i) => i.itemId === input.itemId);
      if (issues.some((i) => i.severity === "error"))
        throw validationError("Fix structural errors before approving this item.", issues);
      if (issues.length && !input.note.trim())
        throw validationError("Add a review note explaining how you checked the flagged item.");
      // Approval walks the legal path: current -> validated -> teacher_approved.
      if (evaluate !== "validated") assertTransition(input.itemId, evaluate, "validated");
      assertTransition(input.itemId, "validated", "teacher_approved");
      item.state = "teacher_approved";
    } else {
      assertTransition(input.itemId, from, "rejected");
      item.state = "rejected";
    }
    item.reviewNote = input.note;

    // A rejection can invalidate previously approved dependencies.
    const issues = validateStructure(structure).filter((i) => i.severity === "error");
    const invalid = new Set(issues.map((i) => i.itemId));
    for (const candidate of [...structure.parts, ...structure.relations, ...structure.flows]) {
      const id = "partId" in candidate ? candidate.partId : "relationId" in candidate ? candidate.relationId : candidate.flowId;
      if (candidate.state === "teacher_approved" && invalid.has(id)) {
        assertTransition(id, "teacher_approved", "needs_review");
        candidate.state = "needs_review";
        candidate.reviewNote = "";
      }
    }
    const flagged = new Set(validateStructure(structure).map((i) => i.itemId));
    for (const candidate of [...structure.parts, ...structure.relations, ...structure.flows]) {
      const id = "partId" in candidate ? candidate.partId : "relationId" in candidate ? candidate.relationId : candidate.flowId;
      if (!["teacher_approved", "rejected"].includes(candidate.state))
        candidate.state = flagged.has(id) ? "needs_review" : "validated";
    }

    const next: DiagramVersion = { ...version, structure };
    await this.repos.structure.putAll(version.versionId, input.diagramId, version.version, structure);
    await this.rewriteDraftVersion(next, input.diagramId, version.version);
    await this.repos.approvals.put({
      approvalId: newId(),
      versionId: version.versionId,
      itemId: input.itemId,
      itemType: input.itemType,
      teacherId: actor.userId,
      decision: input.decision,
      note: input.note,
      createdAt: nowIso(),
    });
    await this.audit(lesson.lessonId, actor, input.decision, `${input.itemId}: ${input.note || "Explicit teacher decision."}`);
    return next;
  }

  private findItem(
    structure: DiagramStructure,
    itemId: string,
    itemType: "part" | "relation" | "flow",
  ): (DiagramPart | Relationship | ProcessFlow) | undefined {
    switch (itemType) {
      case "part": return structure.parts.find((p) => p.partId === itemId);
      case "relation": return structure.relations.find((r) => r.relationId === itemId);
      case "flow": return structure.flows.find((f) => f.flowId === itemId);
    }
  }

  /* ------------------------------ Publish -------------------------------- */

  /**
   * Gated, race-safe publish (docs/DYNAMODB.md conditional writes):
   *  - every non-rejected item must be teacher_approved
   *  - at least one approved part
   *  - no blocking errors
   * Then a single transaction: create immutable version row + approvals +
   * flip diagram.activeVersionId + flip lesson status.
   */
  async publish(actor: Actor, input: { diagramId: string; expectedVersionCreatedAt: string }): Promise<DiagramVersion> {
    const { version, lesson } = await this.draftVersion(actor, input.diagramId);
    if (version.createdAt !== input.expectedVersionCreatedAt)
      throw revisionConflictError("This draft changed in another window. Reload before publishing.");
    if (version.status !== "draft") throw immutableError("This version is already published.");

    // LICENSE GATE: a diagram cannot be published without complete
    // source/license metadata. Backend-enforced, not just UI.
    const diagram = await this.repos.diagrams.get(input.diagramId);
    if (!diagram) throw notFoundError("Diagram not found.");
    const meta = diagram.sourceMetadata;
    if (!meta?.sourceType?.trim() || !meta?.licenseName?.trim()) {
      this.log.warn("publish.blocked_missing_license", { diagramId: input.diagramId, lessonId: lesson.lessonId });
      throw conflictError("Source/license metadata is missing for this diagram. Add source type and license before publishing.");
    }

    const structure = version.structure;
    const items = [...structure.parts, ...structure.relations, ...structure.flows];
    const undecided = items.filter((i) => !["teacher_approved", "rejected"].includes(i.state));
    if (undecided.length)
      throw conflictError(`Every content item needs an explicit decision (${undecided.length} remaining).`);
    if (!structure.parts.some((p) => p.state === "teacher_approved"))
      throw conflictError("Approve at least one part before publishing.");
    if (validateStructure(structure).some((i) => i.severity === "error"))
      throw conflictError("Resolve structural errors before publishing.");

    const published: DiagramVersion = {
      ...version,
      status: "published",
      publishedAt: nowIso(),
      publishedBy: actor.userId,
      structure: {
        labels: structure.labels.filter((l) => structure.parts.some((p) => p.state === "teacher_approved" && p.labelId === l.labelId)),
        parts: structure.parts.filter((p) => p.state === "teacher_approved"),
        relations: structure.relations.filter((r) => r.state === "teacher_approved"),
        flows: structure.flows.filter((f) => f.state === "teacher_approved"),
      },
    };

    const approvals: Approval[] = items
      .filter((i) => i.state === "teacher_approved")
      .map((i) => ({
        approvalId: newId(),
        versionId: version.versionId,
        itemId: "partId" in i ? i.partId : "relationId" in i ? i.relationId : i.flowId,
        itemType: "partId" in i ? ("part" as const) : "relationId" in i ? ("relation" as const) : ("flow" as const),
        teacherId: actor.userId,
        decision: "approve" as const,
        note: i.reviewNote,
        createdAt: nowIso(),
      }));

    const terms: VocabularyTerm[] = published.structure.parts.map((p) => ({
      termId: p.partId,
      lessonId: lesson.lessonId,
      versionId: published.versionId,
      name: p.name,
      definition: p.description,
      partId: p.partId,
      labelId: p.labelId,
      state: "teacher_approved" as const,
      createdAt: published.publishedAt as string,
    }));

    const now = nowIso();
    try {
      await this.repos.publish.publish({
        version: published,
        approvals,
        diagramId: input.diagramId,
        expectedActiveVersionId: null,
        lessonId: lesson.lessonId,
        expectedLessonRevision: lesson.revision,
        publishedLessonStatus: "published",
        publishedVersionId: published.versionId,
        lessonUpdatedAt: now,
      });
    } catch (error) {
      if (error instanceof RepoConditionFailedError)
        throw conflictError("Publish raced with another update. Reload and retry.");
      throw error;
    }

    await this.repos.vocabulary.replaceForVersion(lesson.lessonId, published.versionId, terms);
    await this.audit(lesson.lessonId, actor, "published", `Published immutable version ${published.version}.`);
    this.log.info("lesson.published", {
      lessonId: lesson.lessonId,
      diagramId: input.diagramId,
      version: published.version,
      approvedItems: approvals.length,
    });
    return published;
  }

  /** Teacher edits published content -> new draft version (never mutate the old). */
  async newDraftVersion(actor: Actor, diagramId: string): Promise<DiagramVersion> {
    const { diagram, lesson } = await this.getDiagram(actor, diagramId);
    const versions = await this.repos.versions.list(diagramId);
    const latest = versions.sort((a, b) => b.version - a.version)[0];
    if (!latest) throw notFoundError("Diagram has no versions.");
    const nextNumber = latest.version + 1;
    const now = nowIso();
    const next = await this.createDraftVersion(diagramId, lesson.lessonId, nextNumber, structuredClone(latest.structure), now);
    await this.repos.diagrams.put(
      { ...diagram, processingStatus: "awaiting_review", updatedAt: now },
      diagram.revision,
    ).catch(() => {
      throw revisionConflictError("Diagram changed in another window. Reload first.");
    });
    await this.audit(lesson.lessonId, actor, "version_created", `Created draft version ${nextNumber}; previous publication retained.`);
    return next;
  }

  /* ------------------------------- Read paths ------------------------------ */

  async publishedVersionForStudent(diagramId: string): Promise<DiagramVersion> {
    const diagram = await this.repos.diagrams.get(diagramId);
    if (!diagram?.activeVersionId) throw notFoundError("No published version is available yet.");
    const versions = await this.repos.versions.list(diagramId);
    const published = versions.find((v) => v.versionId === diagram.activeVersionId);
    if (!published || published.status !== "published")
      throw notFoundError("No published version is available yet.");
    // Defense-in-depth: student payloads must contain approved items only.
    const bad = [...published.structure.parts, ...published.structure.relations, ...published.structure.flows]
      .some((i) => i.state !== "teacher_approved");
    if (bad) throw new Error("Published content failed the approval check.");
    return published;
  }

  async listVersions(actor: Actor, diagramId: string): Promise<DiagramVersion[]> {
    await this.getDiagram(actor, diagramId);
    return this.repos.versions.list(diagramId);
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

// Re-exported for tests: legal transitions are data, checked exhaustively there.
export { TRUST_TRANSITIONS, REVIEWABLE };
