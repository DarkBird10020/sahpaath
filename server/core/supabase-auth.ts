/**
 * Supabase Auth token verification (backend-only).
 *
 * Verification uses the project's PUBLIC JWKS (SUPABASE_JWKS_URL) — the
 * Supabase secret key is never read for verification, never needed, and
 * never logged here. Access tokens are issued by Supabase Auth; this module
 * only answers "is this token a genuine, current access token of this
 * project?" The application role is NOT read from the token: it always comes
 * from the application users table (see store.ts).
 *
 * No password handling exists in this file: Supabase Auth owns credentials.
 */

import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import { unauthorizedError } from "../http/http-errors";

export interface SupabaseAuthConfig {
  projectUrl: string;
  jwksUrl: string;
  audience: string;
  /** Publishable (anon) key, sent as `apikey` when fetching JWKS. Public by design. */
  publishableKey?: string;
}

/** Read Supabase auth config; null when Supabase auth is not configured. */
export function readSupabaseAuthConfig(env: NodeJS.ProcessEnv): SupabaseAuthConfig | null {
  const projectUrl = env.SUPABASE_URL?.trim().replace(/\/$/, "") || "";
  const jwksUrl = env.SUPABASE_JWKS_URL?.trim() || `${projectUrl}/auth/v1/.well-known/jwks.json`;
  // The publishable key is PUBLIC (safe to expose); the secret key is never
  // read here — verification needs no secret.
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY?.trim() || undefined;
  if (!projectUrl) return null;
  let parsed: URL;
  try {
    parsed = new URL(projectUrl);
  } catch {
    throw new Error("SUPABASE_URL is not a valid URL.");
  }
  if (parsed.protocol !== "https:")
    throw new Error("SUPABASE_URL must use https.");
  // The JWKS endpoint must belong to the configured Supabase project.
  // Loopback URLs are permitted for the test suite (a local JWKS stand-in);
  // production configuration always uses the project host below.
  const loopback = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(jwksUrl);
  if (!loopback && new URL(jwksUrl).origin !== parsed.origin)
    throw new Error("SUPABASE_JWKS_URL does not match the SUPABASE_URL project.");
  return { projectUrl, jwksUrl, audience: "authenticated", publishableKey };
}

interface Jwk {
  kty: string;
  crv?: string;
  n?: string;
  e?: string;
  x?: string;
  y?: string;
  kid?: string;
  alg?: string;
  use?: string;
}

/** Small JWKS cache with TTL + single-flight refresh. */
class JwksCache {
  private keys: Jwk[] = [];
  private fetchedAt = 0;
  private inflight: Promise<Jwk[]> | null = null;
  private static readonly TTL_MS = 10 * 60 * 1000;

  constructor(
    private readonly url: string,
    private readonly publishableKey: string | undefined,
  ) {}

  async get(kid: string | undefined): Promise<Jwk | null> {
    let refreshed = false;
    if (!this.keys.length || Date.now() - this.fetchedAt > JwksCache.TTL_MS) {
      this.inflight ??= this.fetch().finally(() => (this.inflight = null));
      this.keys = await this.inflight;
      refreshed = true;
    }
    if (kid) {
      const byKid = this.keys.find((k) => k.kid === kid);
      if (byKid) return byKid;
      // Unknown kid: force one refresh before giving up (key rotation).
      if (!refreshed) {
        this.inflight ??= this.fetch().finally(() => (this.inflight = null));
        this.keys = await this.inflight;
      }
      return this.keys.find((key) => key.kid === kid) ?? null;
    }
    return this.keys.length === 1 ? this.keys[0] : null;
  }

