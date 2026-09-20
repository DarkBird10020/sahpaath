import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { poll } from "../src/lib/poll";

const listeners = new Set<() => void>();
const fakeDocument = {
  hidden: false,
  addEventListener: (_: string, fn: () => void) => listeners.add(fn),
  removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
};

beforeEach(() => {
  vi.useFakeTimers();
  fakeDocument.hidden = false;
  listeners.clear();
  vi.stubGlobal("document", fakeDocument);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("runs on the interval and stops when asked", async () => {
  const run = vi.fn(async () => {});
  const stop = poll(run, 1000);
  await vi.advanceTimersByTimeAsync(3100);
  expect(run).toHaveBeenCalledTimes(3);
  stop();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(run).toHaveBeenCalledTimes(3);
  expect(listeners.size).toBe(0);
});

it("backs off after failures instead of hammering, and recovers on success", async () => {
  let fail = true;
  const run = vi.fn(async () => {
    if (fail) throw new Error("401");
  });
  const stop = poll(run, 1000);
  await vi.advanceTimersByTimeAsync(1000); // 1st failure -> next in 2 s
  await vi.advanceTimersByTimeAsync(2000); // 2nd failure -> next in 4 s
  await vi.advanceTimersByTimeAsync(4000); // 3rd failure -> next in 8 s
  expect(run).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(7000);
  expect(run).toHaveBeenCalledTimes(3); // still waiting: no request storm
  fail = false;
  await vi.advanceTimersByTimeAsync(1100);
  expect(run).toHaveBeenCalledTimes(4);
  await vi.advanceTimersByTimeAsync(1000); // healthy again: back to the base interval
  expect(run).toHaveBeenCalledTimes(5);
  stop();
});

it("never overlaps a slow request and stays quiet in a hidden tab", async () => {
  let release: () => void = () => {};
  const run = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
  const stop = poll(run, 1000);
  await vi.advanceTimersByTimeAsync(5000);
  expect(run).toHaveBeenCalledTimes(1); // still waiting on the first one
  release();
  fakeDocument.hidden = true;
  await vi.advanceTimersByTimeAsync(10_000);
  expect(run).toHaveBeenCalledTimes(1); // hidden: no requests
  fakeDocument.hidden = false;
  listeners.forEach((fn) => fn()); // tab comes back: refresh at once
  await vi.advanceTimersByTimeAsync(0);
  expect(run).toHaveBeenCalledTimes(2);
  stop();
});
