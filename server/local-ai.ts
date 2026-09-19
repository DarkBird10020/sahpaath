import { z } from "zod";
import { mkdirSync } from "node:fs";
import type { Label } from "../shared/schema";
import { diagramPrompt, diagramProposalSchema, runDiagramPipeline } from "./diagram-pipeline";
import type { TextractClientPort, TextractDetections } from "./providers/textract";
import { buildProposalPrompt, parseProposalText, BedrockProposalError, type BedrockProposalClient } from "./providers/bedrock";
import type { OcrLabel } from "../shared/proposal";

/**
 * Test stand-ins for when Amazon Bedrock/Textract are unavailable:
 * - OCR runs on this machine with tesseract.js (no network after the
 *   one-time English language download, no key, no limits).
 * - The proposal step calls the Google Gemini API free tier.
 * Both feed the same deterministic validator and teacher review as the AWS
 * path. Nothing here is AWS, and stage details say so.
 */

export interface GeminiConfig {
  apiKey: string;
  model: string;
}
export function readGeminiConfig(env: NodeJS.ProcessEnv): GeminiConfig | null {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  return { apiKey, model: env.SAHPAATH_GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite" };
}

/** `userMessage` is our own wording and safe to show a teacher; `message`
 * may include provider text and is never shown in the UI. */
export class GeminiError extends Error {
  constructor(readonly status: number | null, readonly userMessage: string, detail = "") {
    super(detail ? `${userMessage} ${detail}` : userMessage);
    this.name = "GeminiError";
  }
}

// Keywords sent to Gemini's JSON-schema mode; everything else is removed here
// and still enforced afterwards by the zod schemas. minItems/maxItems are left
// out: gemini-3.5-flash-lite rejected them with HTTP 400 (tested 2026-09-18).
const allowedKeywords = new Set([
  "type", "properties", "required", "additionalProperties", "enum", "format",
  "minimum", "maximum", "items", "prefixItems", "title", "description", "anyOf",
]);
export function geminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(geminiSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (!allowedKeywords.has(key)) continue;
    out[key] =
      key === "properties"
        ? Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, geminiSchema(v)]))
        : typeof value === "object" && value !== null ? geminiSchema(value) : value;
  }
  return out;
}

