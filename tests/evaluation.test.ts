import { expect, it } from "vitest";
import { evaluate, summarySchema, wordErrorRate } from "../shared/evaluation";
import { Store } from "../server/store";

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
const run = (over: Record<string, unknown>) => ({
  source: "actual_run",
  runId: "run-1",
  recordedAt: new Date().toISOString(),
  ...over,
});
it("summary stays null until actual runs are recorded, then averages", () => {
  const store = new Store(":memory:");
  const empty = store.evaluationSummary();
  expect(summarySchema.parse(empty)).toEqual(empty);
  expect(empty.runs).toBe(0);
  expect(empty.labelRecall).toBeNull();
  store.addEvaluationRun(
    run({ expectedLabels: ["a", "b"], observedLabels: ["a", "b"], proposedCount: 2, groundedCount: 2 }),
  );
  const one = store.evaluationSummary();
  expect(one.runs).toBe(1);
  expect(one.labelRecall).toBe(1);
  expect(one.groundingRate).toBe(1);
  expect(one.flowAccuracy).toBeNull();
  store.addEvaluationRun(
    run({ runId: "run-2", expectedLabels: ["a", "b", "c"], observedLabels: ["a"], proposedCount: 3, groundedCount: 1 }),
  );
  const two = store.evaluationSummary();
  expect(two.runs).toBe(2);
  expect(two.labelRecall).toBeCloseTo((1 + 1 / 3) / 2);
  expect(two.groundingRate).toBeCloseTo((1 + 1 / 3) / 2);
});
