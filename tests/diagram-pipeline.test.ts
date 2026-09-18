import { describe, it, expect } from "vitest";
import { normalizeOcr, readingOrderSort, type TextractDetections } from "../server/providers/textract";
import { buildProposalPrompt, parseProposalText, BedrockProposalError } from "../server/providers/bedrock";
import { proposalToStructure } from "../server/services/pipeline-structure";
import { validateStructure } from "../server/services/validation";
import { diagramProposalSchema, type DiagramProposal, type OcrLabel } from "../shared/proposal";
import { DiagramSenseService } from "../server/services/diagram-sense-service";
import { createMemoryRepos } from "../server/repositories/memory";
import { LessonService, type Actor } from "../server/services/lesson-service";
import { DiagramUploadService } from "../server/services/diagram-upload-service";
import { LocalPresignedUpload } from "../server/core/presign";
import { LocalFileStorage } from "../server/core/storage";
import { loadConfig } from "../server/core/config";
import { Logger } from "../server/core/logger";

const log = new Logger(() => {}, "error");
const teacher: Actor = { userId: "teacher-local", role: "teacher" };

/** Deterministic Textract-shaped fixture: a simple pulmonary circuit. */
function fixtureDetections(): TextractDetections {
  return {
    lines: [
      { text: "Pulmonary artery", confidence: 96.4, box: { x: 0.30, y: 0.10, width: 0.20, height: 0.05 } },
      { text: "Lungs", confidence: 97.8, box: { x: 0.60, y: 0.40, width: 0.15, height: 0.05 } },
      { text: "Right ventricle", confidence: 95.1, box: { x: 0.10, y: 0.40, width: 0.22, height: 0.05 } },
      { text: "noise", confidence: 42.0, box: { x: 0.0, y: 0.0, width: 0.05, height: 0.02 } },
    ],
  };
}

/** The OCR labels the fixture normalizes to (stable, geometry-derived ids). */
function fixtureLabels(): OcrLabel[] {
  return normalizeOcr(fixtureDetections());
}

/** A well-formed proposal referencing the fixture labels (model-style ids). */
function goodProposal(): DiagramProposal {
  // Geometry-derived ids from fixtureDetections(): the "noise" row sorts
  // first (y≈0.01), then Pulmonary artery (y≈0.125), then the y≈0.425 row
  // left→right (Right ventricle, Lungs).
  return {
    parts: [
      {
        id: "p1",
        name: "Right ventricle",
        ocrLabelId: "label-2",
        description: "Chamber that pumps blood toward the lungs.",
        descriptionShort: "Blood pump to lungs",
        descriptionDetailed:
          "Located on the left side of the diagram (x about 0.2, y about 0.4). Receives blood and pushes it into the pulmonary artery.",
      },
      {
        id: "p2",
        name: "Lungs",
        ocrLabelId: "label-3",
        description: "Organ where oxygen enters the blood.",
        descriptionShort: "Gas exchange",
      },
    ],
    relationships: [
      { sourcePartId: "p1", targetPartId: "p2", relationType: "flows_to", evidence: ["label-2", "label-3"] },
    ],
    processFlow: [
      { order: 1, partId: "p1" },
      { order: 2, partId: "p2" },
    ],
  };
}

describe("OCR normalization (deterministic)", () => {
  it("assigns ids in geometric reading order regardless of input order", () => {
    const a = normalizeOcr(fixtureDetections());
    const b = normalizeOcr({
      lines: [...fixtureDetections().lines].reverse(),
    });
    expect(a).toEqual(b);
  });

  it("produces label text, confidence, and normalized coordinates", () => {
    const labels = fixtureLabels();
    expect(labels.map((l) => l.text)).toEqual(["noise", "Pulmonary artery", "Right ventricle", "Lungs"]);
    const lungs = labels.find((l) => l.text === "Lungs")!;
    expect(lungs.confidence).toBe(97.8);
    expect(lungs.x).toBeCloseTo(0.675, 3);
    expect(lungs.y).toBeCloseTo(0.425, 3);
    expect(lungs.labelId).toBe("label-3");
  });

  it("drops duplicates and empty text, clamps coordinates", () => {
    const labels = normalizeOcr({
      lines: [
        { text: "Aorta", confidence: 90, box: { x: -0.2, y: -0.1, width: 0.1, height: 0.1 } },
        { text: "Aorta", confidence: 88, box: { x: 0.5, y: 0.5, width: 0.1, height: 0.1 } },
        { text: "   ", confidence: 99, box: { x: 0.1, y: 0.9, width: 0.1, height: 0.1 } },
      ],
    });
    expect(labels).toHaveLength(1);
    expect(labels[0].x).toBe(0);
    expect(labels[0].y).toBe(0);
  });

  it("readingOrderSort bands rows then sorts left to right", () => {
    const sorted = readingOrderSort([
      { labelId: "a", text: "A", confidence: 90, x: 0.8, y: 0.12 },
      { labelId: "b", text: "B", confidence: 90, x: 0.2, y: 0.11 },
      { labelId: "c", text: "C", confidence: 90, x: 0.1, y: 0.31 },
    ]);
    expect(sorted.map((l) => l.labelId)).toEqual(["b", "a", "c"]);
  });
});

