import { describe, it, expect } from "vitest";
import {
  geminiGenerate,
  geminiSchema,
  imageSize,
  linesToLabels,
  localTestEngine,
  mergeCallouts,
  plausibleCallouts,
  readCallouts,
  readCalloutsCarefully,
  readWords,
  mergeWords,
  readGeminiConfig,
  GeminiProposalAdapter,
  LocalOcrAdapter,
  type OcrLine,
} from "../server/local-ai";
import { proposalToStructure } from "../server/services/pipeline-structure";
import { normalizeOcr } from "../server/providers/textract";
import { calloutOf, missingCallouts } from "../shared/domain";

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
// The engine's first call reads numbered callouts; a diagram labelled in words has none.
const noCallouts = () => answer('{"callouts":[]}');
// Then its words; an empty reading leaves the OCR labels exactly as read.
const noWords = () => answer('{"labels":[]}');
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
    const { impl } = fakeFetch(noCallouts(), noWords(), answer(JSON.stringify(proposal)));
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
    const { impl, calls } = fakeFetch(noCallouts(), noWords(), answer("not json"), answer('{"parts":[]}'));
    const result = await localTestEngine(config, "unused", impl, async () => lines).run({ bytes: PNG, mime: "image/png" });
    // A callout read and a word read, then the proposal and its single retry.
    expect(calls).toHaveLength(4);
    expect(result).toMatchObject({ ok: false, failedStage: "model", reason: "Gemini gemini-test returned malformed output twice. OCR labels are preserved." });
    expect(result.labels).toHaveLength(2);
  });
  it("flags invented OCR ids instead of hiding them", async () => {
    const invented = structuredClone(proposal);
    invented.parts[1].ocrLabelId = "ocr-99";
    const result = await localTestEngine(config, "unused", fakeFetch(noCallouts(), noWords(), answer(JSON.stringify(invented))).impl, async () => lines).run({ bytes: PNG, mime: "image/png" });
    expect(result.ok && result.issues.some((i) => i.code === "unknown_label")).toBe(true);
  });
});

