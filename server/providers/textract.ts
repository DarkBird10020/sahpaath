import { TextractClient, DetectDocumentTextCommand } from "@aws-sdk/client-textract";
import { ocrLabelSchema, type OcrLabel } from "../../shared/proposal";
import { validationError } from "../core/errors";

/**
 * Textract adapter + deterministic OCR normalization for DiagramSense.
 *
 * DetectDocumentText returns LINE and WORD block detections with bounding
 * boxes (already normalized 0..1 fractions, origin top-left — UNVERIFIED
 * against a live account; the normalizer does not rely on this beyond
 * clamping and re-centering) and a 0..100 confidence.
 *
 * Normalization is PURE: same input bytes -> same labels, so tests use
 * deterministic fixtures with no network.
 */

export class TextractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TextractError";
  }
}

export interface TextractDetections {
  /** Line-level detections, already ordered by reading order (top→bottom, left→right). */
  lines: Array<{
    text: string;
    confidence: number;
    /** Normalized 0..1 bounding box, origin top-left. */
    box: { x: number; y: number; width: number; height: number };
  }>;
}

export interface TextractClientPort {
  detect(input: { imageBytes: Buffer }): Promise<TextractDetections>;
  /** Where the labels come from; local stand-ins must not be recorded as Textract. */
  readonly labelSource?: "textract" | "local_ocr";
  /** Human-readable engine name for stage details. */
  readonly engine?: string;
}

export class TextractAdapter implements TextractClientPort {
  private client: TextractClient | null = null;

  constructor(private readonly region: string) {}

  private async getClient(): Promise<TextractClient> {
    if (!this.client) this.client = new TextractClient({ region: this.region });
    return this.client;
  }

  async detect(input: { imageBytes: Buffer }): Promise<TextractDetections> {
    const client = await this.getClient();
    try {
      const response = await client.send(
        new DetectDocumentTextCommand({ Document: { Bytes: input.imageBytes } }),
      );
      const lines: TextractDetections["lines"] = [];
      const blocks = response.Blocks ?? [];
      for (const block of blocks) {
        if (block.BlockType !== "LINE" || !block.Text) continue;
        const geo = block.Geometry?.BoundingBox;
        if (!geo) continue;
        lines.push({
          text: block.Text,
          confidence: block.Confidence ?? 0,
          box: {
            x: geo.Left ?? 0,
            y: geo.Top ?? 0,
            width: geo.Width ?? 0,
            height: geo.Height ?? 0,
          },
        });
        if (lines.length >= 200) break; // hard cap before normalization
      }
      return { lines };
    } catch (error) {
      throw new TextractError(`Textract DetectDocumentText failed: ${(error as Error).message}`);
    }
  }
}

/**
 * Deterministic normalization: raw line detections -> canonical OcrLabels.
 * Ids are assigned in GEOMETRIC reading order (row bands, then left→right),
 * so the same image always yields the same label ids regardless of the
 * order Textract happened to return blocks in.
 */
export function normalizeOcr(detections: TextractDetections, maxLabels = 100): OcrLabel[] {
  const seen = new Set<string>();
  const unique = detections.lines.filter((line) => {
    const text = line.text.trim();
    if (!text || seen.has(text)) return false;
    seen.add(text);
    return true;
  });
  const labels: OcrLabel[] = [];
  for (const line of readingOrderSort(
    unique.map((line) => ({
      labelId: "",
      text: line.text.trim(),
      confidence: Math.round(Math.min(100, Math.max(0, line.confidence)) * 10) / 10,
      x: clamp01(line.box.x + line.box.width / 2),
      y: clamp01(line.box.y + line.box.height / 2),
    })),
  )) {
    const parsed = ocrLabelSchema.safeParse({ ...line, labelId: `label-${labels.length}` });
    if (!parsed.success) continue;
    labels.push(parsed.data);
    if (labels.length >= maxLabels) break;
  }
  return labels;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

/** Reading order: rows banded by y (10% of image height), then left→right. */
export function readingOrderSort(labels: OcrLabel[]): OcrLabel[] {
  const sorted = [...labels];
  sorted.sort((a, b) => {
    const band = (y: number) => Math.floor(y / 0.1);
    const ba = band(a.y);
    const bb = band(b.y);
    if (ba !== bb) return ba - bb;
    return a.x - b.x;
  });
  return sorted;
}
