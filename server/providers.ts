import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { fixtureMap, fixtures } from "../shared/fixtures";
import { revalidate, validateMap } from "../shared/domain";
import {
  mapSchema,
  type DiagramMap,
  type Lesson,
  type Stage,
} from "../shared/schema";

export type AnalysisResult =
  | { ok: true; map: DiagramMap }
  | { ok: false; reason: string; fallback: "manual_editor" };
export interface AnalysisProvider {
  analyze(fixtureId: string): Promise<AnalysisResult>;
}
export class DemoAnalysisProvider implements AnalysisProvider {
  async analyze(fixtureId: string): Promise<AnalysisResult> {
    // Demo simulation: no network/model call; deterministic authored proposals.
    try {
      return { ok: true, map: mapSchema.parse(fixtureMap(fixtureId)) };
    } catch {
      return {
        ok: false,
        reason:
          "No fixture proposal is available. Add the labels and map by hand.",
        fallback: "manual_editor",
      };
    }
  }
}
export function imageType(bytes: Buffer): "image/png" | "image/jpeg" | null {
  if (bytes.length < 24 || bytes.length > 5_000_000) return null;
  if (
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.subarray(12, 16).toString() === "IHDR"
  )
    return "image/png";
  if (
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255 &&
    bytes.at(-2) === 255 &&
    bytes.at(-1) === 217
  )
    return "image/jpeg";
  return null;
}
export async function createLesson(
  fixtureId: string | null,
  title?: string,
  image?: string,
): Promise<Lesson> {
  const stages: Stage[] = [];
  const stage = (
    name: string,
    status: Stage["status"],
    simulation: boolean,
    detail: string,
    durationMs: number | null = null,
  ): Stage => ({
    name,
    status,
    simulation,
    detail,
    durationMs,
    retries: 0,
    error: null,
  });
  stages.push(
    stage(
      "Upload & storage",
      "completed",
      false,
      image
        ? "Original saved to private local storage."
        : "Self-created schematic selected from local fixtures.",
    ),
  );
  stages.push(
    stage(
      "OCR labels",
      fixtureId ? "completed" : "fallback",
      !!fixtureId,
      fixtureId
        ? "Authored source labels loaded. Textract was not called. OCR confidence is not measured."
        : "OCR is not connected. Add visible labels manually.",
    ),
  );
  const start = performance.now();
  const result = fixtureId
    ? await new DemoAnalysisProvider().analyze(fixtureId)
    : {
        ok: false as const,
        reason: "Add parts and relationships in the manual editor.",
      };
  stages.push(
    stage(
      "Analysis",
      result.ok ? "completed" : "fallback",
      !!fixtureId,
      result.ok
        ? "Authored proposal loaded. Bedrock was not called. Duration is local fixture loading only."
        : result.reason,
      performance.now() - start,
    ),
  );
  const validationStart = performance.now();
  const map = revalidate(
    result.ok
      ? result.map
      : { labels: [], parts: [], relations: [], flows: [] },
  );
  stages.push(
    stage(
      "Validation",
      "completed",
      false,
      `${validateMap(map).length} deterministic validation finding(s).`,
      performance.now() - validationStart,
    ),
  );
  stages.push(
    stage(
      "Teacher review",
      "waiting",
      false,
      "Every part, relationship and flow needs an explicit decision.",
    ),
  );
  stages.push(
    stage(
      "Audio",
      "fallback",
      false,
      "Text is available. Optional browser speech after publication; Polly is not connected.",
    ),
  );
  stages.push(
    stage(
      "Publish",
      "locked",
      false,
      "Review must finish before students receive this version.",
    ),
  );
  const fixture = fixtures.find((f) => f.id === fixtureId);
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    jobId: randomUUID(),
    title: title || fixture?.title || "Untitled lesson",
    subject: fixture?.subject || "Your lesson",
    fixtureId,
    image: image || null,
    map,
    revision: 0,
    version: 1,
    publishedVersion: null,
    status: "draft",
    stages,
    createdAt: now,
    updatedAt: now,
  };
}
