import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import {
  diagramProposalSchema,
  type DiagramProposal,
  type OcrLabel,
} from "../../shared/proposal";

/**
 * Bedrock multimodal adapter for the DiagramSense pipeline.
 *
 * The model receives the original image bytes PLUS the normalized OCR label
 * list with explicit ids, and must answer with the structured proposal
 * contract (shared/proposal.ts) — nothing else is accepted.
 *
 * UNVERIFIED (docs/AWS_VERIFICATION.md): the exact multimodal capabilities
 * of the configured model id are not asserted anywhere in this code. The
 * model id comes from configuration only (SAHPAATH_BEDROCK_MODEL_ID); no
 * guessed ARNs, inference profiles, or hardcoded defaults.
 */

/** Prompt version — bump when the template changes materially. */
export const PROMPT_VERSION = "diagramsense-v1";

export class BedrockProposalError extends Error {
  constructor(
    readonly stage: "invoke" | "parse",
    message: string,
  ) {
    super(message);
    this.name = "BedrockProposalError";
  }
}

export interface BedrockProposalClient {
  /** Human-readable engine name for stage details. */
  readonly engine?: string;
  propose(input: { imageBytes: Buffer; mimeType: "image/png" | "image/jpeg"; ocrLabels: OcrLabel[]; lessonTitle: string }): Promise<DiagramProposal>;
}

/**
 * System + user prompt. Kept as data so tests can assert the grounding
 * instructions are always present.
 */
export function buildProposalPrompt(ocrLabels: OcrLabel[], lessonTitle: string): string {
  const labelLines = ocrLabels
    .map((l) => `- id=${l.labelId} text=${JSON.stringify(l.text)} confidence=${l.confidence.toFixed(1)} pos=(x=${l.x.toFixed(3)}, y=${l.y.toFixed(3)})`)
    .join("\n");
  return `You are building an accessibility map for a blind or low-vision student.

The lesson is "${lessonTitle}". Below is the COMPLETE list of text labels extracted from the diagram image by OCR, each with a fixed id, the exact recognized text, the OCR confidence, and the normalized position (x right, y down, 0..1 from the top-left corner).

OCR LABELS (the only allowed anchors):
${labelLines || "(no labels were recognized)"}

TASK: Describe the diagram as a structured map for someone who cannot see it.

RULES (violations are rejected automatically):
1. Every part MUST use the ocrLabelId of one of the labels listed above. NEVER invent a label id or a label text. If a concept has no label, DO NOT create a part for it.
2. part.name must be the exact OCR text of the referenced label (no paraphrasing), EXCEPT for numbered callouts (rule 4).
3. relationships may only connect parts you defined above, and every relationship's evidence MUST list the ocrLabelId of its source part and of its target part.
4. processFlow must list parts in a meaningful reading/processing order using 1-based "order" values. If the labels are numbered callouts (1, 2, 3, ...), that order IS the reading order: make one part per callout, list them by ascending callout number, keep ocrLabelId on the callout's number label, and set part.name to the name of the structure the callout's line points to in the image (for example "Pharynx"), never the bare number. The number is the part's place; the name is your identification, which the teacher checks against their key. Describe the structure itself, never as "label six points to...". Otherwise include a flow only when the diagram clearly shows a sequence; use each part at most once.
5. Write three description levels for every part:
   - description: one clear sentence (~15-30 words).
   - descriptionShort: at most ~8 words, for a quick glance.
   - descriptionDetailed: 2-4 sentences adding location (use the OCR position) and function.
6. Answer with ONLY a JSON object, no markdown fence, no commentary, matching exactly:
{"parts":[{"id":"p1","name":"<exact OCR text>","ocrLabelId":"<label id>","description":"...","descriptionShort":"...","descriptionDetailed":"..."}],"relationships":[{"sourcePartId":"p1","targetPartId":"p2","relationType":"flows_to","evidence":["<source ocrLabelId>","<target ocrLabelId>"]}],"processFlow":[{"order":1,"partId":"p1"}]}

relationType is one of: flows_to, connects_to, supports.`;
}

/** Extract the JSON object from a model answer (tolerates a stray fence). */
export function parseProposalText(text: string): DiagramProposal {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  const candidate = fenced ? fenced[1] : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start)
    throw new BedrockProposalError("parse", "Model answer contained no JSON object.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate.slice(start, end + 1));
  } catch (error) {
    throw new BedrockProposalError("parse", `Model answer was not valid JSON: ${(error as Error).message}`);
  }
  const result = diagramProposalSchema.safeParse(parsed);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new BedrockProposalError(
      "parse",
      `Proposal failed schema validation at ${first.path.join(".")}: ${first.message}`,
    );
  }
  return result.data;
}

export class BedrockProposalAdapter implements BedrockProposalClient {
  private client: BedrockRuntimeClient | null = null;

  constructor(
    private readonly modelId: string,
    private readonly region: string,
  ) {}

  private async getClient(): Promise<BedrockRuntimeClient> {
    if (!this.client) this.client = new BedrockRuntimeClient({ region: this.region });
    return this.client;
  }

  async propose(input: { imageBytes: Buffer; mimeType: "image/png" | "image/jpeg"; ocrLabels: OcrLabel[]; lessonTitle: string }): Promise<DiagramProposal> {
    const client = await this.getClient();
    const prompt = buildProposalPrompt(input.ocrLabels, input.lessonTitle);
    // Converse-style multimodal message. Model capability for image inputs is
    // UNVERIFIED; failures surface as stage:"invoke" errors, never as fakes.
    const command = new InvokeModelCommand({
      modelId: this.modelId,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 4096,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: input.mimeType, data: input.imageBytes.toString("base64") },
              },
              { type: "text", text: prompt },
            ],
          },
        ],
      }),
    });
    let response: { body: unknown };
    try {
      response = await client.send(command);
    } catch (error) {
      throw new BedrockProposalError("invoke", `Bedrock InvokeModel failed: ${(error as Error).message}`);
    }
    const body = response.body as { transformToString?: (enc: string) => Promise<string> } | undefined;
    if (!body?.transformToString)
      throw new BedrockProposalError("invoke", "Bedrock returned an empty response body.");
    const raw = await body.transformToString("utf-8");
    // Response envelope varies by model family; take the first text chunk.
    let text: string;
    try {
      const parsed = JSON.parse(raw) as { output?: { message?: { content?: Array<{ text?: string }> } } };
      text = parsed.output?.message?.content?.map((c) => c.text ?? "").join("") ?? "";
    } catch {
      text = raw;
    }
    if (!text.trim()) throw new BedrockProposalError("parse", "Model returned no text content.");
    return parseProposalText(text);
  }
}
