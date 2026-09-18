import { expect, it } from "vitest";
import {
  vocabularyPattern,
  correctVocabulary,
  matchTranscriptTerms,
  highlightSegments,
  getTermSurfaces,
} from "../shared/vocabulary";
import { publishSnapshot } from "../shared/domain";
import { createLesson } from "../server/providers";
import { fixtureMap } from "../shared/fixtures";
import { items, decide } from "../shared/domain";
import type { Caption } from "../shared/schema";

const term = {
  id: "part-1",
  name: "Pulmonary artery",
  aliases: ["Pulmonary trunk"],
  definition: "Carries blood toward the lungs.",
  labelId: "label-1",
  approvedAt: "",
  approvedBy: "local-teacher",
  state: "teacher_approved" as const,
};
it("highlights complete approved terms, never substrings inside other words", () => {
  expect("The system and stem".match(vocabularyPattern(["stem"]))).toEqual([
    "stem",
  ]);
});
it("handles regex characters literally and multiword case-insensitive corrections", () => {
  expect("a+b".match(vocabularyPattern(["a+b"]))).toEqual(["a+b"]);
  expect(
    correctVocabulary(
      "Pulmonary art tree carries blood",
      "pulmonary art tree",
      "Pulmonary artery",
    ),
  ).toBe("Pulmonary artery carries blood");
});
it("does not silently correct a phrase that is missing", () => {
  expect(() => correctVocabulary("heart", "art", "artery")).toThrow(
    "not found",
  );
});
it("maps a teacher alias back to the canonical approved term", () => {
  expect(matchTranscriptTerms("The pulmonary trunk carries blood", [term])).toEqual(
    [{ termId: "part-1", canonical: "Pulmonary artery", matched: "pulmonary trunk" }],
  );
});
it("prefers the longest surface so a canonical term is not split by a shorter alias", () => {
  const short = { ...term, aliases: ["Pulmonary"] };
  expect(matchTranscriptTerms("The pulmonary artery widens", [short])).toEqual([
    { termId: "part-1", canonical: "Pulmonary artery", matched: "pulmonary artery" },
  ]);
});
it("does not match aliases inside other words", () => {
  expect(matchTranscriptTerms("arterytrunk and trunkward", [term])).toEqual([]);
});
it("splits captions into plain and term segments that rebuild the text", () => {
  const segments = highlightSegments(
    "Pulmonary trunk, then the lungs.",
    [term, { ...term, id: "part-2", name: "lungs", aliases: [] }],
  );
  expect(segments.map((s) => s.text).join("")).toBe(
    "Pulmonary trunk, then the lungs.",
  );
  expect(segments.map((s) => s.termId)).toEqual([
    "part-1",
    null,
    "part-2",
    null,
  ]);
});
it("computes term surfaces from the published version and its captions", async () => {
  const lesson = await createLesson("heart");
  let map = fixtureMap("heart", false);
  for (const item of items(map))
    map = decide(map, item.id, "approve", "Checked the source diagram.");
  lesson.map = map;
  const published = publishSnapshot(lesson, "2026-09-18T00:00:00Z");
  const caption = (text: string): Pick<Caption, "text"> => ({ text });
  expect(
    getTermSurfaces("part-1", published, [caption("Watch the pulmonary trunk.")]),
  ).toEqual({
    explorer: true,
    glossary: true,
    audio: true,
    captions: true,
    communicationAnchor: true,
  });
  expect(getTermSurfaces("part-1", published, [caption("Nothing here.")]))
    .toMatchObject({ captions: false });
  expect(() => getTermSurfaces("unknown", published, [])).toThrow(
    "not part of the approved lesson version",
  );
});
