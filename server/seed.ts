import type { Store } from "./store";
import { createLesson } from "./providers";
import { decide, items, revalidate } from "../shared/domain";

/** Sample lessons every classroom starts with, so Explore and Captions are
 * never empty on a fresh deployment. */
const SAMPLE_FIXTURES = ["heart", "water", "plant", "circuit", "solar"] as const;
const NOTE = "Reviewed against the source diagram.";

/** Creates, reviews and publishes the sample lessons through the same
 * validator, decision and publish code a teacher uses. Idempotent: a fixture
 * that already has a published lesson is skipped, so restarts add nothing and
 * a lesson the teacher has since edited or published again is never touched. */
export async function seedSamples(store: Store, log: (line: string) => void = console.log) {
  const lessons = store.list();
  for (const fixtureId of SAMPLE_FIXTURES) {
    const mine = lessons.filter((l) => l.fixtureId === fixtureId);
    if (mine.some((l) => l.publishedVersion !== null)) continue;
    // Finish a draft left over from an interrupted seed rather than adding a duplicate.
    const draft = mine.find((l) => l.status === "draft") ?? store.add(await createLesson(fixtureId));
    let map = draft.map;
    // Some fixtures ship a relationship with no supporting label on purpose
    // (the teacher-repair demo). Ground it in the two parts it joins.
    map = structuredClone(map);
    for (const relation of map.relations) {
      if (relation.evidence.length) continue;
      const labels = [relation.from, relation.to]
        .map((id) => map.parts.find((p) => p.id === id)?.labelId)
        .filter((id): id is string => !!id);
      relation.evidence = labels;
    }
    map = revalidate(map);
    for (const item of items(map))
      if (item.state !== "teacher_approved") map = decide(map, item.id, "approve", NOTE);
    const saved = store.save({ ...draft, map }, draft.revision);
    store.audit(saved.id, "sample_seeded", "Sample lesson reviewed and published on first start.");
    store.publish(saved.id, saved.revision);
    log(JSON.stringify({ event: "sample_seeded", fixtureId, lessonId: saved.id }));
  }
}
