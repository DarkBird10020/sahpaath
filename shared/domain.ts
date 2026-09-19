import {
  mapSchema,
  publishedSchema,
  type DiagramMap,
  type Explorer,
  type ExplorerPart,
  type Issue,
  type Lesson,
  type Published,
} from "./schema";

/** Rule 14: the only legal trust-state transitions. "published" is a lesson
 * status, never an item state; nothing may transition into it. */
export const trustTransitions: Record<string, readonly string[]> = {
  // "ai_proposed" resets after any state: validation re-runs and map edits
  // restore every item to a fresh proposal.
  ai_proposed: ["needs_review", "validated", "teacher_approved", "rejected"],
  needs_review: ["ai_proposed", "validated", "teacher_approved", "rejected"],
  validated: ["ai_proposed", "needs_review", "teacher_approved", "rejected"],
  teacher_approved: ["ai_proposed", "needs_review", "rejected"],
  rejected: ["ai_proposed", "needs_review", "teacher_approved"],
};
export function assertTrustTransition(from: string, to: string) {
  // Setting an item to its current state is an idempotent no-op, not a
  // transition; re-running revalidate/decide on unchanged state must pass.
  if (from === to) return;
  if (!trustTransitions[from]?.includes(to))
    throw new Error(`Invalid trust-state transition ${from} → ${to}.`);
}

/** Deterministic grounding check for a single map item: every claim traces
 * back to a real source label / part. Parts ground in their OCR label,
 * relations in non-empty evidence labels, flows in existing parts. */
export function itemGrounded(map: DiagramMap, itemId: string): boolean {
  const part = map.parts.find((p) => p.id === itemId);
  if (part) return map.labels.some((l) => l.id === part.labelId);
  const relation = map.relations.find((r) => r.id === itemId);
  if (relation)
    return (
      relation.evidence.length > 0 &&
      relation.evidence.every((e) => map.labels.some((l) => l.id === e))
    );
  const flow = map.flows.find((f) => f.id === itemId);
  if (flow) return flow.steps.every((s) => map.parts.some((p) => p.id === s));
  return false;
}

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

/** True when the text is a bare callout number, optionally with decoration
 * such as a trailing dot or bracket ("7.", "(12)", "23"). */
export const isCalloutNumber = (text: string) => /^[^\p{L}\p{N}]*\d{1,4}[^\p{L}\p{N}]*$/u.test(text.trim());

/** The callout number a part sits on, or null when its label is words. */
export function calloutOf(map: Pick<DiagramMap, "labels">, part: { labelId: string }): number | null {
  const label = map.labels.find((l) => l.id === part.labelId);
  return label && isCalloutNumber(label.text) ? Number(label.text.replace(/\D+/g, "")) : null;
}

/**
 * Numbers a numbered diagram skips in its parts: every whole number from 1 to
 * the highest callout that no active part carries. A teacher reviewing "1 to
 * last" must be told that 5 is absent, not left to notice 4 is followed by 6.
 */
export function missingCallouts(map: Pick<DiagramMap, "labels" | "parts">): number[] {
  const numbers = map.parts
    .filter((p) => p.state !== "rejected")
    .map((p) => calloutOf(map, p))
    .filter((n): n is number => n !== null);
  if (numbers.length < 3) return [];
  const have = new Set(numbers);
  return Array.from({ length: Math.max(...numbers) }, (_, i) => i + 1).filter((n) => !have.has(n));
}

/**
 * The number a reader sees for a part: the diagram's own callout number when it
 * has one, otherwise its position. Counting positions on a numbered diagram
 * would shift every number after a callout the OCR missed, so "7" on screen
 * would no longer be 7 on the page.
 */
export function partNumber(map: Pick<DiagramMap, "labels">, part: { labelId: string }, index: number): number {
  return calloutOf(map, part) ?? index + 1;
}

/**
 * The sequence a lesson is meant to be explained in, as part ids.
 *
 * Numbered-callout diagrams ("1"–"23" scattered over the image) must be
 * explained in callout order, not in whatever order the model happened to
 * emit parts. Numbered labels win; then the teacher/model reading flow; then
 * plain geometric reading order (top-to-bottom rows, left-to-right), so even
 * an unnumbered map has a stable, human order instead of a random one.
 * Parts not present in the chosen sequence keep their relative order behind it.
 */
