/**
 * Authentication + authorization middleware, shared by both API layers.
 *
 * AUTHENTICATION ("who is this?"): a valid Supabase access token in the
 * Authorization header identifies an application user from the users table.
 * The legacy cookie session (local classroom) remains valid so the existing
 * frontend keeps working unchanged; when both are present the Bearer token
 * wins.
 *
 * AUTHORIZATION ("what may they do?"): roles come exclusively from the
 * application users table. Nothing the client sends — body fields, headers,
 * query parameters — can influence the role.
 *
 * No password logic exists here or anywhere server-side: Supabase Auth owns
 * credentials.
 */

import type { IncomingMessage } from "node:http";
import { forbiddenError, unauthorizedError } from "../core/errors";
import type { AppRole, AppUser } from "../../shared/schema";
import {
  readSupabaseAuthConfig,
  verifySupabaseToken,
  createJwksCache,
  type SupabaseAuthConfig,
} from "../core/supabase-auth";

/** The authenticated principal attached to a request. */
export interface Principal {
  /** Application users-table id (UUID), stable across token refreshes. */
  userId: string;
  role: AppRole;
  email: string;
  name: string;
  /** How the principal was authenticated. */
  via: "supabase" | "cookie";
  /** Legacy anonymous class code (cookie sessions only). */
  classCode?: string;
}

/** Supabase users are looked up / provisioned through this callback. */
export type SupabaseUserResolver = (identity: {
  supabaseUserId: string;
  email: string | null;
}) => Promise<Principal>;

export interface AuthComponents {
  supabase: SupabaseAuthConfig | null;
  resolveSupabase: SupabaseUserResolver | null;
  /** Legacy cookie-session resolution; returns null when no valid session. */
  resolveCookie: (req: IncomingMessage) => Principal | null;
  verifyBearer: (token: string) => Promise<Principal>;
}

export function createAuthComponents(input: {
  env: NodeJS.ProcessEnv;
  resolveSupabase: SupabaseUserResolver | null;
  resolveCookie: (req: IncomingMessage) => Principal | null;
}): AuthComponents & { verifyBearer: (token: string) => Promise<Principal> } {
  const supabase = readSupabaseAuthConfig(input.env);
  const jwks = supabase ? createJwksCache(supabase) : null;
  return {
    supabase,
    resolveSupabase: input.resolveSupabase,
    resolveCookie: input.resolveCookie,
    verifyBearer: async (token: string) => {
      if (!supabase || !jwks || !input.resolveSupabase)
        throw unauthorizedError("Bearer authentication is not configured.");
      const identity = await verifySupabaseToken(token, supabase, jwks);
      return input.resolveSupabase(identity);
    },
  };
}

/** Read the Bearer token from the Authorization header, if any. */
export function readBearerToken(req: IncomingMessage): string | null {
  const raw = req.headers.authorization;
  if (!raw) return null;
  const [scheme, ...rest] = raw.trim().split(/\s+/);
  if (!scheme || scheme.toLowerCase() !== "bearer" || rest.length === 0) return null;
  return rest.join(" ");
}

/**
 * Authenticate the request: Bearer Supabase token first, legacy cookie
 * second. Throws 401 when neither identifies the caller.
 */
export async function requireAuth(req: IncomingMessage, auth: AuthComponents): Promise<Principal> {
  const bearer = readBearerToken(req);
  if (bearer) {
    if (!auth.supabase)
      throw unauthorizedError("Bearer authentication is not configured on this server.");
    return auth.verifyBearer(bearer);
  }
  const cookie = auth.resolveCookie(req);
  if (cookie) return cookie;
  throw unauthorizedError("Sign in to continue.");
}

/** Require an authenticated principal with exactly the given role. */
export async function requireRole(
  req: IncomingMessage,
  auth: AuthComponents,
  role: AppRole,
): Promise<Principal> {
  const principal = await requireAuth(req, auth);
  if (principal.role !== role)
    throw forbiddenError(`This action requires the ${role} role.`);
  return principal;
}

export const requireTeacherRole = (req: IncomingMessage, auth: AuthComponents) =>
  requireRole(req, auth, "TEACHER");
export const requireAdmin = (req: IncomingMessage, auth: AuthComponents) =>
  requireRole(req, auth, "ADMIN");
export const requireUser = (req: IncomingMessage, auth: AuthComponents) =>
  requireRole(req, auth, "USER");

/** Map an application role onto the legacy two-role model for v1 services. */
export function legacyRoleFor(role: AppRole): "teacher" | "student" {
  return role === "TEACHER" || role === "ADMIN" ? "teacher" : "student";
}

export type { AppUser };
