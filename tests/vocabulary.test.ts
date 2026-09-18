import { expect, it } from "vitest";
import { vocabularyPattern, correctVocabulary } from "../shared/vocabulary";
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
