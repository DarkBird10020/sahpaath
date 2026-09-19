import { describe, it, expect } from "vitest";
import {
  geminiGenerate,
  geminiSchema,
  imageSize,
  linesToLabels,
  localTestEngine,
  readGeminiConfig,
  GeminiProposalAdapter,
  LocalOcrAdapter,
  type OcrLine,
} from "../server/local-ai";
import { proposalToStructure } from "../server/services/pipeline-structure";
import { normalizeOcr } from "../server/providers/textract";

// No network: every Gemini response below is a canned fetch reply.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const config = { apiKey: "test-key", model: "gemini-test" };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const answer = (text: string, finishReason = "STOP") => reply(200, { candidates: [{ finishReason, content: { parts: [{ text }] } }] });
function fakeFetch(...responses: Response[]) {
  const calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)), headers: init?.headers as Record<string, string> });
    const next = responses.shift();
    if (!next) throw new Error("unexpected extra call");
    return next;
  }) as typeof fetch;
  return { impl, calls };
}
const lines: OcrLine[] = [
  { text: "Right ventricle", confidence: 91.2, box: { x: 0.1, y: 0.1, width: 0.3, height: 0.05 } },
  { text: "Pulmonary artery", confidence: 88, box: { x: 0.5, y: 0.4, width: 0.3, height: 0.05 } },
];
const proposal = {
  parts: [
    { id: "p1", name: "Right ventricle", ocrLabelId: "ocr-0", description: "Pumps blood to the lungs.", evidence: ["ocr-0"] },
    { id: "p2", name: "Pulmonary artery", ocrLabelId: "ocr-1", description: "Carries blood to the lungs.", evidence: ["ocr-1"] },
  ],
  relationships: [{ id: "r1", sourcePartId: "p1", targetPartId: "p2", relationType: "flows_to", evidence: ["ocr-0", "ocr-1"] }],
  processFlow: [{ order: 1, partId: "p1" }, { order: 2, partId: "p2" }],
};

describe("Gemini test stand-in", () => {
  it("is off without a key and defaults to Flash-Lite", () => {
    expect(readGeminiConfig({})).toBeNull();
    expect(readGeminiConfig({ GEMINI_API_KEY: "  " })).toBeNull();
    expect(readGeminiConfig({ GEMINI_API_KEY: "k" })).toEqual({ apiKey: "k", model: "gemini-3.5-flash-lite" });
    expect(readGeminiConfig({ GEMINI_API_KEY: "k", SAHPAATH_GEMINI_MODEL: "gemini-3.5-flash" })!.model).toBe("gemini-3.5-flash");
  });
  it("sends the key in a header, the image inline and a JSON schema, and returns the text", async () => {
    const { impl, calls } = fakeFetch(answer('{"ok":true}'));
    const text = await geminiGenerate(config, { prompt: "hi", image: { bytes: PNG, mime: "image/png" }, jsonSchema: { type: "object" } }, impl);
    expect(text).toBe('{"ok":true}');
    expect(calls[0].url).toContain("/models/gemini-test:generateContent");
    expect(calls[0].url).not.toContain("test-key");
    expect(calls[0].headers["x-goog-api-key"]).toBe("test-key");
    const body = calls[0].body as { contents: { parts: Record<string, unknown>[] }[]; generationConfig: Record<string, unknown> };
    expect(body.contents[0].parts[0]).toEqual({ inlineData: { mimeType: "image/png", data: PNG.toString("base64") } });
    expect(body.generationConfig).toMatchObject({ responseMimeType: "application/json", responseJsonSchema: { type: "object" } });
  });
  it("retries once when busy, then reports limits and early stops clearly", async () => {
    const busy = fakeFetch(reply(503, { error: { message: "high demand" } }), answer("{}"));
    await expect(geminiGenerate(config, { prompt: "x" }, busy.impl, 0)).resolves.toBe("{}");
    expect(busy.calls).toHaveLength(2);
    const limited = fakeFetch(reply(429, {}), reply(429, {}));
    await expect(geminiGenerate(config, { prompt: "x" }, limited.impl, 0)).rejects.toThrow("free-tier limit");
    await expect(geminiGenerate(config, { prompt: "x" }, fakeFetch(answer("{", "MAX_TOKENS")).impl)).rejects.toThrow("MAX_TOKENS");
    await expect(geminiGenerate(config, { prompt: "x" }, fakeFetch(reply(400, { error: { message: "bad" } })).impl)).rejects.toThrow("HTTP 400");
  });
  it("strips schema keywords Gemini does not accept", () => {
    expect(
      geminiSchema({ type: "object", $schema: "x", properties: { id: { type: "string", pattern: "^a$", maxLength: 3 }, xs: { type: "array", minItems: 1, maxItems: 9, items: { type: "string" } } }, required: ["id"], additionalProperties: false }),
    ).toEqual({ type: "object", properties: { id: { type: "string" }, xs: { type: "array", items: { type: "string" } } }, required: ["id"], additionalProperties: false });
  });
});

