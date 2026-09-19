/**
 * Supabase Auth client (frontend side).
 *
 * Supabase remains the ONLY authentication provider: it owns signup, login,
 * logout, and session tokens. This module never handles passwords itself —
 * it delegates everything to the Supabase JS SDK.
 *
 * Enabled only when VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY are present
 * (the publishable/anon key is public by design; it is safe in frontend code).
 * When absent, the app falls back to the existing local classroom flow with
 * zero behaviour change.
 */
import { createClient, type SupabaseClient, type Session } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Null when Supabase is not configured — callers fall back to local flow. */
export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null;

/** Current Supabase auth session, or null (also null when not configured). */
export async function getSupabaseSession(): Promise<Session | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) return null;
  return data.session;
}

/** Access token for `Authorization: Bearer ...`, or null when signed out. */
export async function getAccessToken(): Promise<string | null> {
  return (await getSupabaseSession())?.access_token ?? null;
}

/** Sign out of Supabase (no-op when not configured). */
export async function supabaseSignOut(): Promise<void> {
  if (supabase) {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }
}

/** Sign up with email + password through Supabase (never our backend). */
export async function supabaseSignUp(email: string, password: string) {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}/#/account` } });
}

/** Sign in with email + password through Supabase (never our backend). */
export async function supabaseSignIn(email: string, password: string) {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase.auth.signInWithPassword({ email, password });
}

export async function supabaseSignInWithGoogle() {
  if (!supabase || !url || !anonKey) throw new Error("Sign-in is not configured yet.");
  const response = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: anonKey } });
  if (!response.ok) throw new Error("Could not reach sign-in. Please try again.");
  const settings = await response.json();
  if (!settings.external?.google) throw new Error("Google sign-in is not available yet. Please use email sign-in for now.");
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${location.origin}/?auth=callback` },
  });
  if (error) throw error;
}
