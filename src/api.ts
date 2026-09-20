import { z } from "zod";
import { getAccessToken } from "./lib/supabase";

/** A failed request, with the HTTP status so callers can tell "signed out" from "busy". */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}
export const AUTH_CHANGED = "sahpaath:auth-changed";
let lastAuthSignal = 0;

export async function api<T>(
  path: string,
  schema: z.ZodType<T>,
  method = "GET",
  value?: unknown,
): Promise<T> {
  let response: Response;
  try {
    // Supabase identity, when present, rides along as a Bearer token; the
    // server prefers it over the local classroom cookie. Neither existing
    // call site changes.
    const token = await getAccessToken();
    response = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers: {
        ...(value === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: value === undefined ? undefined : JSON.stringify(value),
    });
  } catch {
    throw new Error("Cannot reach the classroom. Check your connection and try again.");
  }
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    // A gateway or proxy error page is not JSON; say what happened in plain words.
  }
  if (!response.ok) {
    // The session changed under this page (expired, or another tab picked a different
    // role and replaced the shared cookie). Tell the app once so it can re-read it.
    if ((response.status === 401 || response.status === 403) && !path.startsWith("/session") && Date.now() - lastAuthSignal > 5000) {
      lastAuthSignal = Date.now();
      window.dispatchEvent(new Event(AUTH_CHANGED));
    }
    const known = z.object({ error: z.string() }).safeParse(data);
    if (known.success) throw new ApiError(known.data.error, response.status);
    throw new ApiError(
      response.status === 429
        ? "Too many requests. Wait a moment and try again."
        : response.status >= 500
          ? "The classroom is busy or restarting. Try again in a few seconds."
          : `The classroom could not complete that request (${response.status}).`,
      response.status,
    );
  }
  return schema.parse(data);
}
export const okSchema = z.object({ ok: z.boolean() });

const jobSchema = z.object({
  state: z.enum(["running", "done", "failed"]),
  result: z.unknown().optional(),
  status: z.number().optional(),
  error: z.string().optional(),
});
/**
 * For AI calls that can take longer than a proxy allows (30 s): start the work on the
 * server, then ask how it is going every 1.5 s until it finishes.
 */
export async function apiJob<T>(path: string, schema: z.ZodType<T>, value: unknown, timeoutMs = 5 * 60_000): Promise<T> {
  const { jobId } = await api(`${path}?async=1`, z.object({ jobId: z.string() }), "POST", value);
  const deadline = Date.now() + timeoutMs;
  let blips = 0;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    let job: z.infer<typeof jobSchema>;
    try {
      job = await api(`/ai/jobs/${jobId}`, jobSchema);
      blips = 0;
    } catch (error) {
      // A dropped connection while waiting should not lose a job that is still running.
      if ((error as { status?: number }).status === undefined && ++blips < 4) continue;
      throw error;
    }
    if (job.state === "done") return schema.parse(job.result);
    if (job.state === "failed") throw new ApiError(job.error ?? "AI help is unavailable right now. Please try again.", job.status ?? 502);
    if (Date.now() > deadline) throw new Error("This is taking too long. Please try again in a minute.");
  }
}
/** Base64 of a file without the "data:...;base64," prefix. */
export function fileBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("Could not read the file. Choose it again."));
    reader.readAsDataURL(file);
  });
}
