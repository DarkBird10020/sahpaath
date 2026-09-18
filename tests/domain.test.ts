import { describe, it, expect, afterEach } from "vitest";
import { fixtureMap, fixtures } from "../shared/fixtures";
import {
  decide,
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
import type { DiagramMap } from "../shared/schema";

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
    expect(m.relations[0].state).toBe("needs_review");
    expect(m.flows[0].state).toBe("needs_review");
  });
  it("resets every decision after an edit", () => {
    const m = revalidate(approveAll(fixtureMap("heart", false)), true);
    expect(items(m).some((i) => i.state === "teacher_approved")).toBe(false);
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
