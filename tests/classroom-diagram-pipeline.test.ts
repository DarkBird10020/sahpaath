import { describe, it, expect, vi } from "vitest";
import { diagramProposalSchema, diagramPrompt, diagramTool, parseDiagramResponse, runDiagramPipeline, validateProposal } from "../server/diagram-pipeline";
import { parseTextract } from "../server/aws";
import { validateMap } from "../shared/domain";
import type { Label } from "../shared/schema";

const labels: Label[] = [
  { id: "label-a", text: "Heart", confidence: 98, source: "textract", x: .2, y: .2 },
  { id: "label-b", text: "Lungs", confidence: 76, source: "textract", x: .7, y: .2 },
];
const proposal = () => diagramProposalSchema.parse({
  parts: labels.map((l, i) => ({ id: `part-${i}`, name: l.text, ocrLabelId: l.id, description: `Description of ${l.text}.`,
    descriptions: { short: l.text, normal: `Description of ${l.text}.`, detailed: `Detailed description of ${l.text}.` }, evidence: [l.id], modelConfidence: 90 })),
  relationships: [{ id: "r-1", sourcePartId: "part-0", targetPartId: "part-1", relationType: "flows_to", evidence: labels.map((l) => l.id) }],
  processFlow: [{ order: 1, partId: "part-0" }, { order: 2, partId: "part-1" }],
});
const envelope = (input: unknown) => ({ stopReason: "tool_use", output: { message: { content: [{ toolUse: { name: "submit_diagram_map", input } }] } } });
describe("DiagramSense structured evidence", () => {
  it("retains explicit OCR links, description levels and separate confidences", () => {
    const result = validateProposal(proposal(), labels);
    expect(result.valid).toBe(true);
    expect(result.map.parts[0]).toMatchObject({ labelId: "label-a", evidence: ["label-a"], modelConfidence: 90 });
    expect(result.map.parts[0].descriptions?.detailed).toContain("Detailed");
    expect(result.map.labels[0].confidence).toBe(98);
    expect(result.issues.some((i) => i.code === "low_ocr")).toBe(true);
    expect(result.map.parts.every((p) => p.state !== "teacher_approved")).toBe(true);
  });
  it("rejects invented OCR IDs without silently dropping the part", () => {
    const p = proposal(); p.parts[0].ocrLabelId = "invented";
    const result = validateProposal(p, labels);
    expect(result.valid).toBe(false);
    expect(result.map.parts).toHaveLength(2);
    expect(validateMap(result.map).some((i) => i.code === "unknown_label")).toBe(true);
  });
  it("rejects fabricated part evidence and does not manufacture relation evidence", () => {
    const p = proposal(); p.parts[0].evidence = ["invented"]; p.relationships[0].evidence = ["label-a"];
    const result = validateProposal(p, labels);
    expect(result.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["invalid_part_evidence", "incomplete_evidence"]));
  });
  it("preserves dangling, duplicate and self relationships as validation errors", () => {
    const p = proposal(); p.relationships.push({ ...p.relationships[0], id: "r-2" }, { ...p.relationships[0], id: "r-3", targetPartId: "missing" }, { ...p.relationships[0], id: "r-4", targetPartId: "part-0" });
    const result = validateProposal(p, labels);
    expect(result.map.relations).toHaveLength(4);
    expect(result.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["dangling", "duplicate_relation", "self_relation"]));
  });
  it("never shortens a process to hide a missing part", () => {
    const p = proposal(); p.processFlow[1].partId = "missing";
    const result = validateProposal(p, labels);
    expect(result.map.flows[0].steps).toEqual(["part-0", "missing"]);
    expect(result.valid).toBe(false);
  });
  it("rejects invalid process ordering and injected trust states", () => {
    const p = proposal(); p.processFlow[1].order = 7;
    expect(() => parseDiagramResponse(envelope(p))).toThrow();
    expect(() => parseDiagramResponse(envelope({ ...proposal(), state: "published" }))).toThrow();
  });
  it("requires exactly one correctly named tool and complete output", () => {
    expect(() => parseDiagramResponse({ ...envelope(proposal()), stopReason: "max_tokens" })).toThrow();
    expect(() => parseDiagramResponse({ output: { message: { content: [{ text: JSON.stringify(proposal()) }] } } })).toThrow();
  });
  it("includes source IDs and coordinates in the prompt and emits a JSON tool schema", () => {
    expect(diagramPrompt(labels)).toContain('"id":"label-a"');
    expect(diagramPrompt(labels)).toContain('"x":0.2');
    expect(JSON.stringify(diagramTool())).toContain("ocrLabelId");
  });
});
describe("bounded pipeline execution", () => {
  it("retries malformed output exactly once", async () => {
    const propose = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce(envelope(proposal()));
    const result = await runDiagramPipeline({ ocr: async () => labels, propose });
    expect(result.ok).toBe(true); expect(result.retries).toBe(1);
    expect(propose.mock.calls.map((args) => args[1])).toEqual([false, true]);
  });
  it("retains OCR labels when both model responses are malformed", async () => {
    const propose = vi.fn().mockResolvedValue({});
    const result = await runDiagramPipeline({ ocr: async () => labels, propose });
    expect(result).toMatchObject({ ok: false, failedStage: "model", labels, retries: 1 });
    expect(propose).toHaveBeenCalledTimes(2);
  });
  it("does not repeat permission/network failures or leak provider errors", async () => {
    const propose = vi.fn().mockRejectedValue(new Error("secret provider details"));
    const result = await runDiagramPipeline({ ocr: async () => labels, propose });
    expect(result).toMatchObject({ ok: false, failedStage: "model", labels });
    expect(JSON.stringify(result)).not.toContain("secret"); expect(propose).toHaveBeenCalledTimes(1);
  });
  it("does not call Bedrock when OCR fails or returns no labels", async () => {
    for (const ocr of [async () => [] as Label[], async (): Promise<Label[]> => { throw new Error("failure"); }]) {
      const propose = vi.fn();
      expect(await runDiagramPipeline({ ocr, propose })).toMatchObject({ ok: false, failedStage: "ocr" });
      expect(propose).not.toHaveBeenCalled();
    }
  });
  it("sends structurally valid but ungrounded proposals to review without an extra model call", async () => {
    const p = proposal(); p.parts[0].ocrLabelId = "unknown";
    const propose = vi.fn().mockResolvedValue(envelope(p));
    expect(await runDiagramPipeline({ ocr: async () => labels, propose })).toMatchObject({ ok: true, valid: false, retries: 0 });
    expect(propose).toHaveBeenCalledTimes(1);
  });
  it("retains OCR bounding boxes and rejects impossible geometry", () => {
    const block = { BlockType: "LINE", Id: "label-a", Text: "Heart", Confidence: 99,
      Geometry: { BoundingBox: { Left: .1, Top: .2, Width: .3, Height: .1 } } };
    expect(parseTextract({ Blocks: [block] })[0].boundingBox).toEqual({ left: .1, top: .2, width: .3, height: .1 });
    expect(parseTextract({ Blocks: [{ ...block, Geometry: { BoundingBox: { Left: .9, Top: .2, Width: .3, Height: .1 } } }] })).toEqual([]);
  });
});