export function sequencePartIds(map: DiagramMap): string[] {
  const rank = new Map(map.labels.map((l) => [l.id, l]));
  const numeric = map.parts
    .map((p) => {
      const label = rank.get(p.labelId);
      return { p, n: label && isCalloutNumber(label.text) ? Number(label.text.replace(/\D+/g, "")) : null };
    })
    .filter((x): x is { p: DiagramMap["parts"][number]; n: number } => x.n !== null);
  // A callout set only reads as numbering when a clear majority of parts carry
  // one; otherwise "1" and "2" could be stray digits and reorder everything.
  let callout: string[] | null = null;
  if (map.parts.length >= 2 && numeric.length * 2 > map.parts.length) {
    const byNumber = new Map<number, string>();
    for (const { p, n } of numeric) if (!byNumber.has(n)) byNumber.set(n, p.id);
    callout = [...byNumber.entries()].sort((a, b) => a[0] - b[0]).map(([, id]) => id);
  }
  const rest = map.parts.map((p) => p.id).filter((id) => !callout?.includes(id));
  const flow = map.flows.find((f) => f.state !== "rejected");
  const flowSteps = (flow?.steps ?? []).filter((s) => rest.includes(s));
  const flowRest = rest.filter((id) => !flowSteps.includes(id));
  // Geometric fallback: row bands of ~7% image height, then left→right.
  const geo = [...flowRest].sort((a, b) => {
    const pa = map.parts.find((p) => p.id === a)!;
    const pb = map.parts.find((p) => p.id === b)!;
    const la = rank.get(pa.labelId);
    const lb = rank.get(pb.labelId);
    const row = (l: typeof la) => (l ? Math.floor(l.y / 0.07) : Number.MAX_SAFE_INTEGER);
    return row(la) - row(lb) || (la?.x ?? 1) - (lb?.x ?? 1);
  });
  return [...(callout ?? []), ...flowSteps, ...geo];
}

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
    if (p.evidence && (!p.evidence.includes(p.labelId) || p.evidence.some((e) => !labels.has(e))))
      add(p.id, "invalid_part_evidence", "error", "Part evidence must include its source label and reference only existing labels.");
    const label = labels.get(p.labelId);
    if (!label)
      add(
        p.id,
        "unknown_label",
        "error",
        "This part is not grounded in an existing source label.",
      );
    else {
      if (isCalloutNumber(label.text)) {
        // A numbered callout carries no name on the image, so the name is the
        // AI's identification of what the number points to. Say exactly that.
        const n = label.text.replace(/\D+/g, "");
        if (isCalloutNumber(p.name))
          add(p.id, "callout_unnamed", "warning", `Callout ${n} has no name yet. Add the structure it points to.`);
        else
          add(
            p.id,
            "callout_named_by_ai",
            "warning",
            `The diagram shows only the number ${n}. “${p.name}” was identified by the AI, not read from the image: check it against your key.`,
          );
      } else if (normalize(p.name) !== normalize(label.text))
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
      assertTrustTransition(item.state, "ai_proposed");
      item.state = "ai_proposed";
      item.reviewNote = "";
    }
  const issues = validateMap(map);
  for (const item of items(map))
    if (!["teacher_approved", "rejected"].includes(item.state)) {
      const next = issues.some((i) => i.itemId === item.id)
        ? "needs_review"
        : "validated";
      assertTrustTransition(item.state, next);
      item.state = next;
    }
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
  // Relations and flows carry "from" or "steps"; parts carry neither.
  const isPart = !("from" in item) && !("steps" in item);
  if (decision === "approve") {
    // Evaluate rejected items as active before approving: rejection must not bypass validation.
    assertTrustTransition(item.state, "ai_proposed");
    item.state = "ai_proposed";
    const issues = validateMap(map).filter((i) => i.itemId === itemId);
    if (issues.some((i) => i.severity === "error"))
      throw new Error("Fix structural errors before approving this item.");
    if (issues.length && !note.trim())
      throw new Error(
        "Add a review note explaining how you checked the flagged item.",
      );
    assertTrustTransition(item.state, "teacher_approved");
    item.state = "teacher_approved";
  } else {
    if (item.state !== "rejected") assertTrustTransition(item.state, "rejected");
    item.state = "rejected";
  }
  item.reviewNote = note;
  // A rejection can invalidate a previously approved dependency.
  const invalid = new Set(
    validateMap(map)
      .filter((i) => i.severity === "error")
      .map((i) => i.itemId),
  );
  for (const other of items(map))
    if (other.state === "teacher_approved" && invalid.has(other.id)) {
      assertTrustTransition(other.state, "needs_review");
      other.state = "needs_review";
      other.reviewNote = "";
    }
  // A rejected part must not strand its dependent relationships and flows as
  // unfixable errors: "dangling" / "broken_step" blocks approving the dependant
  // itself, so a teacher could otherwise never finish reviewing the map after
  // rejecting one concept. Cascade-reject active dependants (and note the
  // reason), mirroring the invalidate-approved cascade above. Approving the
  // part again later is always possible via the rejected → ai_proposed path.
  // Only a rejection cascades. Approving a part must never touch its relations:
  // that silently rejected everything a teacher approved and left the lesson
  // unpublishable.
  if (decision === "reject" && isPart) {
    const dependentIds = new Set([
      ...map.relations
        .filter(
          (r) =>
            r.state !== "rejected" && (r.from === itemId || r.to === itemId),
        )
        .map((r) => r.id),
      ...map.flows
        .filter(
          (f) => f.state !== "rejected" && f.steps.includes(itemId),
        )
        .map((f) => f.id),
    ]);
    const rejectedPart = map.parts.find((p) => p.id === itemId);
    for (const other of items(map))
      if (dependentIds.has(other.id)) {
        assertTrustTransition(other.state, "rejected");
        other.state = "rejected";
        other.reviewNote =
          other.reviewNote ||
          `Auto-rejected: it references “${rejectedPart?.name ?? itemId}”, which was rejected.`;
      }
  }
  return revalidate(map);
}

