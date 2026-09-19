import { useEffect, useState } from "react";
import GoogleSignIn from "./GoogleSignIn";
import {
  ArrowLeft,
  GraduationCap,
  LogOut,
  Mail,
  ShieldCheck,
  User as UserIcon,
} from "lucide-react";
import { z } from "zod";
import { api, okSchema } from "./api";
import { Spinner } from "./Working";
import { sessionSchema, type Session } from "../shared/schema";
import {
  supabase,
  supabaseSignIn,
  supabaseSignOut,
  supabaseSignUp,
} from "./lib/supabase";

/** The signed-in account, from GET /v1/me. */
const meSchema = z.object({
  kind: z.enum(["app", "local"]),
  user: z
    .object({
      id: z.string(),
      supabaseUserId: z.string(),
      email: z.string(),
      name: z.string(),
      role: z.enum(["ADMIN", "TEACHER", "USER"]),
      createdAt: z.string(),
      updatedAt: z.string(),
    })
    .nullable(),
  supabaseConfigured: z.boolean(),
});
type Me = z.infer<typeof meSchema>;

const ROLE_HINTS: Record<string, string> = {
  ADMIN: "Manages people and roles across the classroom.",
  TEACHER: "Creates lessons, reviews AI work, and publishes.",
  USER: "Learns: published lessons, captions, and questions.",
};

/**
 * The account dashboard: who is signed in, with what role, and the way out.
 * Supabase identities show their application profile; local classroom
 * sessions show their role and class code. When Supabase is configured but
 * nobody is signed in, it offers the sign-in/sign-up form (email + password,
 * handled entirely by Supabase Auth — this app never sees the password).
 */
export default function Account({
  session,
  onBack,
  onLocalLogin,
  onSignedIn,
  onSignedOut,
  initialMode = "signin",
}: {
  session: Session | null;
  onBack: () => void;
  onLocalLogin: () => void;
  onSignedIn: (session: Session) => void | Promise<void>;
  onSignedOut: () => void;
  initialMode?: "signin" | "signup";
}) {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [showEmail, setShowEmail] = useState(false);

  useEffect(() => {
    let active = true;
    setMe(null);
    if (!session) return;
    void api("/v1/me", meSchema)
      .then((value) => { if (active) setMe(value); })
      .catch((e) => { if (active) setError((e as Error).message); });
    return () => { active = false; };
  }, [session]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const fn = mode === "signin" ? supabaseSignIn : supabaseSignUp;
      const { data, error: authError } = await fn(email.trim(), password);
      if (authError) throw authError;
      if (mode === "signup" && !data.session) {
        setNotice("Account created. Check your email to confirm, then sign in.");
      } else {
        const classroom = await api("/session", sessionSchema, "POST", {});
        await onSignedIn(classroom);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    setError("");
    try {
      await api("/v1/session", okSchema, "DELETE");
      await supabaseSignOut();
      onSignedOut();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const appUser = me?.user ?? null;

  return (
    <section className="login-page account-page">
      <div className="login-copy">
        <UserIcon size={42} aria-hidden="true" />
        <h1>Your account.</h1>
        <p>
          {supabase
            ? "Sign in with your email. Passwords are handled by Supabase Auth — this classroom never sees them."
            : "This classroom currently runs on local sessions. Supabase sign-in activates when the server is configured for it."}
        </p>
        {session && (
          <div className="local-note">
            <strong>Session</strong>
            <p>
              Signed in{appUser ? " with Supabase" : " locally"} as{" "}
              {appUser?.role.toLowerCase() ?? session.role}
              {appUser ? "" : ` · class code ${session.code}`}.
            </p>
          </div>
        )}
      </div>

      <div className="login-form account-card">
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {session && !me && !error ? (
          <p role="status">Loading your account…</p>
        ) : appUser ? (
          <>
            <h2>{appUser.name || "Classroom member"}</h2>
            <ul className="account-details">
              <li>
                <Mail size={16} aria-hidden="true" />
                {appUser.email || "No email on file"}
              </li>
              <li>
                <ShieldCheck size={16} aria-hidden="true" />
                <span>
                  Role: <strong>{appUser.role}</strong> — {ROLE_HINTS[appUser.role]}
                </span>
              </li>
            </ul>
            <button className="primary" disabled={busy} onClick={() => void signOut()}>
              <LogOut size={18} aria-hidden="true" /> Sign out
            </button>
          </>
        ) : session && !showEmail ? (
          <>
            <h2>Local classroom session</h2>
            <ul className="account-details">
              <li>
                <GraduationCap size={16} aria-hidden="true" />
                <span>
                  Role: <strong>{session.role === "teacher" ? "teacher" : "student"}</strong>
                </span>
              </li>
              <li>
                <ShieldCheck size={16} aria-hidden="true" />
                <span>Anonymous class code: {session.code}</span>
              </li>
            </ul>
            {supabase && (
              <button className="link-button" onClick={() => setShowEmail(true)}>
                Sign in or create an account with email
              </button>
            )}
            <button className="primary" disabled={busy} onClick={() => void signOut()}>
              <LogOut size={18} aria-hidden="true" /> Sign out
            </button>
          </>
        ) : supabase ? (
          <>
            <h2>{mode === "signin" ? "Sign in" : "Create your account"}</h2>
            <GoogleSignIn />
            <p className="auth-divider">or continue with email</p>
            <form
              onSubmit={(e) => void submit(e)}
              className="account-auth-form"
              aria-label={mode === "signin" ? "Sign in" : "Sign up"}
            >
              <label>
                Email
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label>
                <span id="account-password-label">Password</span>
                <input
                  type="password"
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  required
                  minLength={mode === "signup" ? 8 : undefined}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-labelledby="account-password-label"
                  aria-describedby="account-password-help account-auth-error"
                />
                <span className="small" id="account-password-help">
                  {mode === "signup" ? "At least 8 characters." : "Your Supabase password."}
                </span>
              </label>
              <p id="account-auth-error" className={error ? "error" : ""} role="alert">
                {error}
              </p>
              {notice && <p className="small">{notice}</p>}
              <button className="primary" disabled={busy}>
                {busy && <Spinner />}
                {busy ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}
              </button>
            </form>
            <button
              className="link-button"
              disabled={busy}
              onClick={() => {
                setMode(mode === "signin" ? "signup" : "signin");
                setError("");
                setNotice("");
              }}
            >
              {mode === "signin"
                ? "New here? Create an account"
                : "Already have an account? Sign in"}
            </button>
          </>
        ) : (
          <>
            <h2>Email sign-in is not configured</h2>
            <p className="small">
              Supabase authentication is not configured on this server. Use the
              local classroom sign-in to open the workspace; roles and lessons
              work exactly as before.
            </p>
            <button className="primary" onClick={onLocalLogin}>Open local classroom</button>
          </>
        )}
        <button className="link-button" onClick={onBack}>
          <ArrowLeft size={14} aria-hidden="true" /> Back
        </button>
      </div>
    </section>
  );
}
