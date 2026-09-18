import { describe, it, expect } from "vitest";
import {
  groundProposal,
  parseTextract,
  proposalSchema,
  readAwsConfig,
  type Proposal,
} from "../server/aws";
import { validateMap, revalidate } from "../shared/domain";
import type { Label } from "../shared/schema";

const baseEnv = { AWS_REGION: "ap-south-1" };
describe("AWS configuration gate", () => {
  it("stays off without every credential and model id", () => {
    expect(readAwsConfig({})).toBeNull();
    expect(
      readAwsConfig({
        ...baseEnv,
        AWS_ACCESS_KEY_ID: "AKIAexample",
        AWS_SECRET_ACCESS_KEY: "secret",
      }),
    ).toBeNull();
  });
  it("turns on only with region, keys and an explicit model id", () => {
    expect(
      readAwsConfig({
        ...baseEnv,
        AWS_ACCESS_KEY_ID: "AKIAexample",
        AWS_SECRET_ACCESS_KEY: "secret",
        AWS_BEDROCK_MODEL_ID: "vendor.model-id",
      }),
    ).toMatchObject({ region: "ap-south-1", bedrockModelId: "vendor.model-id" });
  });
});

const textractResponse = {
  Blocks: [
    {
      BlockType: "PAGE",
      Id: "page-1",
    },
    {
      BlockType: "LINE",
      Id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      Text: "  Right ventricle ",
      Confidence: 98.64,
      Geometry: { BoundingBox: { Left: 0.1, Top: 0.2, Width: 0.3, Height: 0.1 } },
    },
    {
      BlockType: "LINE",
      Id: "bad id with spaces",
      Text: "Pulmonary artery",
      Confidence: 72,
      Geometry: { BoundingBox: { Left: 0.4, Top: 0.4, Width: 0.2, Height: 0.1 } },
    },
    { BlockType: "WORD", Id: "word-1", Text: "ignored" },
  ],
};
describe("Textract response parsing", () => {
  it("keeps only LINE blocks with usable geometry", () => {
    const labels = parseTextract(textractResponse);
    expect(labels).toHaveLength(2);
    expect(labels[0]).toMatchObject({
      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      text: "Right ventricle",
      confidence: 98.64,
      source: "textract",
      x: 0.25,
      y: 0.25,
    });
    expect(labels[1].id).toBe("label-1"); // unsafe Textract id gets a local one
  });
});

const labels: Label[] = [
  { id: "l-0", text: "Right ventricle", confidence: 99, source: "textract", x: 0.25, y: 0.25 },
  { id: "l-1", text: "Pulmonary artery", confidence: 99, source: "textract", x: 0.5, y: 0.4 },
  { id: "l-2", text: "Lungs", confidence: 99, source: "textract", x: 0.7, y: 0.6 },
];
const proposal: Proposal = proposalSchema.parse({
  parts: [
    { name: "right ventricle", description: "Pumps blood to the lungs.", confidence: 82 },
    { name: "Pulmonary artery", description: "Carries blood toward the lungs." },
    { name: "Lungs", description: "Where gas exchange happens.", confidence: 95 },
    { name: "Superior vena cava", description: "Not printed in the diagram." },
  ],
  relations: [
    { from: "Right ventricle", to: "Pulmonary artery", kind: "flows_to", confidence: 77 },
    { from: "Right ventricle", to: "Pulmonary artery", kind: "flows_to" },
    { from: "Right ventricle", to: "Superior vena cava", kind: "flows_to" },
    { from: "Lungs", to: "Lungs", kind: "connects_to" },
    { from: "Pulmonary artery", to: "Lungs", kind: "flows_to" },
  ],
  flows: [
    { name: "Blood path", steps: ["Right ventricle", "Pulmonary artery", "Lungs"] },
    { name: "Broken path", steps: ["Right ventricle", "Lungs"] },
    { name: "Tiny path", steps: ["Lungs"] },
  ],
});
describe("Grounding a model proposal against real OCR labels", () => {
  const map = groundProposal(proposal, labels);
  it("keeps only parts that match an OCR label", () => {
    expect(map.parts.map((p) => p.name)).toEqual([
      "Right ventricle",
      "Pulmonary artery",
      "Lungs",
    ]);
  });
  it("carries the model's own confidence through, never merging it with OCR confidence", () => {
    expect(map.parts[0].modelConfidence).toBe(82);
    expect(map.parts[1].modelConfidence).toBeNull();
    expect(map.relations[0].modelConfidence).toBe(77);
    expect(labels[0].confidence).not.toBe(map.parts[0].modelConfidence);
  });
  it("drops duplicate, dangling and self relations and attaches label evidence", () => {
    expect(map.relations).toHaveLength(2);
    expect(map.relations[0]).toMatchObject({
      from: "part-0",
      to: "part-1",
      evidence: ["l-0", "l-1"],
    });
    expect(map.relations[1]).toMatchObject({ from: "part-1", to: "part-2" });
  });
  it("keeps only flows that follow forward relations step by step", () => {
    expect(map.flows).toHaveLength(1);
    expect(map.flows[0].steps).toEqual(["part-0", "part-1", "part-2"]);
  });
  it("produces a map with no structural validation errors", () => {
    expect(validateMap(revalidate(map)).filter((i) => i.severity === "error")).toEqual([]);
  });
  it("rejects proposals outside the schema", () => {
    expect(() => proposalSchema.parse({ parts: "no" })).toThrow();
  });
});