describe("Local OCR shape", () => {
  it("reads PNG and JPEG sizes from their headers", () => {
    expect(imageSize(PNG)).toEqual({ width: 1, height: 1 });
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x02, 0x58, 0x03, 0, 0, 0, 0, 0xff, 0xd9]);
    expect(imageSize(jpeg)).toEqual({ width: 600, height: 300 });
    expect(imageSize(Buffer.from("not an image at all, just text"))).toBeNull();
  });
  it("turns OCR lines into labels marked as local OCR, never Textract", () => {
    const labels = linesToLabels(lines);
    expect(labels[1]).toEqual({
      id: "ocr-1", text: "Pulmonary artery", confidence: 88, source: "local_ocr", x: 0.65, y: 0.425,
      boundingBox: { left: 0.5, top: 0.4, width: 0.3, height: 0.05 },
    });
  });
  it("labels v1 structures from local OCR as local_ocr", async () => {
    const adapter = new LocalOcrAdapter("unused");
    expect(adapter.labelSource).toBe("local_ocr");
    const structure = proposalToStructure(
      { parts: [{ id: "p1", name: "Right ventricle", ocrLabelId: "label-0", description: "Pumps blood." }], relationships: [], processFlow: [] } as never,
      normalizeOcr({ lines }),
      undefined,
      adapter.labelSource,
    ).structure;
    expect(structure.labels.every((l) => l.source === "local_ocr")).toBe(true);
  });
});

