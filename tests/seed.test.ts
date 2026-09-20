import { expect, it } from "vitest";
import { Store } from "../server/store";
import { seedSamples } from "../server/seed";

it("seeds published, fully reviewed sample lessons exactly once", async () => {
  const store = new Store(":memory:");
  await seedSamples(store, () => {});
  const published = store.publishedList();
  expect(published.map((p) => p.title).sort()).toEqual(
    ["A simple circuit", "Around the solar system", "A journey through the heart", "Following the water cycle", "Water through a plant"].sort(),
  );
  for (const lesson of store.list()) {
    expect(lesson.status).toBe("published");
    expect(lesson.map.relations.every((r) => r.evidence.length > 0)).toBe(true);
  }
  await seedSamples(store, () => {});
  expect(store.list()).toHaveLength(5);
});

it("finishes an interrupted draft instead of duplicating it", async () => {
  const store = new Store(":memory:");
  const { createLesson } = await import("../server/providers");
  store.add(await createLesson("heart"));
  await seedSamples(store, () => {});
  expect(store.list().filter((l) => l.fixtureId === "heart")).toHaveLength(1);
  expect(store.publishedList().some((p) => p.title === "A journey through the heart")).toBe(true);
});