export function publishSnapshot(lesson: Lesson, now: string): Published {
  if (lesson.status === "published")
    throw new Error(
      "This version has already been published. Create a new version to edit.",
    );
  if (!lesson.license || !lesson.license.licenseName.trim())
    throw new Error(
      "A diagram cannot be published without source and license information.",
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
  // Keep every label an approved part still cites — its primary labelId AND
  // any extra evidence labels. Filtering on labelId alone dropped evidence
  // labels, leaving published parts with invalid evidence that failed
  // studentSerialize's structural re-check right after a successful publish.
  const labelIds = new Set(parts.flatMap((p) => [p.labelId, ...(p.evidence ?? [])]));
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
    license: lesson.license,
    map,
    vocabulary: parts.map((p) => ({
      id: p.id,
      name: p.name,
      definition: p.description,
      labelId: p.labelId,
      aliases: p.aliases,
      approvedAt: now,
      approvedBy: "local-teacher",
      state: "teacher_approved" as const,
    })),
  });
}

export function studentSerialize(input: Published): Published {
  const value = publishedSchema.parse(input);
  if (items(value.map).some((i) => i.state !== "teacher_approved"))
    throw new Error("Published content contains an unapproved item.");
  if (validateMap(value.map).some((i) => i.severity === "error"))
    throw new Error("Published content failed structural validation.");
  const vocabulary = value.map.parts.map((p) => {
    const term = value.vocabulary.find((t) => t.id === p.id);
    return {
      id: p.id,
      name: p.name,
      definition: p.description,
      labelId: p.labelId,
      aliases: term?.aliases ?? [],
      approvedAt: term?.approvedAt ?? "",
      approvedBy: term?.approvedBy ?? "local-teacher",
      state: "teacher_approved" as const,
    };
  });
  return { ...value, vocabulary };
}

/** Screen-reader-first explorer view built ONLY from published, approved
 * content. Audio is browser speech by default; cached Polly audio is attached
 * per part when it exists and is never a hard dependency for the explorer. */
export function buildExplorer(
  input: Published,
  audio?: { cachedUrl: (partId: string) => string | null },
): Explorer {
  const value = studentSerialize(input);
  const parts = value.map.parts;
  const byId = new Map(parts.map((p) => [p.id, p]));
  const relations = value.map.relations.filter(
    (r) => byId.has(r.from) && byId.has(r.to),
  );
  const flow = value.map.flows[0] ?? null;
  const nodes: ExplorerPart[] = parts.map((p) => {
    const connected = relations
      .filter((r) => r.from === p.id || r.to === p.id)
      .map((r) => {
        const outgoing = r.from === p.id;
        const other = byId.get(outgoing ? r.to : r.from)!;
        return {
          partId: other.id,
          name: other.name,
          relationship: r.kind,
          direction: outgoing ? ("outgoing" as const) : ("incoming" as const),
          explanation: r.descriptions?.short ?? null,
        };
      });
    const index = flow ? flow.steps.indexOf(p.id) : -1;
    const audioUrl = audio?.cachedUrl(p.id) ?? null;
    return {
      partId: p.id,
      name: p.name,
      shortDescription: (p.descriptions?.short ?? p.description).slice(0, 280),
      // The three-level proposals keep a full paragraph for learners who
      // cannot see the image; plain descriptions simply repeat.
      detailedDescription: p.descriptions?.detailed ?? p.description,
      vocabularyTermId: p.id,
      connectedParts: connected,
      flow:
        flow && index >= 0
          ? {
              flowId: flow.id,
              name: flow.name,
              position: index + 1,
              total: flow.steps.length,
              previous: index > 0 ? flow.steps[index - 1] : null,
              next: index < flow.steps.length - 1 ? flow.steps[index + 1] : null,
            }
          : null,
      // Audio is never a hard dependency: the explorer is complete as text.
      audio: audioUrl ? { url: audioUrl, engine: "polly" as const, cached: true } : null,
    };
  });
  return {
    lessonId: value.lessonId,
    version: value.version,
    title: value.title,
    // The diagram's own sequence: numbered callouts, then flow, then geometry.
    readingOrder: sequencePartIds(value.map),
    parts: nodes,
    audioEngine: nodes.some((n) => n.audio) ? "polly" : "browser_speech",
  };
}
