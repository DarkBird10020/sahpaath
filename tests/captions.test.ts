import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureMap } from "../shared/fixtures";
import { decide, items } from "../shared/domain";
import { getTermSurfaces, matchCaptionTerms, segmentsFromHits } from "../shared/vocabulary";
import { createLesson } from "../server/providers";
import { Store } from "../server/store";
import { AudioService } from "../server/audio";
import { demoState, resetDemo, startDemo } from "../server/demo";
import type { DiagramMap } from "../shared/schema";

const terms = [
  { id: "part-1", name: "Pulmonary artery", aliases: ["Pulmonary trunk"] },
  { id: "part-2", name: "Lungs", aliases: [] },
  { id: "part-4", name: "Left atrium", aliases: [] },
];
function approveAll(map: DiagramMap) {
  for (const item of items(map)) map = decide(map, item.id, "approve", "Checked against the source diagram.");
  return map;
}

describe("Caption term matching", () => {
  it("reports exact, alias and near-spelling hits with offsets, never rewriting text", () => {
    const text = "The pulmonary artary and the Pulmonary trunk carry blood to the Lungs.";
    const hits = matchCaptionTerms(text, terms);
    expect(hits.map((h) => [h.matched, h.termId, h.method])).toEqual([
      ["pulmonary artary", "part-1", "near_spelling"],
      ["Pulmonary trunk", "part-1", "alias"],
      ["Lungs", "part-2", "exact"],
    ]);
    for (const h of hits) expect(text.slice(h.start, h.end)).toBe(h.matched);
    expect(segmentsFromHits(text, hits).map((s) => s.text).join("")).toBe(text);
  });
  it("does not stretch to ordinary or short words", () => {
    expect(matchCaptionTerms("Lunge forward into the pulmonary area.", terms)).toEqual([]);
    expect(matchCaptionTerms("The left atria and the lung.", terms)).toEqual([]);
    expect(matchCaptionTerms("A culmonary artery is not a word.", terms)).toEqual([]);
  });
  it("counts a near-spelling segment as the term appearing in captions", async () => {
    const lesson = await createLesson("heart");
    lesson.map = approveAll(fixtureMap("heart", false));
    const { publishSnapshot } = await import("../shared/domain");
    const snap = publishSnapshot(lesson, "2026-09-18T00:00:00Z");
    const text = "It leaves through the pulmonary artary.";
    expect(getTermSurfaces("part-1", snap, [{ text }]).captions).toBe(false);
    expect(
      getTermSurfaces("part-1", snap, [{ text, matchedTerms: matchCaptionTerms(text, snap.vocabulary) }]).captions,
    ).toBe(true);
  });
});

describe("Caption sessions and guided demo", () => {
  const stores: Store[] = [];
  const dirs: string[] = [];
  afterEach(() => {
    stores.splice(0).forEach((s) => s.db.close());
    dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
  });
  const make = () => {
    const s = new Store(":memory:");
    stores.push(s);
    return s;
  };
  async function published(s: Store) {
    const l = await createLesson("heart");
    l.map = approveAll(fixtureMap("heart", false));
    s.add(l);
    s.publish(l.id, 0);
    return l.id;
  }
  it("keeps one live session per lesson and stores only final lines with hits", async () => {
    const s = make();
    const lessonId = await published(s);
    expect(() => s.startCaptionSession("missing", "typed")).toThrow();
    const a = s.startCaptionSession(lessonId, "typed");
    expect(s.startCaptionSession(lessonId, "browser_speech").id).toBe(a.id);
    const seg = s.addSegment(a.id, "Blood enters the pulmonary artary.", 1000, 2500);
    expect(seg).toMatchObject({ text: "Blood enters the pulmonary artary.", startMs: 1000, endMs: 2500, version: 1 });
    expect(seg.matchedTerms[0]).toMatchObject({ termId: "part-1", method: "near_spelling" });
    expect(s.lessonSegments(lessonId, 1)).toHaveLength(1);
    expect(s.lessonSegments(lessonId, 2)).toHaveLength(0);
    s.endCaptionSession(a.id);
    expect(() => s.addSegment(a.id, "Late line")).toThrow("ended");
    expect(s.startCaptionSession(lessonId, "typed").id).not.toBe(a.id);
    expect(s.events(lessonId).map((e) => e.action)).toContain("caption_session_ended");
  });
  it("derives every demo step from real lesson data", async () => {
    const s = make();
    const dir = mkdtempSync(join(tmpdir(), "sahpaath-demo-"));
    dirs.push(dir);
    const audio = new AudioService(dir, null);
    expect(demoState(s, audio).lessonId).toBeNull();
    const { lessonId } = await startDemo(s);
    expect((await startDemo(s)).lessonId).toBe(lessonId);
    const status = () => Object.fromEntries(demoState(s, audio).steps.map((x) => [x.id, x.status]));
    expect(status()).toMatchObject({ ocr: "simulated", validate: "done", fix: "waiting", publish: "waiting", audio: "fallback" });

    let lesson = s.get(lessonId);
    lesson.map.relations[1].evidence = ["label-1", "label-2"];
    lesson.map = approveAll(lesson.map);
    lesson = s.save(lesson, lesson.revision);
    expect(status()).toMatchObject({ fix: "done", approve: "done", publish: "waiting" });
    s.publish(lessonId, lesson.revision);
    expect(status()).toMatchObject({ publish: "done", vocabulary: "done", captions: "waiting" });

    const session = s.startCaptionSession(lessonId, "demo_script");
    s.addSegment(session.id, "It leaves through the pulmonary artary.");
    expect(status().captions).toBe("done");
    s.addRecord("questions", {
      id: "q1", lessonId, version: 1, conceptId: "part-1", text: "Ask about Pulmonary artery: I don't understand what this does.",
      sessionCode: "ABC123", createdAt: new Date().toISOString(), status: "queued", aiAnswer: null,
    });
    expect(status()).toMatchObject({ ask: "done", inbox: "waiting" });
    s.setQuestionStatus("q1", "seen");
    expect(demoState(s, audio).next).toBe("Every step of the story is complete.");

    resetDemo(s);
    expect(demoState(s, audio).lessonId).toBeNull();
    expect(s.published(lessonId).version).toBe(1);
  });
});
