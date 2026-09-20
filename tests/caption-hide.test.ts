import { afterEach, expect, it } from "vitest";
import { fixtureMap } from "../shared/fixtures";
import { decide, items } from "../shared/domain";
import { createLesson } from "../server/providers";
import { Store } from "../server/store";
import type { DiagramMap } from "../shared/schema";

const stores: Store[] = [];
afterEach(() => stores.splice(0).forEach((s) => s.db.close()));

function approveAll(map: DiagramMap) {
  for (const item of items(map)) map = decide(map, item.id, "approve", "Checked against the source diagram.");
  return map;
}
async function sessionWithLines() {
  const store = new Store(":memory:");
  stores.push(store);
  const lesson = await createLesson("heart");
  lesson.map = approveAll(fixtureMap("heart", false));
  store.add(lesson);
  store.publish(lesson.id, 0);
  const session = store.startCaptionSession(lesson.id, "typed");
  const keep = store.addSegment(session.id, "Blood leaves the right ventricle.", 1000, 2000);
  const hide = store.addSegment(session.id, "A line the teacher does not want in the history.", 3000, 4000);
  const also = store.addSegment(session.id, "It travels to the lungs.", 5000, 6000);
  return { store, lesson, session, keep, hide, also };
}

it("hides a line from every reader without erasing it, and can put it back", async () => {
  const { store, lesson, session, keep, hide, also } = await sessionWithLines();
  expect(store.hideSegment(session.id, hide.id)).toBe(true);
  // Live view, search and export all read through segments(); the glossary through lessonSegments().
  expect(store.segments(session.id).map((s) => s.id)).toEqual([keep.id, also.id]);
  expect(store.lessonSegments(lesson.id, 1).map((s) => s.id)).toEqual([keep.id, also.id]);
  // Nothing was erased: the stored row is still there.
  const stored = store.db.prepare("SELECT COUNT(*) AS n FROM caption_segments WHERE id=?").get(hide.id) as { n: number };
  expect(stored.n).toBe(1);
  expect(store.events(lesson.id).map((e) => e.action)).toContain("caption_line_hidden");
  // The audit trail says a line was hidden, but does not repeat what it said.
  expect(JSON.stringify(store.events(lesson.id))).not.toContain("does not want");
  expect(store.restoreSegment(session.id, hide.id)).toBe(true);
  expect(store.segments(session.id).map((s) => s.id)).toEqual([keep.id, hide.id, also.id]);
});

it("hiding twice is harmless, and a line from another session cannot be hidden", async () => {
  const { store, session, hide } = await sessionWithLines();
  expect(store.hideSegment(session.id, hide.id)).toBe(true);
  expect(store.hideSegment(session.id, hide.id)).toBe(true);
  expect(store.segments(session.id)).toHaveLength(2);
  expect(store.hideSegment("some-other-session", hide.id)).toBe(false);
  expect(store.hideSegment(session.id, "no-such-line")).toBe(false);
  expect(store.restoreSegment("some-other-session", hide.id)).toBe(false);
});