  private async fetch(): Promise<Jwk[]> {
    const res = await fetch(this.url, {
      // Supabase gate JWKS behind the publishable (anon) key: requests
      // without an `apikey` header get 401. The publishable key is public
      // by design; it identifies a request and is never a secret.
      headers: {
        accept: "application/json",
        ...(this.publishableKey ? { apikey: this.publishableKey } : {}),
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw unauthorizedError("Authentication is temporarily unavailable.");
    const body = (await res.json()) as { keys?: Jwk[] };
    const keys = Array.isArray(body.keys) ? body.keys : [];
    this.fetchedAt = Date.now();
    return keys;
  }
}

function b64urlToBuffer(part: string): Buffer {
  return Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function b64urlToString(part: string): string {
  return b64urlToBuffer(part).toString("utf8");
}

function jwkToKey(jwk: Jwk): ReturnType<typeof createPublicKey> | null {
  try {
    const key = createPublicKey({ key: jwk as unknown as Record<string, string>, format: "jwk" });
    return key;
  } catch {
    return null;
  }
}

export interface SupabaseIdentity {
  supabaseUserId: string;
  email: string | null;
}

/**
 * Verify a Supabase access token (signature via JWKS, expiry, issuer,
 * audience) and return the identity it carries. Throws 401-flavoured
 * AppErrors on every failure mode; never returns a token or secret.
 */
export async function verifySupabaseToken(
  token: string,
  config: SupabaseAuthConfig,
  jwks: JwksCache,
): Promise<SupabaseIdentity> {
  const parts = token.split(".");
  if (parts.length !== 3) throw unauthorizedError("Invalid authentication token.");
  const [headB64, payloadB64, sigB64] = parts;

  let header: { alg?: string; kid?: string; typ?: string };
  let payload: { sub?: string; email?: string; exp?: number; iss?: string; aud?: string | string[]; role?: string };
  try {
    header = JSON.parse(b64urlToString(headB64));
    payload = JSON.parse(b64urlToString(payloadB64));
  } catch {
    throw unauthorizedError("Invalid authentication token.");
  }
  if (!header || !payload || typeof header !== "object" || typeof payload !== "object")
    throw unauthorizedError("Invalid authentication token.");
  if (payload.role && payload.role !== "authenticated")
    throw unauthorizedError("This token is not a user access token.");

  const expectedIss = `${config.projectUrl}/auth/v1`;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= nowSeconds)
    throw unauthorizedError("Your session has expired. Sign in again.");
  if (payload.iss !== expectedIss)
    throw unauthorizedError("Invalid authentication token.");
  const aud = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
  if (!aud.includes(config.audience))
    throw unauthorizedError("Invalid authentication token.");

  // Algorithm allowlist pinned to what Supabase issues (ES256 / RS256).
  // Anything else — including "none" — is rejected before any key work.
  const alg = header.alg;
  if (alg !== "ES256" && alg !== "RS256")
    throw unauthorizedError("Invalid authentication token.");
  const jwk = await jwks.get(header.kid);
  if (!jwk) throw unauthorizedError("Invalid authentication token.");
  if ((jwk.alg && jwk.alg !== alg) || (alg === "ES256" ? jwk.kty !== "EC" || jwk.crv !== "P-256" : jwk.kty !== "RSA"))
    throw unauthorizedError("Invalid authentication token.");
  // node:crypto.verify takes the message digest; the key type selects ECDSA
  // vs RSA. Both Supabase algorithms hash with SHA-256.
  const digest = alg === "ES256" || alg === "RS256" ? "SHA256" : null;
  if (!digest) throw unauthorizedError("Invalid authentication token.");
  const key = jwkToKey(jwk);
  if (!key) throw unauthorizedError("Invalid authentication token.");
  const signed = Buffer.from(`${headB64}.${payloadB64}`, "utf8");
  const signature = b64urlToBuffer(sigB64);
  let ok = false;
  try {
    ok = cryptoVerify(digest, signed, alg === "ES256" ? { key, dsaEncoding: "ieee-p1363" } : key, signature);
  } catch {
    ok = false;
  }
  if (!ok || typeof payload.sub !== "string" || !payload.sub)
    throw unauthorizedError("Invalid authentication token.");
  return { supabaseUserId: payload.sub, email: payload.email ?? null };
}

export function createJwksCache(config: SupabaseAuthConfig): JwksCache {
  return new JwksCache(config.jwksUrl, config.publishableKey);
}