describe("Numbered callouts", () => {
  // Circled numbers that local OCR misreads as fragments, as it did on a real
  // 23-callout digestive diagram ("(6) 5", "oa", "AN").
  const junk: OcrLine[] = [
    { text: "(6) 5", confidence: 41, box: { x: 0.1, y: 0.1, width: 0.06, height: 0.04 } },
    { text: "oa", confidence: 30, box: { x: 0.1, y: 0.5, width: 0.04, height: 0.04 } },
    { text: "Human digestive system", confidence: 95, box: { x: 0.3, y: 0.95, width: 0.4, height: 0.04 } },
  ];
  const callouts = { callouts: [
    { number: 2, box: [480, 90, 530, 150] },
    { number: 1, box: [80, 90, 130, 150] },
    { number: 1, box: [80, 90, 130, 150] },
    { number: 3, box: [880, 90, 930, 150] },
  ] };
  it("reads each callout once, in number order, as the model's reading and not OCR", async () => {
    const labels = await readCallouts(config, { bytes: PNG, mime: "image/png" }, fakeFetch(answer(JSON.stringify(callouts))).impl);
    expect(labels.map((l) => [l.id, l.text, l.source, l.confidence])).toEqual([
      ["1", "1", "model_read", null],
      ["2", "2", "model_read", null],
      ["3", "3", "model_read", null],
    ]);
    expect(labels[0].y).toBeCloseTo(0.105, 3);
  });
  it("drops OCR fragments lying on a callout and keeps words elsewhere", async () => {
    const labels = await readCallouts(config, { bytes: PNG, mime: "image/png" }, fakeFetch(answer(JSON.stringify(callouts))).impl);
    const merged = mergeCallouts(linesToLabels(junk), labels);
    expect(merged.map((l) => l.text)).toEqual(["1", "2", "3", "Human digestive system"]);
    // A diagram without numbered callouts keeps its OCR exactly as read.
    expect(mergeCallouts(linesToLabels(junk), [])).toHaveLength(3);
  });
  it("gives each part its number, its name and its place, 1 to last", async () => {
    const named = {
      parts: [
        { id: "p3", name: "Stomach", ocrLabelId: "3", description: "The stomach churns and digests food.", evidence: ["3"] },
        { id: "p1", name: "Mouth", ocrLabelId: "1", description: "The mouth takes food in and starts chewing.", evidence: ["1"] },
        { id: "p2", name: "Oesophagus", ocrLabelId: "2", description: "The oesophagus carries food down to the stomach.", evidence: ["2"] },
      ],
      // Cited the way the model cited them on a real lesson: by the number.
      relationships: [{ id: "r1", sourcePartId: "p1", targetPartId: "p2", relationType: "flows_to", evidence: ["1", "2"] }],
      processFlow: [],
    };
    const { impl, calls } = fakeFetch(answer(JSON.stringify(callouts)), answer(JSON.stringify(named)));
    const result = await localTestEngine(config, "unused", impl, async () => junk).run({ bytes: PNG, mime: "image/png" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.map.parts.map((p) => [calloutOf(result.map, p), p.name])).toEqual([
      [1, "Mouth"],
      [2, "Oesophagus"],
      [3, "Stomach"],
    ]);
    expect(result.issues.filter((i) => i.code === "callout_named_by_ai")).toHaveLength(3);
    // A relationship cited "1" and "2" is grounded: those are the labels' ids.
    expect(result.issues.filter((i) => i.itemId === "r1" && i.severity === "error")).toEqual([]);
    // The lesson itself gets room to finish; the callout read does not need it.
    expect((calls[1].body.generationConfig as { maxOutputTokens: number }).maxOutputTokens).toBe(32768);
    expect((calls[0].body.generationConfig as { maxOutputTokens: number }).maxOutputTokens).toBe(8192);
  });
  it("falls back to plain OCR when the callout read fails", async () => {
    const { impl } = fakeFetch(reply(400, {}), noWords(), answer(JSON.stringify(proposal)));
    const result = await localTestEngine(config, "unused", impl, async () => lines).run({ bytes: PNG, mime: "image/png" });
    expect(result.ok && result.map.parts.map((p) => p.name)).toEqual(["Right ventricle", "Pulmonary artery"]);
  });
});

describe("Reading every callout", () => {
  // The two failures a real re-analysis of a 1-23 digestive diagram produced:
  // callout 5 not read, and a "272" that is not on the image at all.
  // Positions stay on the 0-1000 scale; "272" sits somewhere on the page too.
  const box = (n: number) => [(n % 30) * 30, 100, (n % 30) * 30 + 25, 140];
  const reading = (numbers: number[]) => answer(JSON.stringify({ callouts: numbers.map((number) => ({ number, box: box(number) })) }));
  const oneTo = (n: number, without: number[] = []) => Array.from({ length: n }, (_, i) => i + 1).filter((x) => !without.includes(x));
  it("drops a number far outside the diagram's run", async () => {
    const labels = await readCallouts(config, { bytes: PNG, mime: "image/png" }, fakeFetch(reading([...oneTo(23, [5]), 272])).impl);
    expect(plausibleCallouts(labels).map((l) => l.text)).not.toContain("272");
    expect(plausibleCallouts(labels)).toHaveLength(22);
  });
  it("reads again when a number is missing, and fills the gap from the second reading", async () => {
    const { impl, calls } = fakeFetch(reading([...oneTo(23, [5]), 272]), reading(oneTo(23, [9])));
    const labels = await readCalloutsCarefully(config, { bytes: PNG, mime: "image/png" }, impl);
    expect(calls).toHaveLength(2);
    expect(labels.map((l) => Number(l.text))).toEqual(oneTo(23));
  });
  it("reads once when nothing is missing", async () => {
    const { impl, calls } = fakeFetch(reading(oneTo(23)));
    await readCalloutsCarefully(config, { bytes: PNG, mime: "image/png" }, impl);
    expect(calls).toHaveLength(1);
  });
  it("names a number no part carries, so the teacher is told instead of left to notice", () => {
    const labels = oneTo(6, [5]).map((n) => ({ id: `callout-${n}`, text: String(n), confidence: null, source: "model_read" as const, x: 0.5, y: n / 10 }));
    const parts = labels.map((l) => ({ id: `p${l.text}`, name: `Part ${l.text}`, labelId: l.id, description: "A part.", aliases: [], modelConfidence: null, state: "ai_proposed" as const, reviewNote: "" }));
    expect(missingCallouts({ labels, parts })).toEqual([5]);
    // A rejected part leaves its number missing too.
    parts[0].state = "rejected" as never;
    expect(missingCallouts({ labels, parts })).toEqual([1, 5]);
  });
});

describe("Reading word labels", () => {
  // What local OCR returned for a real water-cycle diagram with twelve labels.
  const garbled: OcrLine[] = [
    { text: "Solar energy", confidence: 90, box: { x: 0.05, y: 0.15, width: 0.15, height: 0.05 } },
    { text: "Evaporation 111", confidence: 60, box: { x: 0.15, y: 0.5, width: 0.16, height: 0.05 } },
    { text: "yi glaciers 1 111", confidence: 40, box: { x: 0.84, y: 0.4, width: 0.12, height: 0.05 } },
    { text: "1111", confidence: 30, box: { x: 0.45, y: 0.55, width: 0.05, height: 0.04 } },
  ];
  const reading = {
    labels: [
      { text: "Solar energy", box: [150, 50, 200, 200] },
      { text: "Evaporation", box: [500, 150, 550, 310] },
      { text: "snow and glaciers", box: [320, 840, 450, 960] },
      { text: "Surface runoff", box: [550, 660, 600, 800] },
      { text: "Solar energy", box: [150, 50, 200, 200] },
    ],
  };
  it("keeps agreeing OCR, replaces garbled OCR, adds missed labels and drops noise", async () => {
    const words = await readWords(config, { bytes: PNG, mime: "image/png" }, fakeFetch(answer(JSON.stringify(reading))).impl);
    expect(words.map((w) => w.text)).toEqual(["Solar energy", "Evaporation", "snow and glaciers", "Surface runoff"]);
    const merged = mergeWords(linesToLabels(garbled), words);
    expect(merged.map((l) => [l.text, l.source])).toEqual([
      ["Solar energy", "local_ocr"], // OCR agreed, so its measured label stays
      ["Evaporation", "model_read"], // "Evaporation 111" was a misread
      ["snow and glaciers", "model_read"],
      ["Surface runoff", "model_read"], // OCR missed it entirely
    ]);
    // "1111" had no label under it and is gone.
    expect(merged.some((l) => l.text.includes("111"))).toBe(false);
  });
  it("lists a label once even when OCR placed it a little elsewhere", async () => {
    const words = await readWords(config, { bytes: PNG, mime: "image/png" }, fakeFetch(answer(JSON.stringify({ labels: [{ text: "Condensation", box: [60, 660, 110, 820] }] }))).impl);
    const elsewhere: OcrLine[] = [{ text: "Condensation", confidence: 88, box: { x: 0.3, y: 0.5, width: 0.1, height: 0.04 } }];
    expect(mergeWords(linesToLabels(elsewhere), words).map((l) => l.text)).toEqual(["Condensation"]);
  });
  it("drops OCR's half of a label the reading has in full", async () => {
    const words = await readWords(config, { bytes: PNG, mime: "image/png" }, fakeFetch(answer(JSON.stringify({ labels: [{ text: "snow and glaciers", box: [320, 840, 450, 960] }] }))).impl);
    const half: OcrLine[] = [{ text: "snow and", confidence: 70, box: { x: 0.1, y: 0.9, width: 0.08, height: 0.04 } }];
    expect(mergeWords(linesToLabels(half), words).map((l) => l.text)).toEqual(["snow and glaciers"]);
  });
  it("keeps OCR exactly as read when the word reading comes back empty", () => {
    expect(mergeWords(linesToLabels(garbled), [])).toEqual(linesToLabels(garbled));
  });
  it("uses the word reading on a diagram labelled in words, and not on a numbered one", async () => {
    const proposalFor = { parts: [{ id: "p1", name: "Surface runoff", ocrLabelId: "read-3", description: "Water flowing over land into streams.", evidence: ["read-3"] }], relationships: [], processFlow: [] };
    const { impl, calls } = fakeFetch(noCallouts(), answer(JSON.stringify(reading)), answer(JSON.stringify(proposalFor)));
    const result = await localTestEngine(config, "unused", impl, async () => garbled).run({ bytes: PNG, mime: "image/png" });
    expect(calls).toHaveLength(3);
    expect(result.ok && result.map.parts[0]).toMatchObject({ name: "Surface runoff", labelId: "read-3" });
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
    const { impl } = fakeFetch(noCallouts(), noWords(), reply(400, { error: { message: provider } }));
    const result = await localTestEngine(config, "unused", impl, async () => lines).run({ bytes: PNG, mime: "image/png" });
    expect(result).toMatchObject({ ok: false, failedStage: "model" });
    expect(result.ok ? "" : result.reason).toContain("Gemini rejected the request (HTTP 400).");
    expect(JSON.stringify(result)).not.toContain("123456");
    const limited = await localTestEngine(config, "unused", fakeFetch(noCallouts(), noWords(), reply(429, {}), reply(429, {})).impl, async () => lines).run({ bytes: PNG, mime: "image/png" });
    expect(limited.ok ? "" : limited.reason).toContain("free-tier limit reached");
  });
});