describe("Classroom pipeline with the stand-in engine", () => {
  it("grounds a Gemini proposal in local OCR labels and names both engines", async () => {
    const { impl } = fakeFetch(answer(JSON.stringify(proposal)));
    const engine = localTestEngine(config, "unused", impl, async () => lines);
    expect(engine).toMatchObject({ ocrName: "Local OCR (tesseract.js)", modelName: "Gemini gemini-test", note: "Test stand-in, not AWS." });
    const result = await engine.run({ bytes: PNG, mime: "image/png" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.map.parts.map((p) => [p.name, p.labelId, p.state])).toEqual([
      ["Right ventricle", "ocr-0", "validated"],
      ["Pulmonary artery", "ocr-1", "validated"],
    ]);
    expect(result.issues).toEqual([]);
  });
  it("retries malformed output once, then keeps OCR labels and names Gemini in the failure", async () => {
    const { impl, calls } = fakeFetch(answer("not json"), answer('{"parts":[]}'));
    const result = await localTestEngine(config, "unused", impl, async () => lines).run({ bytes: PNG, mime: "image/png" });
    expect(calls).toHaveLength(2);
    expect(result).toMatchObject({ ok: false, failedStage: "model", reason: "Gemini gemini-test returned malformed output twice. OCR labels are preserved." });
    expect(result.labels).toHaveLength(2);
  });
  it("flags invented OCR ids instead of hiding them", async () => {
    const invented = structuredClone(proposal);
    invented.parts[1].ocrLabelId = "ocr-99";
    const result = await localTestEngine(config, "unused", fakeFetch(answer(JSON.stringify(invented))).impl, async () => lines).run({ bytes: PNG, mime: "image/png" });
    expect(result.ok && result.issues.some((i) => i.code === "unknown_label")).toBe(true);
  });
});

describe("v1 pipeline with the Gemini adapter", () => {
  it("parses the v1 proposal format and reports invoke failures as such", async () => {
    const v1 = {
      parts: [{ id: "p1", name: "Right ventricle", ocrLabelId: "label-0", description: "Pumps blood to the lungs." }],
      relationships: [],
      processFlow: [],
    };
    const ok = new GeminiProposalAdapter(config, fakeFetch(answer(JSON.stringify(v1))).impl);
    expect(ok.engine).toContain("not AWS");
    const input = { imageBytes: PNG, mimeType: "image/png" as const, ocrLabels: normalizeOcr({ lines }), lessonTitle: "Heart" };
    expect((await ok.propose(input)).parts[0].ocrLabelId).toBe("label-0");
    const failing = new GeminiProposalAdapter(config, fakeFetch(reply(400, {})).impl);
    await expect(failing.propose(input)).rejects.toMatchObject({ name: "BedrockProposalError", stage: "invoke" });
  });
});

describe("Splitting OCR lines at arrows", () => {
  const w = (text: string, x0: number, confidence = 90) => ({ text, confidence, bbox: { x0, y0: 10, x1: x0 + 40, y1: 30 } });
  it("separates labels joined by an arrow and drops the arrow", async () => {
    const { splitLineWords } = await import("../server/local-ai");
    const pieces = splitLineWords([w("Right", 0), w("ventricle", 50), w("————————p»", 100), w("Pulmonary", 150), w("artery»", 200)]);
    expect(pieces.map((p) => p.map((x) => x.text).join(" "))).toEqual(["Right ventricle", "Pulmonary artery"]);
    // A callout the arrow ran into now survives as its own label before the words.
    expect(splitLineWords([w("4———", 0), w("Pulmonary", 50), w("veins", 100)]).map((p) => p.map((x) => x.text).join(" "))).toEqual(["4", "Pulmonary veins"]);
    const glued = splitLineWords([w("Right", 0), w("ventricle————————p»", 50), w("Pulmonary", 150), w("artery", 200)]);
    expect(glued.map((p) => p.map((x) => x.text).join(" "))).toEqual(["Right ventricle", "Pulmonary artery"]);
    // The first label's box ends inside the glued word, before the arrow.
    expect(glued[0].at(-1)!.bbox.x1).toBeLessThan(90);
  });
  it("keeps numbered callouts as standalone labels, in isolation or in a row", async () => {
    const { splitLineWords } = await import("../server/local-ai");
    // A callout the arrow ran into survives as its own label...
    expect(splitLineWords([w("23———", 0)]).map((p) => p.map((x) => x.text).join(" "))).toEqual(["23"]);
    // ...and a whole row of plain callouts stays one label per number.
    expect(splitLineWords([w("1", 0), w("2", 50), w("3", 100)]).map((p) => p.map((x) => x.text).join(" "))).toEqual(["1", "2", "3"]);
    // Two digits glued to an arrow stay together ("12———" is callout 12, not 1 and 2).
    expect(splitLineWords([w("12———", 0)]).map((p) => p.map((x) => x.text).join(" "))).toEqual(["12"]);
  });
  it("keeps single-letter labels and hyphenated words", async () => {
    const { splitLineWords } = await import("../server/local-ai");
    expect(splitLineWords([w("A", 0)]).map((p) => p[0].text)).toEqual(["A"]);
    expect(splitLineWords([w("X-ray", 0), w("Semi-lunar", 50)]).map((p) => p.map((x) => x.text).join(" "))).toEqual(["X-ray Semi-lunar"]);
  });
});

describe("Teacher-visible errors", () => {
  it("show our own wording but never raw provider text", async () => {
    const provider = "project 123456 key AQ.secret-ish detail";
    const { impl } = fakeFetch(reply(400, { error: { message: provider } }));
    const result = await localTestEngine(config, "unused", impl, async () => lines).run({ bytes: PNG, mime: "image/png" });
    expect(result).toMatchObject({ ok: false, failedStage: "model" });
    expect(result.ok ? "" : result.reason).toContain("Gemini rejected the request (HTTP 400).");
    expect(JSON.stringify(result)).not.toContain("123456");
    const limited = await localTestEngine(config, "unused", fakeFetch(reply(429, {}), reply(429, {})).impl, async () => lines).run({ bytes: PNG, mime: "image/png" });
    expect(limited.ok ? "" : limited.reason).toContain("free-tier limit reached");
  });
});
