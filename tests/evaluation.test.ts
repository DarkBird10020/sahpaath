import { expect, it } from "vitest";
import { evaluate, wordErrorRate } from "../shared/evaluation";
it("returns null for all unmeasured metrics", () => {
  expect(Object.values(evaluate()).every((x) => x === null)).toBe(true);
});
it("computes edit-distance word error rate", () => {
  expect(wordErrorRate("water enters the pump", "water enters pump")).toBe(
    0.25,
  );
  expect(wordErrorRate("", "hello")).toBeNull();
});
it("does not accept fixture records as model evaluation runs", () => {
  expect(() => evaluate({ source: "demo_fixture" })).toThrow();
});
it("validates counts and computes only present measurements", () => {
  const run = {
    source: "actual_run",
    runId: "unit-test-only",
    recordedAt: new Date().toISOString(),
    expectedLabels: ["a", "b"],
    observedLabels: ["a"],
    proposedCount: 2,
    groundedCount: 1,
  };
  expect(evaluate(run).labelRecall).toBe(0.5);
  expect(evaluate(run).groundingRate).toBe(0.5);
  expect(evaluate(run).processingMs).toBeNull();
  expect(() => evaluate({ ...run, groundedCount: 3 })).toThrow();
});
