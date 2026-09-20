import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("../src/lib/supabase", () => ({ getAccessToken: async () => null }));
import { api, ApiError, AUTH_CHANGED } from "../src/api";

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
