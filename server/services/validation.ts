import {
  type DiagramStructure,
  type DiagramPart,
  type Relationship,
  type ProcessFlow,
  type DiagramLabel,
} from "../../shared/model";

/** Deterministic validation issue. */
export interface Issue {
  itemId: string;
  code: string;
  severity: "error" | "warning";
  message: string;
}

const normalize = (s: string) =>
  s.normalize("NFKC").toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const active = <T extends { state: string }>(xs: T[]) => xs.filter((x) => x.state !== "rejected");

/**
 * Deterministic validator (pure; no I/O). The AI path may produce garbage;
 * nothing reaches teacher approval or publication unless this passes.
 * Mirrors the semantics of shared/domain.ts for the new model types.
 */
export function validateStructure(structure: DiagramStructure): Issue[] {
  const issues: Issue[] = [];
  const add = (itemId: string, code: string, severity: "error" | "warning", message: string) =>
    issues.push({ itemId, code, severity, message });

  const labels = new Map<string, DiagramLabel>(structure.labels.map((l) => [l.labelId, l]));
  const parts = new Map<string, DiagramPart>(active(structure.parts).map((p) => [p.partId, p]));
  const activeRelations = active(structure.relations);

  const seen = new Set<string>();
  const all: Array<Record<string, unknown>> = [
    ...structure.labels,
    ...active(structure.parts),
    ...activeRelations,
    ...active(structure.flows),
  ];
  for (const item of all) {
    // NOTE: parts carry both partId and labelId, so check the MOST SPECIFIC
    // key first (partId, relationId, flowId) before labelId.
    const id: string =
      typeof item.partId === "string"
        ? item.partId
        : typeof item.relationId === "string"
          ? item.relationId
          : typeof item.flowId === "string"
            ? item.flowId
            : (item.labelId as string);
    if (seen.has(id)) add(id, "duplicate_id", "error", "Every label and content item needs a unique ID.");
    seen.add(id);
  }

  for (const p of parts.values()) {
    const label = labels.get(p.labelId);
    if (!label) add(p.partId, "unknown_label", "error", "Part is not grounded in an existing source label.");
    else {
      if (normalize(p.name) !== normalize(label.text))
        add(p.partId, "name_drift", "warning", "Part name differs from the source label. Verify the wording.");
      if (label.confidence !== null && label.confidence < 85)
        add(p.partId, "low_ocr", "warning", "Source label confidence is below 85%. Check the original.");
      if (label.source === "teacher_entered")
        add(p.partId, "manual_source", "warning", "Teacher-entered label: verify its location against the original.");
    }
    if (parts.size > 1 && !activeRelations.some((r) => r.fromPartId === p.partId || r.toPartId === p.partId))
      add(p.partId, "orphan", "warning", "No relationship connects this part yet.");
  }

  for (const r of activeRelations) {
    if (!parts.has(r.fromPartId) || !parts.has(r.toPartId))
      add(r.relationId, "dangling", "error", "Both ends must reference parts that are not rejected.");
    if (r.fromPartId === r.toPartId)
      add(r.relationId, "self_relation", "error", "A relationship cannot point to itself.");
    if (!r.evidenceLabelIds.length)
      add(r.relationId, "missing_evidence", "error", "Attach source labels supporting this relationship.");
    else {
      if (r.evidenceLabelIds.some((e) => !labels.has(e)))
        add(r.relationId, "unknown_evidence", "error", "Evidence refers to a source label that does not exist.");
      const ends = [parts.get(r.fromPartId)?.labelId, parts.get(r.toPartId)?.labelId];
      if (ends.some((e) => e && !r.evidenceLabelIds.includes(e)))
        add(r.relationId, "incomplete_evidence", "error", "Evidence must include the source label of each endpoint.");
    }
    if (activeRelations.some((o) => o.relationId !== r.relationId && o.kind === r.kind &&
      ((o.fromPartId === r.fromPartId && o.toPartId === r.toPartId) ||
        (r.kind === "connects_to" && o.toPartId === r.fromPartId && o.fromPartId === r.toPartId))))
      add(r.relationId, "duplicate_relation", "error", "A duplicate relationship exists. Reject or remove one.");
    if (r.kind === "flows_to" && activeRelations.some((o) => o.relationId !== r.relationId && o.kind === r.kind &&
      o.fromPartId === r.toPartId && o.toPartId === r.fromPartId))
      add(r.relationId, "direction_conflict", "warning", "Flow is proposed in both directions. Verify whether this is intended.");
  }

  for (const f of active(structure.flows) as ProcessFlow[]) {
    if (new Set(f.stepPartIds).size !== f.stepPartIds.length)
      add(f.flowId, "duplicate_step", "error", "Use each part once in a reading sequence.");
    for (const [index, step] of f.stepPartIds.entries()) {
      if (!parts.has(step))
        add(f.flowId, "broken_step", "error", "A flow step references a missing or rejected part.");
      if (index > 0 && !activeRelations.some((r) => r.fromPartId === f.stepPartIds[index - 1] && r.toPartId === step))
        add(f.flowId, "broken_flow", "error", "Every consecutive flow step needs a forward relationship.");
    }
  }
  return issues;
}

/** Items needing teacher attention: any error blocks approval. */
export function blockingIssues(issues: Issue[]): Issue[] {
  return issues.filter((i) => i.severity === "error");
}
