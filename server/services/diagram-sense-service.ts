import type { Diagram, Lesson, ProcessingJob } from "../../shared/model";
import type { Repos } from "../repositories/types";
import {
  conflictError,
  forbiddenError,
  notFoundError,
} from "../core/errors";
import type { Logger } from "../core/logger";
import { newId, nowIso } from "./clock";
import type { Actor } from "./lesson-service";
import type { BinaryStorage } from "../core/storage";
import type { AppConfig } from "../core/config";
import type { TextractClientPort, TextractDetections } from "../providers/textract";
import { normalizeOcr } from "../providers/textract";
import type { BedrockProposalClient } from "../providers/bedrock";
import { BedrockProposalError, PROMPT_VERSION } from "../providers/bedrock";
import { proposalToStructure } from "./pipeline-structure";
import type { Issue } from "./validation";
import { validateStructure } from "./validation";

/**
 * DiagramSense processing pipeline (local orchestrator).
 *
 * Upload → storage → Textract (OCR) → Bedrock (multimodal proposal) →
 * deterministic validator → ai_proposed draft + teacher review. The Step
 * Functions layout is documented in docs/DIAGRAM_PIPELINE.md; this service
 * runs the same stages in-process while that deployment is UNVERIFIED.
 *
 * Honesty rules:
 *  - a failed stage is recorded as failed, with the real error text;
 *  - "no provider configured" is recorded as fallback with simulation: true;
 *  - nothing is published from this path — teacher review is the next gate.
 */

type StageStatus = ProcessingJob["stages"][number]["status"];

const STAGE_OCR = "OCR";
const STAGE_PROPOSAL = "Semantic proposal";
const STAGE_VALIDATION = "Validation";
const STAGE_REVIEW = "Teacher review";

interface Stage {
  status: StageStatus;
  detail: string;
  simulation: boolean;
  durationMs: number | null;
}

function stageList(stages: Record<string, Stage>): ProcessingJob["stages"] {
  return [stages.ocr, stages.proposal, stages.validation, stages.review].map((s, i) => ({
    name: [STAGE_OCR, STAGE_PROPOSAL, STAGE_VALIDATION, STAGE_REVIEW][i],
    status: s.status,
    simulation: s.simulation,
    detail: s.detail,
    durationMs: s.durationMs,
  }));
}

export class DiagramSenseService {
  constructor(
    private readonly repos: Repos,
    private readonly storage: BinaryStorage,
    private readonly textract: TextractClientPort | null,
    private readonly bedrock: BedrockProposalClient | null,
    private readonly config: AppConfig,
    private readonly log: Logger,
  ) {}

