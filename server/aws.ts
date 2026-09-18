import { z } from "zod";
import type { DiagramMap, Label, Part, Relation, Flow } from "../shared/schema";
import { normalize } from "../shared/domain";

export interface AwsConfig {
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  bedrockModelId: string;
}
// Static IAM credentials or explicit opt-in to the SDK credential chain (roles).
// Bedrock API keys (ABSK...) are a different mechanism, not wired here.
export function readAwsConfig(env: NodeJS.ProcessEnv): AwsConfig | null {
  const region = env.AWS_REGION?.trim();
  const accessKeyId = env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY?.trim();
  const bedrockModelId = env.AWS_BEDROCK_MODEL_ID?.trim();
  if (!region || !bedrockModelId || (!(accessKeyId && secretAccessKey) && env.SAHPAATH_AWS_USE_ROLE !== "true"))
    return null;
  return {
    region,
    accessKeyId,
    secretAccessKey,
    sessionToken: env.AWS_SESSION_TOKEN?.trim() || undefined,
    bedrockModelId,
  };
}

const idPattern = /^[a-zA-Z0-9_-]{1,80}$/;
type TextractBlock = {
  BlockType?: string;
  Id?: string;
  Text?: string;
  Confidence?: number;
  Geometry?: {
    BoundingBox?: { Left?: number; Top?: number; Width?: number; Height?: number };
  };
};
// Pure: turns a DetectDocumentText response into schema-shaped source labels.
// LINE blocks in document order, normalized centre coordinates, capped at the
// schema maximum of 100 labels.
export function parseTextract(raw: unknown): Label[] {
  const blocks = (z
    .object({ Blocks: z.array(z.record(z.string(), z.unknown())).optional() })
    .parse(raw).Blocks ?? []) as TextractBlock[];
  const labels: Label[] = [];
  for (const block of blocks) {
    if (block.BlockType !== "LINE") continue;
    const text = block.Text?.trim();
    if (!text || text.length > 120) continue;
    const box = block.Geometry?.BoundingBox;
    if (!box || ![box.Left, box.Top, box.Width, box.Height].every((n) => typeof n === "number" && Number.isFinite(n)) ||
      box.Left! < 0 || box.Top! < 0 || box.Width! <= 0 || box.Height! <= 0 ||
      box.Left! + box.Width! > 1.000001 || box.Top! + box.Height! > 1.000001) continue;
    const x =
      box && Number.isFinite(box.Left) && Number.isFinite(box.Width)
        ? (box.Left as number) + (box.Width as number) / 2
        : null;
    const y =
      box && Number.isFinite(box.Top) && Number.isFinite(box.Height)
        ? (box.Top as number) + (box.Height as number) / 2
        : null;
    if (x === null || y === null || x < 0 || x > 1 || y < 0 || y > 1) continue;
    labels.push({
      id: block.Id && idPattern.test(block.Id) ? block.Id : `label-${labels.length}`,
      text,
      confidence:
        typeof block.Confidence === "number" && block.Confidence >= 0 && block.Confidence <= 100
          ? Math.round(block.Confidence * 100) / 100
          : null,
      source: "textract",
      x: Math.round(x * 10000) / 10000,
      y: Math.round(y * 10000) / 10000,
      boundingBox: { left: box.Left!, top: box.Top!, width: box.Width!, height: box.Height! },
    });
    if (labels.length >= 100) break;
  }
  return labels;
}

// Legacy name-based adapter retained for compatibility tests. The production
// path uses diagram-pipeline.ts's explicit-ID schema and never calls this adapter.
export const proposalSchema = z
  .object({
    parts: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(120),
            description: z.string().trim().min(1).max(2000),
            confidence: z.number().min(0).max(100).optional(),
          })
          .strict(),
      )
      .max(60),
    relations: z
      .array(
        z
          .object({
            from: z.string().trim().min(1).max(120),
            to: z.string().trim().min(1).max(120),
            kind: z.enum(["flows_to", "connects_to", "supports"]),
            confidence: z.number().min(0).max(100).optional(),
          })
          .strict(),
      )
      .max(120),
    flows: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(120),
            steps: z.array(z.string().trim().min(1).max(120)).min(1).max(60),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
