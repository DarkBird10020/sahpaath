import { describe, it, expect, afterEach } from "vitest";
import { fixtureMap, fixtures } from "../shared/fixtures";
import {
  assertTrustTransition,
  decide,
  itemGrounded,
  items,
  revalidate,
  publishSnapshot,
  studentSerialize,
  validateMap,
} from "../shared/domain";
import {
  createLesson,
  DemoAnalysisProvider,
  imageType,
} from "../server/providers";
import { Store } from "../server/store";
import { mapSchema, type DiagramMap } from "../shared/schema";

function approveAll(map: DiagramMap) {
  for (const item of items(map))
    map = decide(
      map,
      item.id,
      "approve",
      "Checked against the source diagram.",
    );
  return map;
}
describe("Deterministic trust boundaries", () => {
  it.each(fixtures)(
    "validates the corrected $id fixture without structural errors",
    (f) => {
      expect(validateMap(fixtureMap(f.id, false))).toEqual([]);
    },
  );
  it("flags the deliberate missing evidence and blocks approval", () => {
    const m = fixtureMap("heart");
    expect(validateMap(m).some((i) => i.code === "missing_evidence")).toBe(
      true,
    );
    expect(() => decide(m, "relation-1", "approve", "Looks right")).toThrow(
      "structural",
    );
  });
  it("blocks unknown label ids", () => {
    const m = fixtureMap("heart", false);
    m.parts[0].labelId = "invented";
    expect(validateMap(m).some((i) => i.code === "unknown_label")).toBe(true);
    expect(() => decide(m, m.parts[0].id, "approve", "Reviewed")).toThrow();
  });
  it("flags dangling, self, duplicate and contradictory relationships", () => {
    const m = fixtureMap("heart", false);
    m.relations.push(
      { ...m.relations[0], id: "duplicate" },
      { ...m.relations[0], id: "reverse", from: "part-1", to: "part-0" },
      { ...m.relations[0], id: "self", to: "part-0" },
      { ...m.relations[0], id: "dangling", to: "unknown" },
    );
    const codes = validateMap(m).map((i) => i.code);
    for (const code of [
      "dangling",
      "self_relation",
      "duplicate_relation",
      "direction_conflict",
    ])
      expect(codes).toContain(code);
  });
  it("flags OCR confidence, drift, orphan and broken flows", () => {
    const m = fixtureMap("heart", false);
    m.labels[0].confidence = 40;
    m.parts[0].name = "Different";
    m.parts.push({ ...m.parts[0], id: "orphan" });
    m.flows[0].steps = ["part-0", "part-4", "unknown"];
    const codes = validateMap(m).map((i) => i.code);
    for (const code of [
      "low_ocr",
      "name_drift",
      "orphan",
      "broken_flow",
      "broken_step",
    ])
      expect(codes).toContain(code);
  });
  it("requires explicit review notes for warnings", () => {
    const m = fixtureMap("pump", false);
    m.labels[0].source = "teacher_entered";
    expect(() => decide(m, "part-0", "approve", "")).toThrow("review note");
    expect(
      decide(m, "part-0", "approve", "Verified label on image").parts[0].state,
    ).toBe("teacher_approved");
  });
  it("does not allow a rejected invalid item to be approved without revalidation", () => {
    let m = fixtureMap("heart");
    m = decide(m, "relation-1", "reject", "No evidence");
    expect(() => decide(m, "relation-1", "approve", "Override")).toThrow(
      "structural",
    );
  });
  it("invalidates approved dependencies when a part is rejected", () => {
    const m = decide(
      approveAll(fixtureMap("heart", false)),
      "part-1",
      "reject",
      "Removed",
    );
    // Dependent relation/flow are cascade-rejected so the map stays finishable.
    expect(m.relations[0].state).toBe("rejected");
    expect(m.relations[0].reviewNote).toContain("Auto-rejected");
    expect(m.flows[0].state).toBe("rejected");
  });
  it("rejecting a part leaves no unfixable dangling errors blocking publish", async () => {
    // Regression: a rejected part used to strand dependent relations/flows as
    // "dangling" errors — unapprovable and unrejectable via the UI cascade —
    // deadlocking the publish button.
    const lesson = await createLesson("heart");
    const full = fixtureMap("heart", false);
    let m = full;
    for (const item of items(full).filter((i) => i.id !== "part-1"))
      m = decide(m, item.id, "approve", "Checked.");
    m = decide(m, "part-1", "reject", "Not in this lesson");
    expect(validateMap(m).some((i) => i.severity === "error")).toBe(false);
    expect(
      items(m).every((i) =>
        ["teacher_approved", "rejected"].includes(i.state),
      ),
    ).toBe(true);
    lesson.map = m;
    expect(() => publishSnapshot(lesson, "2026-09-19T00:00:00Z")).not.toThrow();
  });
  it("approving a part leaves its relations and flows alone", () => {
    // The cascade belongs to rejection only: approving a part used to reject
    // every relation and flow that mentioned it, so the lesson could never be
    // published and a teacher's approvals were silently thrown away.
    const m = decide(fixtureMap("heart", false), "part-1", "approve", "Checked.");
    expect(m.parts.find((p) => p.id === "part-1")!.state).toBe("teacher_approved");
    expect(m.relations.filter((r) => r.from === "part-1" || r.to === "part-1").map((r) => r.state)).not.toContain(
      "rejected",
    );
    expect(m.flows[0].state).not.toBe("rejected");
  });
  it("resets every decision after an edit", () => {
    const m = revalidate(approveAll(fixtureMap("heart", false)), true);
    expect(items(m).some((i) => i.state === "teacher_approved")).toBe(false);
  });
  it("publishes vocabulary with aliases and approval metadata", async () => {
    const lesson = await createLesson("heart");
    lesson.map = approveAll(fixtureMap("heart", false));
    const snap = publishSnapshot(lesson, "2026-09-18T00:00:00Z");
    const artery = snap.vocabulary.find((t) => t.name === "Pulmonary artery")!;
    expect(artery.aliases).toEqual(["Pulmonary trunk"]);
    expect(artery.approvedAt).toBe("2026-09-18T00:00:00Z");
    expect(artery.approvedBy).toBe("local-teacher");
    expect(snap.license?.licenseName).toBe("Self-created schematic");
    const serialized = studentSerialize(snap);
    expect(
      serialized.vocabulary.find((t) => t.name === "Pulmonary artery")!
        .aliases,
    ).toEqual(["Pulmonary trunk"]);
    expect(serialized.vocabulary.every((t) => t.aliases !== undefined)).toBe(
      true,
    );
  });
  it("blocks publishing without source and license metadata", async () => {
    const lesson = await createLesson("pump");
    lesson.map = approveAll(fixtureMap("pump", false));
    lesson.license = null;
    expect(() => publishSnapshot(lesson, new Date().toISOString())).toThrow(
      "license",
    );
  });
  it("enforces the trust-state transition table", () => {
    expect(() => assertTrustTransition("ai_proposed", "teacher_approved")).not.toThrow();
    expect(() => assertTrustTransition("validated", "rejected")).not.toThrow();
    expect(() => assertTrustTransition("rejected", "ai_proposed")).not.toThrow();
    expect(() => assertTrustTransition("validated", "published")).toThrow(
      "Invalid trust-state transition",
    );
    expect(() => assertTrustTransition("teacher_approved", "validated")).toThrow(
      "Invalid trust-state transition",
    );
    expect(() => assertTrustTransition("published", "teacher_approved")).toThrow(
      "Invalid trust-state transition",
    );
  });
  it("reports per-item grounding deterministically", () => {
    const m = fixtureMap("pump", false);
    expect(itemGrounded(m, "part-0")).toBe(true);
    expect(itemGrounded(m, "relation-0")).toBe(true);
    expect(itemGrounded(m, "flow-0")).toBe(true);
    m.parts[0].labelId = "invented";
    m.relations[0].evidence = [];
    m.flows[0].steps = ["part-0", "missing"];
    expect(itemGrounded(m, "part-0")).toBe(false);
    expect(itemGrounded(m, "relation-0")).toBe(false);
    expect(itemGrounded(m, "flow-0")).toBe(false);
    expect(itemGrounded(m, "unknown")).toBe(false);
  });
  it("keeps model confidence separate from OCR confidence end to end", () => {
    const m = fixtureMap("heart", false);
    expect(m.parts[0].modelConfidence).toBeNull();
    expect(m.labels[0].confidence).toBeNull();
    m.labels[0].confidence = 91.5;
    m.parts[0].modelConfidence = 74;
    const parsed = mapSchema.parse(m);
    expect(parsed.labels[0].confidence).toBe(91.5);
    expect(parsed.parts[0].modelConfidence).toBe(74);
  });
  it("requires all decisions before publish and validates again at serialization", async () => {
    const lesson = await createLesson("pump");
    expect(() => publishSnapshot(lesson, new Date().toISOString())).toThrow();
    lesson.map = approveAll(fixtureMap("pump", false));
    const snap = publishSnapshot(lesson, new Date().toISOString());
    expect(snap.vocabulary.map((t) => t.id)).toEqual(
      snap.map.parts.map((p) => p.id),
    );
    snap.map.parts[0].state = "validated";
    expect(() => studentSerialize(snap)).toThrow("unapproved");
  });
  it("omits rejected content from student responses", async () => {
    const lesson = await createLesson("pump");
    lesson.map = approveAll(fixtureMap("pump", false));
    lesson.map.flows[0].state = "rejected";
    const snap = publishSnapshot(lesson, new Date().toISOString());
    expect(snap.map.flows).toHaveLength(0);
    expect(items(snap.map).every((i) => i.state === "teacher_approved")).toBe(
      true,
    );
  });
  it("analysis failures return a result rather than throwing", async () => {
    await expect(
      new DemoAnalysisProvider().analyze("missing"),
    ).resolves.toMatchObject({ ok: false, fallback: "manual_editor" });
  });
  it("rejects spoofed images and oversized files", () => {
    expect(
      imageType(Buffer.from("<svg><script>alert(1)</script></svg>")),
    ).toBeNull();
    expect(imageType(Buffer.alloc(5_000_001))).toBeNull();
  });
});

