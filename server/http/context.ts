import type { IncomingMessage } from "node:http";
import { z } from "zod";
import { forbiddenError, payloadTooLargeError, rateLimitedError, unauthorizedError, unsupportedMedia } from "./http-errors";
import type { Actor } from "../services/lesson-service";

export const MAX_JSON_BYTES = 7_000_000;

/** Parse and size-limit a JSON request body, then schema-validate it. */
export async function readJson<T>(req: IncomingMessage, schema: z.ZodType<T>): Promise<T> {
  const contentType = req.headers["content-type"] || "";
  if (!contentType.startsWith("application/json"))
    throw unsupportedMedia("Send JSON with application/json content type.");
  let length = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    length += (chunk as Buffer).length;
    if (length > MAX_JSON_BYTES) throw payloadTooLargeError("Request body is too large.");
    chunks.push(chunk as Buffer);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new z.ZodError([{ code: "custom", path: [], message: "Invalid JSON request." }]);
  }
  return schema.parse(parsed);
}

/** In-memory sliding-window rate limiter (per-process; per docs/DYNAMODB.md notes). */
const counters = new Map<string, { count: number; until: number }>();

export function rateLimit(key: string, max: number, windowMs = 60_000): void {
  const now = Date.now();
  if (counters.size > 5000)
    for (const [k, v] of counters) if (v.until < now) counters.delete(k);
  const current = counters.get(key);
  const next =
    !current || current.until < now
      ? { count: 1, until: now + windowMs }
      : { count: current.count + 1, until: current.until };
  counters.set(key, next);
  if (next.count > max) throw rateLimitedError("Too many requests. Wait a minute and try again.");
}

export function clientKey(req: IncomingMessage): string {
  return req.socket.remoteAddress || "local";
}

/** Extract the SahPaath session cookie value. */
export function readSessionCookie(req: IncomingMessage): string | undefined {
  return req.headers.cookie
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith("sahpaath="))
    ?.slice(9);
}

export interface ResolvedAuth {
  actor: Actor;
  classCode: string;
  /** Present when authenticated via a Supabase bearer token. */
  principal?: import("./auth").Principal;
}

/**
 * Resolve the caller's identity. Receives the session-cookie token (when
 * present) and the request itself so resolvers can also honour an
 * Authorization: Bearer header (Supabase access tokens).
 */
export type AuthResolver = (
  token: string | undefined,
  req?: IncomingMessage,
) => Promise<ResolvedAuth | null>;

/** Require any authenticated session; returns the actor. */
export async function requireSession(
  req: IncomingMessage,
  resolve: AuthResolver,
): Promise<ResolvedAuth> {
  const auth = await resolve(readSessionCookie(req), req);
  if (!auth) throw unauthorizedError("Choose a classroom role to continue.");
  return auth;
}

/** Require an authenticated teacher. */
export async function requireTeacher(
  req: IncomingMessage,
  resolve: AuthResolver,
): Promise<ResolvedAuth> {
  const auth = await requireSession(req, resolve);
  if (auth.actor.role !== "teacher") throw forbiddenError("Only teachers can change lesson content.");
  return auth;
}
