import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("../src/lib/supabase", () => ({ getAccessToken: async () => null }));
import { api, apiJob, ApiError, AUTH_CHANGED } from "../src/api";

const signals: string[] = [];
beforeEach(() => {
  signals.length = 0;
  vi.stubGlobal("window", { dispatchEvent: (e: Event) => signals.push(e.type) });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const respond = (status: number, body: unknown) =>
  vi.stubGlobal("fetch", async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
const any = z.unknown();
const failure = (p: Promise<unknown>) =>
  p.then(
    () => {
      throw new Error("the request should have failed");
    },
    (e: unknown) => e as ApiError,
  );

it("carries the HTTP status on the error so callers can tell signed-out from busy", async () => {
  respond(403, { error: "Teacher access is required." });
  const error = await failure(api("/demo/state", any));
  expect(error).toBeInstanceOf(ApiError);
  expect(error.status).toBe(403);
  expect(error.message).toBe("Teacher access is required.");
});

it("tells the app once when the session changed, but never for the session call itself", async () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_000); // clear the debounce left by earlier tests
  respond(401, { error: "Sign in first." });
  await failure(api("/published", any));
  await failure(api("/published", any));
  expect(signals).toEqual([AUTH_CHANGED]); // debounced: one signal, not one per request
  signals.length = 0;
  await failure(api("/session", any));
  expect(signals).toEqual([]); // re-reading the session must not trigger itself
});

it("turns proxy error pages and timeouts into plain words, never a JSON parse error", async () => {
  respond(503, "<html>Service Unavailable</html>");
  expect((await failure(api("/x", any))).message).toMatch(/busy or restarting/);
  respond(429, "slow down");
  expect((await failure(api("/x", any))).message).toMatch(/Too many requests/);
  vi.stubGlobal("fetch", async () => {
    throw new TypeError("Failed to fetch");
  });
  const offline = await failure(api("/x", any));
  expect(offline.message).toMatch(/Check your connection/);
  expect(offline.message).not.toMatch(/npm run dev/);
});

// --- apiJob: long AI calls run as background jobs the page polls ---
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const scripted = (...steps: (Response | Error)[]) => {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    const step = steps.shift();
    if (!step) throw new Error("unexpected extra request " + url);
    if (step instanceof Error) throw step;
    return step;
  });
  return calls;
};
const result = z.object({ title: z.string() });

it("starts the job, polls until it is done, and returns the parsed result", async () => {
  vi.useFakeTimers();
  const calls = scripted(reply(202, { jobId: "job-1" }), reply(200, { state: "running" }), reply(200, { state: "running" }), reply(200, { state: "done", result: { title: "Heart" } }));
  const promise = apiJob("/ai/explain-diagram", result, { mime: "image/png" });
  await vi.advanceTimersByTimeAsync(5000);
  expect(await promise).toEqual({ title: "Heart" });
  expect(calls).toEqual(["/api/ai/explain-diagram?async=1", "/api/ai/jobs/job-1", "/api/ai/jobs/job-1", "/api/ai/jobs/job-1"]);
  vi.useRealTimers();
});

it("reports a failed job with the server's reason and status", async () => {
  vi.useFakeTimers();
  scripted(reply(202, { jobId: "job-2" }), reply(200, { state: "failed", status: 422, error: "No speech was found in that video." }));
  const outcome = failure(apiJob("/ai/transcribe-youtube", result, { videoId: "x" }));
  await vi.advanceTimersByTimeAsync(2000);
  const error = await outcome;
  expect(error.message).toBe("No speech was found in that video.");
  expect(error.status).toBe(422);
  vi.useRealTimers();
});

it("survives a couple of dropped connections while the job keeps running, but not endless ones", async () => {
  vi.useFakeTimers();
  scripted(reply(202, { jobId: "job-3" }), new TypeError("net"), new TypeError("net"), reply(200, { state: "done", result: { title: "ok" } }));
  const survived = apiJob("/ai/x", result, {});
  await vi.advanceTimersByTimeAsync(6000);
  expect(await survived).toEqual({ title: "ok" });
  scripted(reply(202, { jobId: "job-4" }), new TypeError("net"), new TypeError("net"), new TypeError("net"), new TypeError("net"));
  const gaveUp = failure(apiJob("/ai/x", result, {}));
  await vi.advanceTimersByTimeAsync(10_000);
  expect((await gaveUp).message).toMatch(/Check your connection/);
  vi.useRealTimers();
});

it("gives up with a clear message when a job never finishes", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", async (url: string) => reply(url.includes("async=1") ? 202 : 200, url.includes("async=1") ? { jobId: "job-5" } : { state: "running" }));
  const stuck = failure(apiJob("/ai/x", result, {}, 10_000));
  await vi.advanceTimersByTimeAsync(20_000);
  expect((await stuck).message).toMatch(/taking too long/);
  vi.useRealTimers();
});