describe("Persistent publication", () => {
  const stores: Store[] = [];
  afterEach(() => {
    stores.splice(0).forEach((s) => s.db.close());
  });
  const make = () => {
    const store = new Store(":memory:");
    stores.push(store);
    return store;
  };
  it("conditionally publishes once and rejects stale writes", async () => {
    const s = make();
    const l = await createLesson("pump");
    l.map = approveAll(fixtureMap("pump", false));
    s.add(l);
    s.publish(l.id, 0);
    expect(() => s.publish(l.id, 0)).toThrow();
    expect(() => s.save(l, 0)).toThrow("another window");
    expect(s.published(l.id).version).toBe(1);
  });
  it("keeps old versions unchanged when editing a new draft", async () => {
    const s = make();
    const l = await createLesson("pump");
    l.map = approveAll(fixtureMap("pump", false));
    s.add(l);
    const first = s.publish(l.id, 0);
    const draft = s.newVersion(l.id, 1);
    draft.map.parts[0].description = "Changed draft text";
    s.save(draft, draft.revision);
    expect(s.published(l.id, 1)).toEqual(first);
    expect(s.published(l.id).map.parts[0].description).not.toBe(
      "Changed draft text",
    );
  });
  it("records structured approval audit events", async () => {
    const s = make();
    const l = await createLesson("pump");
    l.map = approveAll(fixtureMap("pump", false));
    s.add(l);
    const previous = items(l.map).find((i) => i.id === "part-0")!.state;
    s.audit(l.id, "reject", "part-0: Removed", "local-teacher", {
      itemId: "part-0",
      decision: "reject",
      previousState: previous,
      newState: "rejected",
    });
    const event = s.events(l.id).find((e) => e.itemId === "part-0")!;
    expect(event).toMatchObject({
      itemId: "part-0",
      decision: "reject",
      previousState: "teacher_approved",
      newState: "rejected",
      actor: "local-teacher",
    });
  });
  it("reads versions published before the license field existed", async () => {
    const s = make();
    const l = await createLesson("pump");
    l.map = approveAll(fixtureMap("pump", false));
    s.add(l);
    const { license: _dropped, ...legacy } = publishSnapshot(
      l,
      "2026-09-17T00:00:00Z",
    );
    s.db
      .prepare("INSERT INTO versions VALUES (?, ?, ?)")
      .run(l.id, 1, JSON.stringify(legacy));
    expect(s.published(l.id).license).toBeNull();
  });
  it("database triggers prohibit snapshot updates and deletes", async () => {
    const s = make();
    const l = await createLesson("pump");
    l.map = approveAll(fixtureMap("pump", false));
    s.add(l);
    s.publish(l.id, 0);
    expect(() =>
      s.db.prepare("DELETE FROM versions WHERE lesson_id=?").run(l.id),
    ).toThrow("immutable");
    expect(() =>
      s.db
        .prepare("UPDATE versions SET body=? WHERE lesson_id=?")
        .run("{}", l.id),
    ).toThrow("immutable");
  });
});