type Fetch = typeof fetch;
/** One generateContent call returning the text answer. Retries once on 429/503. */
export async function geminiGenerate(
  config: GeminiConfig,
  input: { prompt: string; image?: { bytes: Buffer; mime: string }; videoUrl?: string; jsonSchema?: unknown },
  fetchImpl: Fetch = fetch,
  waitMs = 2000,
): Promise<string> {
  const body = JSON.stringify({
    contents: [{
      role: "user",
      parts: [
        ...(input.image ? [{ inlineData: { mimeType: input.image.mime, data: input.image.bytes.toString("base64") } }] : []),
        // Gemini fetches a public YouTube page itself, so nothing is downloaded
        // here and no copy of the video is made. A minute of video costs roughly
        // 300 tokens, which is why the caller limits the length.
        ...(input.videoUrl ? [{ fileData: { fileUri: input.videoUrl } }] : []),
        { text: input.prompt },
      ],
    }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
      ...(input.jsonSchema ? { responseJsonSchema: geminiSchema(input.jsonSchema) } : {}),
    },
  });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`;
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": config.apiKey },
        body,
        // A whole video is read by Gemini in one call and takes far longer than
        // a picture or a few minutes of audio.
        signal: AbortSignal.timeout(input.videoUrl ? 540_000 : 120_000),
      });
    } catch (error) {
      // One retry for dropped connections, as for busy responses.
      if (attempt === 0 && !(error instanceof DOMException && error.name === "TimeoutError")) {
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      throw new GeminiError(null, "Could not reach Gemini.", (error as Error).message);
    }
    const data = (await response.json().catch(() => ({}))) as {
      error?: { message?: string };
      candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[];
    };
    if ((response.status === 429 || response.status === 503) && attempt === 0) {
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    if (!response.ok)
      throw new GeminiError(
        response.status,
        response.status === 429
          ? "Gemini free-tier limit reached. Wait and retry."
          : `Gemini rejected the request (HTTP ${response.status}).`,
        (data.error?.message ?? "").slice(0, 200),
      );
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (candidate?.finishReason && candidate.finishReason !== "STOP")
      throw new GeminiError(response.status, `Gemini stopped early (${candidate.finishReason}).`);
    if (!text.trim()) throw new GeminiError(response.status, "Gemini returned no text.");
    return text;
  }
  throw new GeminiError(503, "Gemini is busy. Retry in a moment.");
}

/** Pixel size of a PNG or JPEG, read from its header. */
export function imageSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length > 24 && bytes.subarray(12, 16).toString() === "IHDR")
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const marker = bytes[i + 1];
      const length = bytes.readUInt16BE(i + 2);
      // SOF0..SOF15 except DHT(C4), JPG(C8), DAC(CC) carry the frame size.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
        return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
      i += 2 + length;
    }
  }
  return null;
}

export type OcrLine = TextractDetections["lines"][number];
type OcrWord = { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number }; nextToArrow?: boolean };

// Arrow heads, dashes and similar strokes that OCR reads as characters.
// Dash and arrow ranges, then other strokes; the final "-" is a literal hyphen.
const strokeChars = "‒-―←-⇿_=»«<>|~·•-";
// Only strokes at the edges of a word are removed, so "X-ray" keeps its hyphen.
const edgeStrokes = new RegExp(`^[${strokeChars}]+|[${strokeChars}]+$`, "gu");
/**
 * Splits one OCR line into label-sized pieces. Diagram arrows often touch
 * their labels, so a line like "Right ventricle ———> Pulmonary artery" is two
 * labels. Words that are only strokes (or strokes plus a single stray
 * character) are dropped and end the current piece.
 */
/** Splits one word at runs of 2+ strokes ("ventricle——>p"), estimating each
 * piece's box from its character position inside the word. */
function splitWordAtArrows(word: OcrWord): OcrWord[] {
  const run = new RegExp(`[${strokeChars}]{2,}`, "gu");
  const out: OcrWord[] = [];
  const width = word.bbox.x1 - word.bbox.x0;
  const n = Math.max(1, word.text.length);
  let last = 0;
  const push = (start: number, end: number) => {
    if (end <= start) return;
    out.push({ ...word, nextToArrow: true, text: word.text.slice(start, end), bbox: { ...word.bbox,
      x0: word.bbox.x0 + (width * start) / n, x1: word.bbox.x0 + (width * end) / n } });
  };
  for (const m of word.text.matchAll(run)) {
    push(last, m.index ?? 0);
    out.push({ ...word, text: m[0] });
    last = (m.index ?? 0) + m[0].length;
  }
  if (!out.length) return [word];
  push(last, word.text.length);
  return out;
}
export function splitLineWords(input: OcrWord[]): OcrWord[][] {
  const words = input.flatMap(splitWordAtArrows);
  const pieces: OcrWord[][] = [];
  let current: OcrWord[] = [];
  for (const word of words) {
    const cleaned = word.text.replace(edgeStrokes, "");
    const hadStrokes = cleaned.length !== word.text.length;
    const alnum = (cleaned.match(/[\p{L}\p{N}]/gu) ?? []).length;
    if (alnum === 0 || ((hadStrokes || word.nextToArrow) && alnum <= 1)) {
      if (current.length) pieces.push(current);
      current = [];
      continue;
    }
    current.push({ ...word, text: cleaned.trim() });
  }
  if (current.length) pieces.push(current);
  return pieces;
}
/**
 * Line-level OCR on this machine. Sparse-text mode suits diagrams, whose labels
 * are short and scattered. Boxes are converted to 0..1 fractions of the image.
 */
export async function localOcrLines(bytes: Buffer, cacheDir: string): Promise<OcrLine[]> {
  const size = imageSize(bytes);
  if (!size || !size.width || !size.height) throw new Error("Could not read the image size.");
  const { createWorker } = await import("tesseract.js");
  // tesseract.js does not create the cache folder; without it the language
  // data would be downloaded again on every run.
  mkdirSync(cacheDir, { recursive: true });
  const worker = await createWorker("eng", 1, { cachePath: cacheDir, logger: () => {}, errorHandler: () => {} });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: "11" as never });
    const { data } = await worker.recognize(bytes, {}, { blocks: true });
    const lines: OcrLine[] = [];
    for (const block of data.blocks ?? [])
      for (const paragraph of block.paragraphs)
        for (const line of paragraph.lines)
          for (const piece of splitLineWords(line.words)) {
            const text = piece.map((w) => w.text).join(" ").replace(/\s+/g, " ").trim();
            const confidence = piece.reduce((sum, w) => sum + w.confidence, 0) / piece.length;
            // Skip noise without letters or digits and very uncertain reads.
            if (!text || text.length > 120 || !/[\p{L}\p{N}]/u.test(text) || confidence < 30) continue;
            const x0 = Math.min(...piece.map((w) => w.bbox.x0));
            const y0 = Math.min(...piece.map((w) => w.bbox.y0));
            const x1 = Math.max(...piece.map((w) => w.bbox.x1));
            const y1 = Math.max(...piece.map((w) => w.bbox.y1));
            lines.push({
              text,
              confidence,
              box: { x: x0 / size.width, y: y0 / size.height, width: (x1 - x0) / size.width, height: (y1 - y0) / size.height },
            });
            if (lines.length >= 200) return lines;
          }
    return lines;
  } finally {
    await worker.terminate();
  }
}

/** Classroom-pipeline labels from local OCR lines (same shape as Textract labels). */
export function linesToLabels(lines: OcrLine[]): Label[] {
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  return lines.slice(0, 100).map((line, i) => {
    const left = clamp(line.box.x);
    const top = clamp(line.box.y);
    const width = Math.max(0.0001, Math.min(1 - left, line.box.width));
    const height = Math.max(0.0001, Math.min(1 - top, line.box.height));
    return {
      id: `ocr-${i}`,
      text: line.text,
      confidence: Math.round(clamp(line.confidence / 100) * 10000) / 100,
      source: "local_ocr" as const,
      x: Math.round((left + width / 2) * 10000) / 10000,
      y: Math.round((top + height / 2) * 10000) / 10000,
      boundingBox: { left, top, width, height },
    };
  });
}

export interface AnalysisEngine {
  ocrName: string;
  modelName: string;
  /** Shown in stage details so no one mistakes a stand-in for AWS. */
  note: string;
  run(image: { bytes: Buffer; mime: "image/png" | "image/jpeg" }): ReturnType<typeof runDiagramPipeline>;
}

/** Classroom pipeline engine: local OCR + Gemini, same validator as AWS. */
export function localTestEngine(
  gemini: GeminiConfig,
  ocrCacheDir: string,
  fetchImpl: Fetch = fetch,
  ocr: (bytes: Buffer, cacheDir: string) => Promise<OcrLine[]> = localOcrLines,
): AnalysisEngine {
  const { $schema: _drop, ...jsonSchema } = z.toJSONSchema(diagramProposalSchema) as Record<string, unknown>;
  const modelName = `Gemini ${gemini.model}`;
  return {
    ocrName: "Local OCR (tesseract.js)",
    modelName,
    note: "Test stand-in, not AWS.",
    run: (image) =>
      runDiagramPipeline({
        ocr: async () => linesToLabels(await ocr(image.bytes, ocrCacheDir)),
        propose: (labels, retry) =>
          geminiGenerate(gemini, { prompt: diagramPrompt(labels, retry, "json"), image, jsonSchema }, fetchImpl),
        parse: (raw) => diagramProposalSchema.parse(JSON.parse(String(raw))),
        modelName,
      }),
  };
}

/** v1 pipeline OCR adapter backed by local tesseract.js. */
export class LocalOcrAdapter implements TextractClientPort {
  readonly labelSource = "local_ocr" as const;
  readonly engine = "local OCR (tesseract.js), test stand-in, not AWS";
  constructor(private readonly cacheDir: string) {}
  async detect(input: { imageBytes: Buffer }): Promise<TextractDetections> {
    return { lines: await localOcrLines(input.imageBytes, this.cacheDir) };
  }
}

/** v1 pipeline proposal adapter backed by Gemini, using the v1 prompt and parser. */
export class GeminiProposalAdapter implements BedrockProposalClient {
  readonly engine: string;
  constructor(private readonly config: GeminiConfig, private readonly fetchImpl: Fetch = fetch) {
    this.engine = `Gemini ${config.model}, test stand-in, not AWS`;
  }
  async propose(input: { imageBytes: Buffer; mimeType: "image/png" | "image/jpeg"; ocrLabels: OcrLabel[]; lessonTitle: string }) {
    let text: string;
    try {
      text = await geminiGenerate(
        this.config,
        { prompt: buildProposalPrompt(input.ocrLabels, input.lessonTitle), image: { bytes: input.imageBytes, mime: input.mimeType } },
        this.fetchImpl,
      );
    } catch (error) {
      throw new BedrockProposalError("invoke", (error as Error).message);
    }
    return parseProposalText(text);
  }
}