describe("Proposal schema + parser", () => {
  it("accepts a well-formed proposal", () => {
    expect(diagramProposalSchema.safeParse(goodProposal()).success).toBe(true);
    expect(parseProposalText(JSON.stringify(goodProposal()))).toEqual(goodProposal());
  });

  it("tolerates a markdown fence and surrounding prose", () => {
    const wrapped = '```json\nHere is the map:\n' + JSON.stringify(goodProposal()) + "\n```";
    expect(parseProposalText(wrapped)).toEqual(goodProposal());
  });

  it("rejects wrong relationType, bad flow order, and non-object shapes", () => {
    const bad = {
      ...goodProposal(),
      relationships: [{ sourcePartId: "p1", targetPartId: "p2", relationType: "eats", evidence: ["label-1"] }],
    };
    expect(() => parseProposalText(JSON.stringify(bad))).toThrow(BedrockProposalError);
    expect(() => parseProposalText("no json here at all")).toThrow(BedrockProposalError);
    expect(() => parseProposalText('{"parts":[]}')).toThrow(BedrockProposalError); // min 1 part
  });
});

describe("Bedrock prompt contract", () => {
  it("lists every label id and forbids invented labels", () => {
    const labels = fixtureLabels();
    const prompt = buildProposalPrompt(labels, "The heart");
    for (const l of labels) expect(prompt).toContain(l.labelId);
    expect(prompt).toContain("NEVER invent a label id");
    expect(prompt).toContain("ocrLabelId");
    expect(prompt).toContain("descriptionShort");
    expect(prompt).toContain("descriptionDetailed");
    expect(prompt).toContain("The heart");
  });
});

describe("proposalToStructure (grounding enforcement)", () => {
  it("converts a grounded proposal into ai_proposed structure", () => {
    const labels = fixtureLabels();
    const { structure, issues, ok } = proposalToStructure(goodProposal(), labels);
    expect(ok).toBe(true);
    expect(issues).toEqual([]);
    expect(structure.parts).toHaveLength(2);
    expect(structure.parts[0]).toMatchObject({
      partId: "part-label-2",
      labelId: "label-2",
      name: "Right ventricle",
      state: "ai_proposed",
      descriptionShort: "Blood pump to lungs",
    });
    expect(structure.relations[0]).toMatchObject({
      fromPartId: "part-label-2",
      toPartId: "part-label-3",
      kind: "flows_to",
      evidenceLabelIds: ["label-2", "label-3"],
    });
    expect(structure.flows[0].stepPartIds).toEqual(["part-label-2", "part-label-3"]);
    // The validator agrees: no blocking issues.
    expect(validateStructure(structure).filter((i) => i.severity === "error")).toEqual([]);
  });

  it("rejects a part that invents an unknown OCR label", () => {
    const proposal = goodProposal();
    proposal.parts[0].ocrLabelId = "label-999";
    const { structure, issues } = proposalToStructure(proposal, fixtureLabels());
    // The invented part is dropped with an error; the grounded one survives.
    expect(issues.some((i) => i.code === "unknown_label" && i.severity === "error")).toBe(true);
    expect(structure.parts).toHaveLength(1);
    expect(structure.parts[0].labelId).toBe("label-3");
  });

  it("rejects relationships whose evidence omits an endpoint label", () => {
    const proposal = goodProposal();
    proposal.relationships[0].evidence = ["label-1"];
    const { structure, issues } = proposalToStructure(proposal, fixtureLabels());
    expect(structure.relations).toHaveLength(0);
    expect(issues.some((i) => i.code === "incomplete_evidence")).toBe(true);
  });

  it("rejects flow steps referencing ungrounded or duplicated parts", () => {
    const proposal = goodProposal();
    proposal.processFlow = [
      { order: 1, partId: "p1" },
      { order: 2, partId: "p1" },
      { order: 3, partId: "pGhost" },
    ];
    const { structure, issues } = proposalToStructure(proposal, fixtureLabels());
    expect(structure.flows).toHaveLength(0);
    expect(issues.some((i) => i.code === "duplicate_step")).toBe(true);
    expect(issues.some((i) => i.code === "broken_step")).toBe(true);
  });

  it("name drift is demoted to a warning; OCR text stays authoritative", () => {
    const proposal = goodProposal();
    proposal.parts[0].name = "Right Ventricle Chamber";
    const { structure, issues } = proposalToStructure(proposal, fixtureLabels());
    expect(structure.parts[0].name).toBe("Right ventricle"); // OCR text
    expect(issues.some((i) => i.code === "name_drift" && i.severity === "warning")).toBe(true);
  });

  it("re-runs do not duplicate labels or parts for the same OCR label", () => {
    const labels = fixtureLabels();
    const first = proposalToStructure(goodProposal(), labels);
    const second = proposalToStructure(goodProposal(), labels, first.structure);
    expect(second.structure.labels).toHaveLength(first.structure.labels.length);
    expect(second.structure.parts).toHaveLength(first.structure.parts.length);
    expect(second.issues.some((i) => i.code === "duplicate_label_reference")).toBe(true);
  });
});

