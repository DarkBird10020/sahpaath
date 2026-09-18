import { z } from "zod";
export const runSchema = z
  .object({
    source: z.literal("actual_run"),
    runId: z.string().min(1),
    recordedAt: z.iso.datetime(),
    expectedLabels: z.array(z.string()).optional(),
    observedLabels: z.array(z.string()).optional(),
    expectedRelations: z.array(z.string()).optional(),
    observedRelations: z.array(z.string()).optional(),
    expectedFlow: z.array(z.string()).optional(),
    observedFlow: z.array(z.string()).optional(),
    proposedCount: z.number().int().nonnegative().optional(),
    groundedCount: z.number().int().nonnegative().optional(),
    correctedCount: z.number().int().nonnegative().optional(),
    processingMs: z.number().nonnegative().optional(),
    referenceTranscript: z.string().optional(),
    transcript: z.string().optional(),
    expectedTerms: z.array(z.string()).optional(),
    phraseStartedAt: z.number().nonnegative().optional(),
    phraseSentAt: z.number().nonnegative().optional(),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.proposedCount !== undefined)
      for (const key of ["groundedCount", "correctedCount"] as const)
        if (r[key] !== undefined && r[key] > r.proposedCount)
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: "Count cannot exceed proposedCount.",
          });
    if (
      r.phraseStartedAt !== undefined &&
      r.phraseSentAt !== undefined &&
      r.phraseSentAt < r.phraseStartedAt
    )
      ctx.addIssue({
        code: "custom",
        path: ["phraseSentAt"],
        message: "Send time cannot precede start.",
      });
  });
const ratio = (a?: number, b?: number) =>
  a === undefined || !b ? null : a / b;
const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
function recall(expected?: string[], observed?: string[]) {
  if (!expected || !observed) return null;
  const e = new Set(expected);
  const o = new Set(observed);
  return ratio([...e].filter((v) => o.has(v)).length, e.size);
}
export function wordErrorRate(reference?: string, hypothesis?: string) {
  if (reference === undefined || hypothesis === undefined) return null;
  const a = normalize(reference).split(" ").filter(Boolean);
  const b = normalize(hypothesis).split(" ").filter(Boolean);
  if (!a.length) return null;
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  a.forEach((word, i) => {
    const next = [i + 1];
    b.forEach((other, j) => {
      next[j + 1] = Math.min(
        next[j] + 1,
        row[j + 1] + 1,
        row[j] + Number(word !== other),
      );
    });
    row = next;
  });
  return row[b.length] / a.length;
}
export function evaluate(input?: unknown) {
  const r = input === undefined ? undefined : runSchema.parse(input);
  return {
    labelRecall: recall(r?.expectedLabels, r?.observedLabels),
    relationshipPrecision: recall(r?.observedRelations, r?.expectedRelations),
    relationshipRecall: recall(r?.expectedRelations, r?.observedRelations),
    flowAccuracy:
      !r?.expectedFlow?.length || !r.observedFlow
        ? null
        : r.expectedFlow.filter((s, i) => r.observedFlow![i] === s).length /
          Math.max(r.expectedFlow.length, r.observedFlow.length),
    groundingRate: ratio(r?.groundedCount, r?.proposedCount),
    teacherCorrectionRate: ratio(r?.correctedCount, r?.proposedCount),
    processingMs: r?.processingMs ?? null,
    captionWordErrorRate: wordErrorRate(r?.referenceTranscript, r?.transcript),
    technicalTermAccuracy:
      !r?.expectedTerms?.length || r.transcript === undefined
        ? null
        : r.expectedTerms.filter((t) =>
            ` ${normalize(r.transcript!)} `.includes(` ${normalize(t)} `),
          ).length / r.expectedTerms.length,
    timeToPhraseMs:
      r?.phraseStartedAt === undefined || r.phraseSentAt === undefined
        ? null
        : r.phraseSentAt - r.phraseStartedAt,
  };
}
const summaryValue = z.number().nullable();
export const summarySchema = z
  .object({
    runs: z.number().int().nonnegative(),
    source: z.literal("actual_run"),
    labelRecall: summaryValue,
    relationPrecision: summaryValue,
    relationRecall: summaryValue,
    flowAccuracy: summaryValue,
    groundingRate: summaryValue,
    teacherCorrectionRate: summaryValue,
    processingMs: summaryValue,
    captionWordErrorRate: summaryValue,
    technicalTermAccuracy: summaryValue,
    timeToPhraseMs: summaryValue,
  })
  .strict();
export type Summary = z.infer<typeof summarySchema>;
