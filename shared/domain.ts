import {
  mapSchema,
  publishedSchema,
  type DiagramMap,
  type Issue,
  type Lesson,
  type Published,
} from "./schema";

export const normalize = (s: string) =>
  s
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
export const items = (map: DiagramMap) => [
  ...map.parts,
  ...map.relations,
  ...map.flows,
];

export function validateMap(input: DiagramMap): Issue[] {
  const map = mapSchema.parse(input);
  const issues: Issue[] = [];
  const add = (
    itemId: string,
    code: string,
    severity: "error" | "warning",
    message: string,
  ) => issues.push({ itemId, code, severity, message });
  const labels = new Map(map.labels.map((l) => [l.id, l]));
  const parts = new Map(
    map.parts.filter((p) => p.state !== "rejected").map((p) => [p.id, p]),
  );
  const allIds = new Set<string>();
  for (const item of [...map.labels, ...items(map)]) {
    if (allIds.has(item.id))
      add(
        item.id,
        "duplicate_id",
        "error",
        "Every label and content item needs a unique ID.",
      );
    allIds.add(item.id);
  }
  const activeRelations = map.relations.filter((r) => r.state !== "rejected");
  for (const p of parts.values()) {
    const label = labels.get(p.labelId);
    if (!label)
      add(
        p.id,
        "unknown_label",
        "error",
        "This part is not grounded in an existing source label.",
      );
    else {
      if (normalize(p.name) !== normalize(label.text))
        add(
          p.id,
          "name_drift",
          "warning",
          "Part name differs from the source label. Verify the wording.",
        );
      if (label.confidence !== null && label.confidence < 85)
        add(
          p.id,
          "low_ocr",
          "warning",
          "Source label confidence is below 85%. Check the original.",
        );
      if (label.source === "teacher_entered")
        add(
          p.id,
          "manual_source",
          "warning",
          "Teacher-entered label: verify its location against the original.",
        );
    }
    if (
      parts.size > 1 &&
      !activeRelations.some((r) => r.from === p.id || r.to === p.id)
    )
      add(p.id, "orphan", "warning", "No relationship connects this part yet.");
  }
  for (const r of activeRelations) {
    if (!parts.has(r.from) || !parts.has(r.to))
      add(
        r.id,
        "dangling",
        "error",
        "Both ends must reference parts that are not rejected.",
      );
    if (r.from === r.to)
      add(
        r.id,
        "self_relation",
        "error",
        "A relationship cannot point to itself.",
      );
    if (!r.evidence.length)
      add(
        r.id,
        "missing_evidence",
        "error",
        "Attach source labels supporting this relationship.",
      );
    else {
      if (r.evidence.some((e) => !labels.has(e)))
        add(
          r.id,
          "unknown_evidence",
          "error",
          "Evidence refers to a source label that does not exist.",
        );
      const ends = [parts.get(r.from)?.labelId, parts.get(r.to)?.labelId];
      if (ends.some((e) => e && !r.evidence.includes(e)))
        add(
          r.id,
          "incomplete_evidence",
          "error",
          "Evidence must include the source label of each endpoint.",
        );
    }
    if (
      activeRelations.some(
        (o) =>
          o.id !== r.id &&
          o.kind === r.kind &&
          ((o.from === r.from && o.to === r.to) ||
            (r.kind === "connects_to" && o.to === r.from && o.from === r.to)),
      )
    )
      add(
        r.id,
        "duplicate_relation",
        "error",
        "A duplicate relationship exists. Reject or remove one.",
      );
    if (
      r.kind === "flows_to" &&
      activeRelations.some(
        (o) =>
          o.id !== r.id &&
          o.kind === r.kind &&
          o.from === r.to &&
          o.to === r.from,
      )
    )
      add(
        r.id,
        "direction_conflict",
        "warning",
        "Flow is proposed in both directions. Verify whether this is intended.",
      );
  }
  for (const f of map.flows.filter((f) => f.state !== "rejected")) {
    if (new Set(f.steps).size !== f.steps.length)
      add(
        f.id,
        "duplicate_step",
        "error",
        "Use each part once in a reading sequence.",
      );
    for (const [index, step] of f.steps.entries()) {
      if (!parts.has(step))
        add(
          f.id,
          "broken_step",
          "error",
          "A flow step references a missing or rejected part.",
        );
      if (
        index > 0 &&
        !activeRelations.some(
          (r) => r.from === f.steps[index - 1] && r.to === step,
        )
      )
        add(
          f.id,
          "broken_flow",
          "error",
          "Every consecutive flow step needs a forward relationship.",
        );
    }
  }
  return issues;
}

