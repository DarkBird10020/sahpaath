import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureMap } from "../shared/fixtures";
import { buildExplorer, decide, items, publishSnapshot } from "../shared/domain";
import { createLesson } from "../server/providers";
import { AudioService, readPollyConfig } from "../server/audio";
import type { DiagramMap, Published } from "../shared/schema";

function approveAll(map: DiagramMap) {
  for (const item of items(map)) map = decide(map, item.id, "approve", "Checked against the source diagram.");
  return map;
}
async function publishedHeart(): Promise<Published> {
  const lesson = await createLesson("heart");
  lesson.map = approveAll(fixtureMap("heart", false));
  return publishSnapshot(lesson, "2026-09-18T00:00:00Z");
}

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "sahpaath-audio-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("Student explorer view", () => {
  it("announces position, flow neighbours and connections from published content", async () => {
    const view = buildExplorer(await publishedHeart());
    expect(view.readingOrder).toEqual(["part-0", "part-1", "part-2", "part-3", "part-4"]);
    const artery = view.parts.find((p) => p.name === "Pulmonary artery")!;
    expect(artery.flow).toMatchObject({ position: 2, total: 5, previous: "part-0", next: "part-2" });
    // The built-in heart sample has no written relationship explanations.
    expect(artery.connectedParts).toEqual([
      { partId: "part-0", name: "Right ventricle", relationship: "flows_to", direction: "incoming", explanation: null },
      { partId: "part-2", name: "Lungs", relationship: "flows_to", direction: "outgoing", explanation: null },
    ]);
    expect(artery.vocabularyTermId).toBe(artery.partId);
    expect(view.parts[0].flow!.previous).toBeNull();
    expect(view.parts.at(-1)!.flow!.next).toBeNull();
  });
  it("gives students the approved sentence on how two parts connect", async () => {
    const lesson = await createLesson("heart");
    const map = fixtureMap("heart", false);
    map.relations[0].descriptions = {
      short: "The right ventricle pumps blood into the pulmonary artery.",
      detailed: "When the right ventricle contracts, it pushes blood out through a valve into the pulmonary artery.",
    };
    lesson.map = approveAll(map);
    const view = buildExplorer(publishSnapshot(lesson, "2026-09-18T00:00:00Z"));
    const ventricle = view.parts.find((p) => p.name === "Right ventricle")!;
    expect(ventricle.connectedParts[0].explanation).toBe("The right ventricle pumps blood into the pulmonary artery.");
  });
  it("refuses content that is not teacher approved", async () => {
    const snap = await publishedHeart();
    snap.map.parts[1].state = "needs_review";
    expect(() => buildExplorer(snap)).toThrow("unapproved");
  });
  it("uses browser speech when no cached audio exists", async () => {
    const view = buildExplorer(await publishedHeart(), { cachedUrl: () => null });
    expect(view.audioEngine).toBe("browser_speech");
    expect(view.parts.every((p) => p.audio === null)).toBe(true);
  });
  it("serves the detailed description level to the explorer when the teacher kept one", async () => {
    const lesson = await createLesson("heart");
    const map = fixtureMap("heart", false);
    map.parts[0].descriptions = {
      short: "Pumps blood to the lungs.",
      normal: map.parts[0].description,
      detailed: "The right ventricle is the lower-right chamber of the heart. It receives deoxygenated blood from the right atrium. When it contracts, the pulmonary valve opens. Blood travels through the pulmonary artery toward the lungs. There the blood releases carbon dioxide and picks up oxygen.",
    };
    lesson.map = approveAll(map);
    const view = buildExplorer(publishSnapshot(lesson, "2026-09-19T00:00:00Z"));
    const ventricle = view.parts.find((p) => p.name === "Right ventricle")!;
    expect(ventricle.detailedDescription).toContain("lower-right chamber");
    expect(ventricle.shortDescription).toBe("Pumps blood to the lungs.");
    // Parts without a kept detailed level simply repeat the description.
    expect(view.parts[1].detailedDescription).toBe(view.parts[1].shortDescription);
  });
});

describe("Cached audio of approved descriptions", () => {
  it("synthesizes each approved part once and reuses the cache", async () => {
    const calls: string[] = [];
    const service = new AudioService(tempDir(), async (text) => {
      calls.push(text);
      return new Uint8Array([1, 2, 3]);
    }, "Kajal:neural:en-IN");
    const snap = await publishedHeart();
    expect(await service.prepare(snap)).toMatchObject({ generated: 5, cached: 0, failed: 0 });
    expect(await service.prepare(snap)).toMatchObject({ generated: 0, cached: 5 });
    expect(calls).toHaveLength(5);
    expect(calls[1]).toBe("Pulmonary artery. Carries blood from the right ventricle toward the lungs.");
    const view = buildExplorer(snap, {
      cachedUrl: (partId) => (service.has(snap, partId) ? `/audio/${partId}` : null),
    });
    expect(view.audioEngine).toBe("polly");
    expect(view.parts[1].audio).toEqual({ url: "/audio/part-1", engine: "polly", cached: true });
    expect([...(await service.read(snap, "part-1"))!]).toEqual([1, 2, 3]);
  });
  it("produces new audio when the approved text or version changes", async () => {
    const service = new AudioService(tempDir(), async () => new Uint8Array([9]));
    const snap = await publishedHeart();
    const before = service.key(snap, "part-1");
    expect(service.key({ ...snap, version: 2 }, "part-1")).not.toBe(before);
    const edited = structuredClone(snap);
    edited.map.parts[1].description = "Edited description.";
    expect(service.key(edited, "part-1")).not.toBe(before);
  });
  it("falls back to text when synthesis fails", async () => {
    const service = new AudioService(tempDir(), async () => {
      throw new Error("ThrottlingException");
    });
    const snap = await publishedHeart();
    expect(await service.ensure(snap, "part-0")).toBe("failed");
    expect(service.has(snap, "part-0")).toBe(false);
    const view = buildExplorer(snap, { cachedUrl: (id) => (service.has(snap, id) ? id : null) });
    expect(view.audioEngine).toBe("browser_speech");
    expect(view.parts[0].detailedDescription.length).toBeGreaterThan(0);
  });
  it("never synthesizes parts outside the approved snapshot", async () => {
    let called = false;
    const service = new AudioService(tempDir(), async () => {
      called = true;
      return new Uint8Array([1]);
    });
    const snap = await publishedHeart();
    snap.map.parts[0].state = "rejected";
    expect(await service.ensure(snap, "part-0")).toBe("unavailable");
    expect(await service.ensure(snap, "invented")).toBe("unavailable");
    expect(called).toBe(false);
  });
  it("stays off without an explicit voice and credentials", () => {
    expect(readPollyConfig({ AWS_REGION: "ap-south-1" })).toBeNull();
    expect(readPollyConfig({ AWS_REGION: "ap-south-1", SAHPAATH_POLLY_VOICE: "Kajal" })).toBeNull();
    expect(
      readPollyConfig({ AWS_REGION: "ap-south-1", SAHPAATH_POLLY_VOICE: "Kajal", SAHPAATH_AWS_USE_ROLE: "true", SAHPAATH_POLLY_ENGINE: "bogus" }),
    ).toBeNull();
    expect(
      readPollyConfig({ AWS_REGION: "ap-south-1", SAHPAATH_POLLY_VOICE: "Kajal", SAHPAATH_AWS_USE_ROLE: "true" }),
    ).toMatchObject({ voiceId: "Kajal", engine: "neural", languageCode: "en-IN" });
  });
});
