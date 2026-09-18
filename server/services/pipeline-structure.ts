import {
  diagramStructureSchema,
  type DiagramLabel,
  type DiagramStructure,
  emptyStructure,
} from "../../shared/model";
import type { DiagramProposal, OcrLabel } from "../../shared/proposal";

/**
 * Pure conversion: model proposal + OCR labels -> domain DiagramStructure.
 *
 * The model's own part ids are never trusted — parts are remapped to local
 * ids derived from the referenced OCR label. Every part must cite an OCR
 * label that EXISTS (grounding), every relationship must cite the endpoints'
 * labels as evidence, and flow steps must resolve to known parts. The
 * deterministic validator (validation.ts) re-checks everything afterwards.
 */

export interface ProposalConversion {
  structure: DiagramStructure;
  issues: Array<{ code: string; severity: "error" | "warning"; itemId: string; message: string }>;
  /** true when conversion produced at least one grounded part. */
  ok: boolean;
}

export function proposalToStructure(
  proposal: DiagramProposal,
  labels: OcrLabel[],
  existingStructure?: DiagramStructure,
): ProposalConversion {
  const issues: ProposalConversion["issues"] = [];
  const labelById = new Map(labels.map((l) => [l.labelId, l]));
  const normalize = (s: string) =>
    s.normalize("NFKC").toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

  // Only labels not already present/used in the existing structure are
  // candidates; this keeps re-runs from duplicating labels or parts.
  const usedLabelIds = new Set((existingStructure?.parts ?? []).map((p) => p.labelId));
  const presentLabelIds = new Set((existingStructure?.labels ?? []).map((l) => l.labelId));
  const candidates = labels.filter((l) => !usedLabelIds.has(l.labelId) && !presentLabelIds.has(l.labelId));

  const partByModelId = new Map<string, string | null>();
  const structure: DiagramStructure = {
    labels: [...(existingStructure?.labels ?? []), ...candidates.map(toDomainLabel)],
    parts: [...(existingStructure?.parts ?? [])],
    relations: [...(existingStructure?.relations ?? [])],
    flows: [...(existingStructure?.flows ?? [])],
  };

  // ---- Parts: strict grounding (every part needs an EXISTING label id) ----
  for (const p of proposal.parts) {
    const label = labelById.get(p.ocrLabelId);
    if (!label) {
      issues.push({
        code: "unknown_label",
        severity: "error",
        itemId: p.id,
        message: `Proposed part references unknown OCR label "${p.ocrLabelId}". The model may not invent labels.`,
      });
      partByModelId.set(p.id, null);
      continue;
    }
    if (usedLabelIds.has(p.ocrLabelId)) {
      issues.push({
        code: "duplicate_label_reference",
        severity: "warning",
        itemId: p.id,
        message: `Label "${p.ocrLabelId}" is already used by an existing part; duplicate proposal dropped.`,
      });
      partByModelId.set(p.id, null);
      continue;
    }
    // The part name must be the OCR text; drift is caught by the validator
    // (warning), but we never adopt model-invented wording as the name.
    if (normalize(p.name) !== normalize(label.text)) {
      issues.push({
        code: "name_drift",
        severity: "warning",
        itemId: p.id,
        message: `Proposed name "${p.name}" differs from OCR text "${label.text}"; OCR text is authoritative.`,
      });
    }
    const partId = `part-${p.ocrLabelId}`;
    partByModelId.set(p.id, partId);
    usedLabelIds.add(p.ocrLabelId);
    structure.parts.push({
      partId,
      labelId: p.ocrLabelId,
      name: label.text,
      description: p.description,
      descriptionShort: p.descriptionShort,
      descriptionDetailed: p.descriptionDetailed,
      state: "ai_proposed",
      reviewNote: "",
    });
  }

  // ---- Relationships: endpoints + evidence must resolve to known parts ----
  const partLabel = new Map(structure.parts.map((p) => [p.partId, p.labelId]));
  for (const r of proposal.relationships) {
    const fromId = partByModelId.get(r.sourcePartId);
    const toId = partByModelId.get(r.targetPartId);
    if (!fromId || !toId) {
      issues.push({
        code: "dangling_reference",
        severity: "error",
        itemId: `${r.sourcePartId}->${r.targetPartId}`,
        message: `Relationship references a part that was not grounded ("${r.sourcePartId}" -> "${r.targetPartId}").`,
      });
      continue;
    }
    if (fromId === toId) {
      issues.push({
        code: "self_relation",
        severity: "error",
        itemId: fromId,
        message: "A relationship cannot point to itself.",
      });
      continue;
    }
    const evidence = [...new Set(r.evidence)];
    const fromLabel = partLabel.get(fromId);
    const toLabel = partLabel.get(toId);
    if (!fromLabel || !toLabel || !evidence.includes(fromLabel) || !evidence.includes(toLabel)) {
      issues.push({
        code: "incomplete_evidence",
        severity: "error",
        itemId: `${fromId}->${toId}`,
        message: "Relationship evidence must include the OCR labels of both endpoints.",
      });
      continue;
    }
    structure.relations.push({
      relationId: `relation-${fromId.slice("part-".length)}-${toId.slice("part-".length)}`,
      fromPartId: fromId,
      toPartId: toId,
      kind: r.relationType,
      evidenceLabelIds: evidence,
      state: "ai_proposed",
      reviewNote: "",
    });
  }

  // ---- Process flow: ordered, deduplicated, resolvable steps ----
  const ordered = [...proposal.processFlow].sort((a, b) => a.order - b.order);
  const seenSteps = new Set<string>();
  const stepPartIds: string[] = [];
  for (const step of ordered) {
    const partId = partByModelId.get(step.partId);
    if (!partId) {
      issues.push({
        code: "broken_step",
        severity: "error",
        itemId: step.partId,
        message: `Flow step references an ungrounded part ("${step.partId}").`,
      });
      continue;
    }
    if (seenSteps.has(partId)) {
      issues.push({
        code: "duplicate_step",
        severity: "error",
        itemId: partId,
        message: "A part appears more than once in the process flow.",
      });
      continue;
    }
    seenSteps.add(partId);
    stepPartIds.push(partId);
  }
  if (stepPartIds.length >= 2) {
    structure.flows.push({
      flowId: "flow-1",
      name: "Proposed reading sequence",
      stepPartIds,
      state: "ai_proposed",
      reviewNote: "",
    });
  }

  const parsed = diagramStructureSchema.safeParse(structure);
  if (!parsed.success) {
    issues.push({
      code: "conversion_schema",
      severity: "error",
      itemId: "proposal",
      message: `Converted structure failed schema: ${parsed.error.issues[0]?.message ?? "unknown"}`,
    });
    return { structure: existingStructure ?? emptyStructure, issues, ok: false };
  }

  return { structure: parsed.data, issues, ok: structure.parts.length > 0 };
}

function toDomainLabel(l: OcrLabel): DiagramLabel {
  return {
    labelId: l.labelId,
    text: l.text,
    confidence: l.confidence,
    source: "textract" as const,
    x: l.x,
    y: l.y,
  };
}