export function revalidate(
  input: DiagramMap,
  resetDecisions = false,
): DiagramMap {
  const map = structuredClone(input);
  if (resetDecisions)
    for (const item of items(map)) {
      item.state = "ai_proposed";
      item.reviewNote = "";
    }
  const issues = validateMap(map);
  for (const item of items(map))
    if (!["teacher_approved", "rejected"].includes(item.state))
      item.state = issues.some((i) => i.itemId === item.id)
        ? "needs_review"
        : "validated";
  return map;
}

export function decide(
  input: DiagramMap,
  itemId: string,
  decision: "approve" | "reject",
  note: string,
): DiagramMap {
  const map = structuredClone(input);
  const item = items(map).find((i) => i.id === itemId);
  if (!item) throw new Error("Content item not found.");
  if (decision === "approve") {
    // Evaluate rejected items as active before approving: rejection must not bypass validation.
    item.state = "ai_proposed";
    const issues = validateMap(map).filter((i) => i.itemId === itemId);
    if (issues.some((i) => i.severity === "error"))
      throw new Error("Fix structural errors before approving this item.");
    if (issues.length && !note.trim())
      throw new Error(
        "Add a review note explaining how you checked the flagged item.",
      );
    item.state = "teacher_approved";
  } else item.state = "rejected";
  item.reviewNote = note;
  // A rejection can invalidate a previously approved dependency.
  const invalid = new Set(
    validateMap(map)
      .filter((i) => i.severity === "error")
      .map((i) => i.itemId),
  );
  for (const other of items(map))
    if (other.state === "teacher_approved" && invalid.has(other.id)) {
      other.state = "needs_review";
      other.reviewNote = "";
    }
  return revalidate(map);
}

export function publishSnapshot(lesson: Lesson, now: string): Published {
  if (lesson.status === "published")
    throw new Error(
      "This version has already been published. Create a new version to edit.",
    );
  if (!lesson.map.parts.some((p) => p.state === "teacher_approved"))
    throw new Error("Approve at least one part before publishing.");
  if (
    items(lesson.map).some(
      (i) => !["teacher_approved", "rejected"].includes(i.state),
    )
  )
    throw new Error(
      "Every content item needs an explicit approval or rejection.",
    );
  if (validateMap(lesson.map).some((i) => i.severity === "error"))
    throw new Error("Resolve structural errors before publishing.");
  const approved = <T extends { state: string }>(xs: T[]) =>
    xs.filter((x) => x.state === "teacher_approved");
  const parts = approved(lesson.map.parts);
  const labelIds = new Set(parts.map((p) => p.labelId));
  const map = {
    labels: lesson.map.labels.filter((l) => labelIds.has(l.id)),
    parts,
    relations: approved(lesson.map.relations),
    flows: approved(lesson.map.flows),
  };
  return publishedSchema.parse({
    lessonId: lesson.id,
    title: lesson.title,
    subject: lesson.subject,
    version: lesson.version,
    publishedAt: now,
    image: lesson.image,
    map,
    vocabulary: parts.map((p) => ({
      id: p.id,
      name: p.name,
      definition: p.description,
      labelId: p.labelId,
      state: "teacher_approved",
    })),
  });
}

export function studentSerialize(input: Published): Published {
  const value = publishedSchema.parse(input);
  if (items(value.map).some((i) => i.state !== "teacher_approved"))
    throw new Error("Published content contains an unapproved item.");
  if (validateMap(value.map).some((i) => i.severity === "error"))
    throw new Error("Published content failed structural validation.");
  const vocabulary = value.map.parts.map((p) => ({
    id: p.id,
    name: p.name,
    definition: p.description,
    labelId: p.labelId,
    state: "teacher_approved" as const,
  }));
  return { ...value, vocabulary };
}