export type Proposal = z.infer<typeof proposalSchema>;

// Pure: grounds a model proposal against real OCR labels. Any part whose name
// does not match an OCR label is dropped (the teacher can add it by hand);
// relations and flows survive only when every referenced part survived.
// Evidence is attached deterministically from the endpoint labels.
export function groundProposal(proposal: Proposal, labels: Label[]): DiagramMap {
  const byName = new Map<string, Label>();
  for (const label of labels)
    if (!byName.has(normalize(label.text))) byName.set(normalize(label.text), label);
  const parts: Part[] = [];
  const nameToId = new Map<string, string>();
  for (const part of proposal.parts) {
    const label = byName.get(normalize(part.name));
    if (!label) continue;
    const id = `part-${parts.length}`;
    nameToId.set(normalize(part.name), id);
    parts.push({
      id,
      labelId: label.id,
      name: label.text,
      description: part.description,
      aliases: [],
      modelConfidence: part.confidence ?? null,
      state: "ai_proposed" as const,
      reviewNote: "",
    });
  }
  const labelById = new Map(labels.map((l) => [l.id, l]));
  const relations: Relation[] = [];
  for (const relation of proposal.relations) {
    const from = nameToId.get(normalize(relation.from));
    const to = nameToId.get(normalize(relation.to));
    if (!from || !to || from === to) continue;
    if (
      relations.some(
        (r) =>
          r.kind === relation.kind &&
          ((r.from === from && r.to === to) ||
            (relation.kind === "connects_to" && r.from === to && r.to === from)),
      )
    )
      continue;
    relations.push({
      id: `relation-${relations.length}`,
      from,
      to,
      kind: relation.kind,
      evidence: [labelById.get(parts.find((p) => p.id === from)!.labelId)!.id, labelById.get(parts.find((p) => p.id === to)!.labelId)!.id],
      modelConfidence: relation.confidence ?? null,
      state: "ai_proposed" as const,
      reviewNote: "",
    });
  }
  const flows: Flow[] = [];
  for (const flow of proposal.flows) {
    const steps = flow.steps
      .map((s) => nameToId.get(normalize(s)))
      .filter((s): s is string => !!s);
    const unique = [...new Set(steps)];
    if (unique.length < 2) continue;
    const connected = unique.every((step, i) =>
      i === 0 || relations.some((r) => r.from === unique[i - 1] && r.to === step),
    );
    if (!connected) continue;
    flows.push({
      id: `flow-${flows.length}`,
      name: flow.name,
      steps: unique,
      state: "ai_proposed" as const,
      reviewNote: "",
    });
  }
  return { labels, parts, relations, flows };
}

export function converseToolSpec() {
  return {
    toolSpec: {
      name: "submit_diagram_map",
      description:
        "Return the diagram's parts, relationships and reading order. Use the exact visible label text for every name.",
      inputSchema: {
        json: {
          type: "object",
          additionalProperties: false,
          required: ["parts", "relations", "flows"],
          properties: {
            parts: {
              type: "array",
              maxItems: 60,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["name", "description"],
                properties: {
                  name: { type: "string", description: "Exactly as printed in the diagram." },
                  description: { type: "string", description: "One student-facing sentence." },
                },
              },
            },
            relations: {
              type: "array",
              maxItems: 120,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["from", "to", "kind"],
                properties: {
                  from: { type: "string" },
                  to: { type: "string" },
                  kind: { enum: ["flows_to", "connects_to", "supports"] },
                },
              },
            },
            flows: {
              type: "array",
              maxItems: 20,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["name", "steps"],
                properties: {
                  name: { type: "string" },
                  steps: { type: "array", maxItems: 60, items: { type: "string" } },
                },
              },
            },
          },
        },
      },
    },
  };
}

export function analysisPrompt(labels: Label[]): string {
  return [
    "You are proposing an accessibility map of an educational diagram for a teacher to verify.",
    "The visible text labels found by OCR are:",
    labels.map((l) => `- ${l.text}`).join("\n"),
    "Use ONLY these exact label texts as part names. Describe each part in one simple sentence for students.",
    "Propose relationships only when the diagram's arrows or structure support them.",
    "A reading order (flow) must follow your proposed forward relationships step by step.",
  ].join("\n\n");
}
