import { diagramPrompt, diagramTool, runDiagramPipeline } from "./diagram-pipeline";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { fixtureMap, fixtures } from "../shared/fixtures";
import { revalidate, validateMap } from "../shared/domain";
import {
  mapSchema,
  type DiagramMap,
  type Label,
  type Lesson,
  type License,
  type Stage,
} from "../shared/schema";
import {
  parseTextract,
  readAwsConfig,
  type AwsConfig,
} from "./aws";

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

export type AwsCallResult = Awaited<ReturnType<typeof runDiagramPipeline>>;
export async function analyzeWithAws(
  config: AwsConfig,
  image: { bytes: Buffer; mime: "image/png" | "image/jpeg" },
): Promise<AwsCallResult> {
  const { TextractClient, DetectDocumentTextCommand } = await import("@aws-sdk/client-textract");
  const { BedrockRuntimeClient, ConverseCommand } = await import("@aws-sdk/client-bedrock-runtime");
  const credentials = config.accessKeyId && config.secretAccessKey ? {
    accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, sessionToken: config.sessionToken,
  } : undefined;
  const textract = new TextractClient({ region: config.region, credentials, maxAttempts: 1 });
  const bedrock = new BedrockRuntimeClient({ region: config.region, credentials, maxAttempts: 1 });
  try {
    return await runDiagramPipeline({
      ocr: async () => parseTextract(await textract.send(new DetectDocumentTextCommand({
        Document: { Bytes: new Uint8Array(image.bytes) },
      }), { abortSignal: AbortSignal.timeout(60_000) })),
      propose: (labels, retry) => bedrock.send(new ConverseCommand({
        modelId: config.bedrockModelId,
        messages: [{ role: "user", content: [
          { image: { format: image.mime === "image/png" ? "png" : "jpeg", source: { bytes: new Uint8Array(image.bytes) } } },
          { text: diagramPrompt(labels, retry) },
        ] }],
        toolConfig: { tools: [diagramTool()], toolChoice: { tool: { name: "submit_diagram_map" } } },
        inferenceConfig: { maxTokens: 8192 },
      }), { abortSignal: AbortSignal.timeout(120_000) }),
    });
  } finally { textract.destroy(); bedrock.destroy(); }
}
export function awsEnabled(env: NodeJS.ProcessEnv): AwsConfig | null {
  return readAwsConfig(env);
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
  imageBytes?: Buffer,
  awsConfig?: AwsConfig | null,
  license?: License | null,
): Promise<Lesson> {
  const stages: Stage[] = [];
  const stage = (
    name: string,
    status: Stage["status"],
    simulation: boolean,
    detail: string,
    durationMs: number | null = null,
    retries: number = 0,
    error: string | null = null,
  ): Stage => ({
    name,
    status,
    simulation,
    detail,
    durationMs,
    retries,
    error,
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
  // Real AWS path only for genuine uploads with AWS fully configured.
  const mime = imageBytes ? imageType(imageBytes) : null;
  const useAws = !!imageBytes && !!awsConfig && !fixtureId && !!mime;
  let map: DiagramMap | null = null;
  if (useAws) {
    const config = awsConfig!;
    try {
      const result = await analyzeWithAws(config, {
        bytes: imageBytes!,
        mime: mime!,
      });
      const round = (ms: number | null) =>
        ms === null ? null : Math.round(ms * 100) / 100;
      if (result.ok) {
        map = result.map;
        stages.push(
          stage(
            "OCR labels",
            "completed",
            false,
            `Textract DetectDocumentText returned ${result.labels.length} LINE labels.`,
            round(result.durations.ocrMs),
          ),
        );
        stages.push(
          stage(
            "Analysis",
            "completed",
            false,
            `Bedrock ${config.bedrockModelId} proposal grounded against ${result.labels.length} OCR labels; ${map.parts.length} proposed parts; ${result.issues.length} validation findings. Teacher review required.`,
            round(result.durations.modelMs),
            result.retries,
          ),
        );
      } else {
        // Keep the real OCR labels for the manual map editor.
        map = { labels: result.labels, parts: [], relations: [], flows: [] };
        stages.push(
          stage(
            "OCR labels",
            result.failedStage === "ocr" ? "fallback" : "completed",
            false,
            result.failedStage === "ocr" ? result.reason : `Textract DetectDocumentText returned ${result.labels.length} LINE labels.`,
            round(result.durations.ocrMs),
          ),
        );
        stages.push(
          stage(
            "Analysis",
            "fallback",
            false,
            result.reason,
            round(result.durations.modelMs),
            result.retries,
          ),
        );
      }
    } catch (error) {
      const reason = "AWS pipeline initialization failed. Check server configuration.";
      stages.push(
        stage(
          "OCR labels",
          "fallback",
          false,
          "Textract failed. Add labels manually.",
          null,
          0,
          reason,
        ),
      );
      stages.push(
        stage(
          "Analysis",
          "fallback",
          false,
          "Bedrock analysis skipped after OCR failure. Use the manual map editor.",
        ),
      );
    }
  } else if (fixtureId) {
    const start = performance.now();
    const result = await new DemoAnalysisProvider().analyze(fixtureId);
    stages.push(
      stage(
        "OCR labels",
        "completed",
        true,
        "Authored source labels loaded. Textract was not called. OCR confidence is not measured.",
      ),
    );
    stages.push(
      stage(
        "Analysis",
        result.ok ? "completed" : "fallback",
        true,
        result.ok
          ? "Authored proposal loaded. Bedrock was not called. Duration is local fixture loading only."
          : result.reason,
        performance.now() - start,
      ),
    );
    map = result.ok ? result.map : null;
  } else {
    stages.push(
      stage(
        "OCR labels",
        "fallback",
        false,
        "OCR is not connected. Add visible labels manually.",
      ),
    );
    stages.push(
      stage(
        "Analysis",
        "fallback",
        false,
        "Add parts and relationships in the manual editor.",
      ),
    );
  }
  const validationStart = performance.now();
  const validated = revalidate(
    map ?? { labels: [], parts: [], relations: [], flows: [] },
  );
  stages.push(
    stage(
      "Validation",
      "completed",
      false,
      `${validateMap(validated).length} deterministic validation finding(s).`,
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
    // Self-created schematics carry their own license; uploads require the
    // teacher's license declaration, enforced at publish.
    license:
      license ??
      (fixtureId
        ? {
            sourceUrl: "",
            licenseName: "Self-created schematic",
            attribution: "SahPaath team",
            sourceType: "self_created" as const,
          }
        : null),
    map: validated,
    revision: 0,
    version: 1,
    publishedVersion: null,
    status: "draft",
    stages,
    createdAt: now,
    updatedAt: now,
  };
}