describe("DiagramSenseService (in-process pipeline)", () => {
  function makeService(overrides: {
    textract?: ConstructorParameters<typeof DiagramSenseService>[2];
    bedrock?: ConstructorParameters<typeof DiagramSenseService>[3];
  } = {}) {
    const repos = createMemoryRepos();
    const storage = new LocalFileStorage("unused-local-dir");
    const config = loadConfig({
      SAHPAATH_STORE: "memory",
      SAHPAATH_TEACHER_PASSWORD: "pw",
      SAHPAATH_UPLOAD_TOKEN_SECRET: "s",
    } as NodeJS.ProcessEnv);
    const lessons = new LessonService(repos, log);
    const sense = new DiagramSenseService(repos, storage, overrides.textract ?? null, overrides.bedrock ?? null, config, log);
    const uploads = new DiagramUploadService(repos, new LocalPresignedUpload("s"), sense, storage, config, log);
    return { repos, lessons, sense, uploads };
  }

  async function makeDiagram(lessons: LessonService, uploads: DiagramUploadService) {
    const lesson = await lessons.createLesson(teacher, { title: "The heart" });
    const diagram = await uploads.registerDiagram(teacher, {
      lessonId: lesson.lessonId, sourceType: "upload", licenseName: "CC0", contentType: "image/png",
    });
    const grant = await uploads.createUploadUrl(teacher, diagram.diagramId, "image/png");
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    );
    await uploads.confirmLocalUpload(teacher, {
      diagramId: diagram.diagramId, key: grant.key, maxSize: grant.maxBytes,
      contentType: "image/png", expiresAt: grant.expiresAt,
      token: grant.fields["x-sahpaath-token"], bytes: png,
    });
    return lesson;
  }

  it("full pipeline: OCR labels -> proposal -> validated ai_proposed draft -> audit", async () => {
    const textract = { detect: async () => fixtureDetections() };
    const bedrock = { propose: async () => goodProposal() };
    const { repos, lessons, sense, uploads } = makeService({ textract, bedrock });
    await makeDiagram(lessons, uploads);
    const diagrams = await repos.diagrams.listByLesson((await repos.lessons.listByTeacher(teacher.userId))[0].lessonId);
    const run = await sense.runPipeline(teacher, diagrams[0].diagramId);

    expect(run.job.status).toBe("succeeded");
    expect(run.issues).toEqual([]);
    expect(run.job.stages.find((s) => s.name === "OCR")?.status).toBe("completed");
    expect(run.job.stages.find((s) => s.name === "OCR")?.simulation).toBe(false);
    expect(run.job.stages.find((s) => s.name === "Semantic proposal")?.status).toBe("completed");
    expect(run.diagram.processingStatus).toBe("awaiting_review");

    const draft = await sense.draftWithLabels(teacher, diagrams[0].diagramId);
    expect(draft.labels).toHaveLength(4); // all OCR lines, incl. low-value "noise"
    expect(draft.parts).toHaveLength(2);
    expect(draft.parts.every((p) => p.state === "ai_proposed")).toBe(true);

    const events = await repos.audit.listForLesson((await repos.lessons.listByTeacher(teacher.userId))[0].lessonId);
    expect(events.map((e) => e.action)).toContain("pipeline_completed");
  });

  it("OCR failure is recorded honestly and the diagram is marked failed", async () => {
    const textract = { detect: async () => { throw new Error("AccessDeniedException"); } };
    const bedrock = { propose: async () => goodProposal() };
    const { repos, lessons, sense, uploads } = makeService({ textract, bedrock });
    await makeDiagram(lessons, uploads);
    const diagram = (await repos.diagrams.listByLesson((await repos.lessons.listByTeacher(teacher.userId))[0].lessonId))[0];
    const run = await sense.runPipeline(teacher, diagram.diagramId);
    expect(run.job.status).toBe("failed");
    expect(run.job.error).toContain("AccessDeniedException");
    expect(run.job.stages.find((s) => s.name === "OCR")?.status).toBe("failed");
    // Fresh read: the diagram itself is marked failed (the pre-run snapshot is stale).
    const after = await repos.diagrams.get(diagram.diagramId);
    expect(after?.processingStatus).toBe("failed");
    expect(run.diagram.processingStatus).toBe("failed");
  });

  it("missing providers: fallback simulation flags, never faked success", async () => {
    const { repos, lessons, sense, uploads } = makeService({});
    await makeDiagram(lessons, uploads);
    const diagram = (await repos.diagrams.listByLesson((await repos.lessons.listByTeacher(teacher.userId))[0].lessonId))[0];
    const run = await sense.runPipeline(teacher, diagram.diagramId);
    expect(run.job.status).toBe("failed"); // no proposal possible
    const proposalStage = run.job.stages.find((s) => s.name === "Semantic proposal");
    expect(proposalStage?.simulation).toBe(true);
    expect(proposalStage?.status).toBe("fallback");
  });

  it("malformed proposal output retries exactly once, then fails honestly", async () => {
    let attempts = 0;
    const textract = { detect: async () => fixtureDetections() };
    const bedrock = {
      propose: async () => {
        attempts++;
        if (attempts === 1) throw new BedrockProposalError("parse", "bad json");
        return goodProposal();
      },
    };
    const { repos, lessons, sense, uploads } = makeService({ textract, bedrock });
    await makeDiagram(lessons, uploads);
    const diagram = (await repos.diagrams.listByLesson((await repos.lessons.listByTeacher(teacher.userId))[0].lessonId))[0];
    const run = await sense.runPipeline(teacher, diagram.diagramId);
    expect(attempts).toBe(2); // retried once
    expect(run.job.status).toBe("succeeded");
    expect(run.job.stages.find((s) => s.name === "Semantic proposal")?.status).toBe("completed");
    void repos;
  });

  it("two parse failures in a row surface the real error", async () => {
    let attempts = 0;
    const textract = { detect: async () => fixtureDetections() };
    const bedrock = {
      propose: async () => {
        attempts++;
        throw new BedrockProposalError("parse", "still malformed");
      },
    };
    const { repos, lessons, sense, uploads } = makeService({ textract, bedrock });
    await makeDiagram(lessons, uploads);
    const diagram = (await repos.diagrams.listByLesson((await repos.lessons.listByTeacher(teacher.userId))[0].lessonId))[0];
    const run = await sense.runPipeline(teacher, diagram.diagramId);
    expect(attempts).toBe(2);
    expect(run.job.status).toBe("failed");
    expect(run.job.error).toContain("still malformed");
  });

  it("duplicate processing is rejected while a run is active or done", async () => {
    const { repos, lessons, sense, uploads } = makeService({});
    await makeDiagram(lessons, uploads);
    const diagram = (await repos.diagrams.listByLesson((await repos.lessons.listByTeacher(teacher.userId))[0].lessonId))[0];
    await sense.runPipeline(teacher, diagram.diagramId);
    await expect(uploads.startProcessing(teacher, diagram.diagramId)).rejects.toMatchObject({ code: "conflict" });
  });
});