  /** Re-run OCR + proposal + validation for a diagram that has bytes stored. */
  async runPipeline(actor: Actor, diagramId: string): Promise<{
    diagram: Diagram;
    job: ProcessingJob;
    issues: Issue[];
  }> {
    const { diagram, lesson } = await this.getOwnedDiagram(actor, diagramId);
    if (!diagram.originalS3Key || !diagram.mimeType)
      throw conflictError("Upload the diagram image before running the pipeline.");
    if (diagram.processingStatus === "processing")
      throw conflictError("Processing is already running for this diagram.");

    const startedAll = performance.now();
    const stages: Record<string, Stage> = {
      ocr: { status: "running", detail: "Reading labels from the image.", simulation: false, durationMs: null },
      proposal: { status: "waiting", detail: "Waiting for OCR.", simulation: false, durationMs: null },
      validation: { status: "waiting", detail: "Waiting for the proposal.", simulation: false, durationMs: null },
      review: { status: "waiting", detail: "Waiting for validation.", simulation: false, durationMs: null },
    };
    let job: ProcessingJob = {
      jobId: newId(),
      diagramId,
      lessonId: lesson.lessonId,
      kind: "ai_analysis",
      status: "running",
      stages: stageList(stages),
      error: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await this.repos.jobs.put(job);
    await this.setProcessing(diagram, "processing", job.jobId);

    const fail = async (
      message: string,
      opts: { stage: "ocr" | "proposal"; stageStatus?: StageStatus } = { stage: "ocr" },
    ) => {
      // The failing stage carries the real error text. Later stages stay
      // "waiting" — they never ran. A fallback stage keeps its own status.
      const stage = stages[opts.stage];
      stage.status = opts.stageStatus ?? "failed";
      stage.detail = message.slice(0, 500);
      if (opts.stage === "ocr") {
        stages.validation.status = "failed";
        stages.validation.detail = "Blocked by the failed OCR stage.";
      }
      job = {
        ...job,
        status: "failed",
        stages: stageList(stages),
        error: message.slice(0, 1000),
        updatedAt: nowIso(),
      };
      await this.repos.jobs.update(job, job.stages.length);
      await this.setProcessing(await this.getDiagram(diagramId), "failed", job.jobId);
      this.log.error("pipeline.failed", { diagramId, error: message });
      return { diagram: await this.getDiagram(diagramId), job, issues: [] as Issue[] };
    };

    try {
      // ------------------------------ OCR ------------------------------
      const tOcr = performance.now();
      const imageBytes = await this.storage.get(diagram.originalS3Key);
      let detections: TextractDetections;
      let ocrSimulation = false;
      if (this.textract) {
        try {
          detections = await this.textract.detect({ imageBytes });
        } catch (error) {
          return await fail(`OCR failed: ${(error as Error).message}`, { stage: "ocr" });
        }
      } else {
        ocrSimulation = true;
        detections = { lines: [] };
      }
      const labels = normalizeOcr(detections);
      stages.ocr = {
        status: "completed",
        detail: `${labels.length} label${labels.length === 1 ? "" : "s"} normalized from the image.`,
        simulation: ocrSimulation,
        durationMs: Math.round(performance.now() - tOcr),
      };

      // --------------------------- Proposal ---------------------------
      stages.proposal.status = "running";
      stages.proposal.detail = "Building the structured proposal.";
      stages.proposal.simulation = !this.bedrock;
      await this.touch(job, stages);

      const draft = await this.currentDraft(diagramId);
      const tProp = performance.now();
      let proposal = null;
      let proposalError: string | null = null;
      if (this.bedrock) {
        try {
          // Retry exactly once on malformed output (parse failures only);
          // invoke failures and post-retry parse failures are terminal.
          try {
            proposal = await this.bedrock.propose({ imageBytes, mimeType: diagram.mimeType!, ocrLabels: labels, lessonTitle: lesson.title });
          } catch (error) {
            if (error instanceof BedrockProposalError && error.stage === "parse") {
              this.log.warn("pipeline.retry_malformed", { diagramId, attempt: 2 });
              proposal = await this.bedrock.propose({ imageBytes, mimeType: diagram.mimeType!, ocrLabels: labels, lessonTitle: lesson.title });
            } else throw error;
          }
        } catch (error) {
          proposalError = (error as Error).message;
        }
      } else {
        proposalError =
          "No language model is configured for this environment. OCR labels are ready; write descriptions in the manual editor.";
      }
      if (proposalError || !proposal) {
        return await fail(proposalError!, {
          stage: "proposal",
          stageStatus: this.bedrock ? "failed" : "fallback",
        });
      }
      stages.proposal = {
        status: "completed",
        detail: `Proposal accepted (${PROMPT_VERSION}): ${proposal.parts.length} part(s) proposed.`,
        simulation: false,
        durationMs: Math.round(performance.now() - tProp),
      };

      // -------------------------- Conversion --------------------------
      const conversion = proposalToStructure(proposal, labels, draft.structure);
      if (!conversion.ok)
        return await fail("The proposal could not be grounded in the OCR labels.", { stage: "proposal" });

      // -------------------------- Validation --------------------------
      const tVal = performance.now();
      const issues = validateStructure(conversion.structure);
      const errors = issues.filter((i) => i.severity === "error").length;
      stages.validation = {
        status: "completed",
        detail: errors
          ? `${errors} blocking issue(s) need teacher attention before approval.`
          : "Deterministic validation passed.",
        simulation: false,
        durationMs: Math.round(performance.now() - tVal),
      };
      stages.review = {
        status: "waiting",
        detail: "Every part, relationship and flow needs an explicit teacher decision.",
        simulation: false,
        durationMs: null,
      };
      job = {
        ...job,
        status: "succeeded",
        stages: stageList(stages),
        error: null,
        updatedAt: nowIso(),
      };
      await this.repos.jobs.update(job, job.stages.length);

      // -------------------- Draft apply + audit -----------------------
      await this.repos.structure.putAll(draft.versionId, diagramId, draft.version, conversion.structure);
      await this.repos.versions.replaceDraft({ ...draft, structure: conversion.structure });
      await this.setProcessing(await this.getDiagram(diagramId), "awaiting_review", job.jobId);
      await this.repos.audit.put({
        eventId: newId(),
        lessonId: lesson.lessonId,
        actorId: actor.userId,
        actorRole: actor.role,
        action: "pipeline_completed",
        detail: `DiagramSense produced ${conversion.structure.parts.length} part(s), ${conversion.structure.relations.length} relation(s), ${conversion.structure.flows.length} flow(s); ${errors} blocking issue(s).`,
        createdAt: nowIso(),
      });
      this.log.info("pipeline.completed", {
        diagramId,
        jobId: job.jobId,
        labels: labels.length,
        parts: conversion.structure.parts.length,
        blocking: errors,
        totalMs: Math.round(performance.now() - startedAll),
      });
      return { diagram: await this.getDiagram(diagramId), job, issues };
    } catch (error) {
      return await fail(`Unexpected pipeline error: ${(error as Error).message}`);
    }
  }

  /** Draft payload for review UIs: OCR labels + proposed structure. */
  async draftWithLabels(actor: Actor, diagramId: string): Promise<{
    diagramId: string;
    version: number;
    labels: DiagramDraftLabels[];
    parts: DiagramPartSummary[];
  }> {
    const { diagram } = await this.getOwnedDiagram(actor, diagramId);
    const draft = await this.currentDraft(diagramId);
    return {
      diagramId: diagram.diagramId,
      version: draft.version,
      labels: draft.structure.labels,
      parts: draft.structure.parts,
    };
  }

  private async currentDraft(diagramId: string) {
    const versions = await this.repos.versions.list(diagramId);
    const draft = versions.filter((v) => v.status === "draft").sort((a, b) => b.version - a.version)[0];
    if (!draft) throw conflictError("No editable draft version exists for this diagram.");
    return draft;
  }

  private async setProcessing(diagram: Diagram, status: Diagram["processingStatus"], jobId: string) {
    const updated: Diagram = { ...diagram, processingStatus: status, activeJobId: jobId, updatedAt: nowIso() };
    await this.repos.diagrams.put(updated, diagram.revision);
  }

  private async getDiagram(diagramId: string): Promise<Diagram> {
    const d = await this.repos.diagrams.get(diagramId);
    if (!d) throw notFoundError("Diagram not found.");
    return d;
  }

  private async getOwnedDiagram(actor: Actor, diagramId: string): Promise<{ diagram: Diagram; lesson: Lesson }> {
    const diagram = await this.repos.diagrams.get(diagramId);
    if (!diagram) throw notFoundError("Diagram not found.");
    const lesson = await this.repos.lessons.get(diagram.lessonId);
    if (!lesson) throw notFoundError("Lesson for diagram not found.");
    if (actor.role !== "teacher" || actor.userId !== lesson.teacherId)
      throw forbiddenError("Only the lesson's teacher can run the pipeline.");
    return { diagram, lesson };
  }

  private async touch(job: ProcessingJob, stages: Record<string, Stage>) {
    job = { ...job, stages: stageList(stages), updatedAt: nowIso() };
    await this.repos.jobs.update(job, job.stages.length);
  }
}

export interface DiagramDraftLabels {
  labelId: string;
  text: string;
  confidence: number | null;
  x: number;
  y: number;
}

export interface DiagramPartSummary {
  partId: string;
  labelId: string;
  name: string;
  description: string;
  descriptionShort?: string;
  descriptionDetailed?: string;
  state: string;
  reviewNote: string;
}
