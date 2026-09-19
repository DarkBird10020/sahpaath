import { useState } from "react";
import { supabaseSignInWithGoogle } from "./lib/supabase";

export default function GoogleSignIn() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function signIn() {
    setBusy(true);
    setError("");
    try {
      await supabaseSignInWithGoogle();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not open Google sign-in. Please try again.");
      setBusy(false);
    }
  }
  return <div className="google-signin">
    <button type="button" className="google-button" disabled={busy} onClick={() => void signIn()}>
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z" />
        <path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.04.97-3.38.97-2.6 0-4.8-1.76-5.59-4.12H3.07v2.59A10 10 0 0 0 12 22Z" />
        <path fill="#FBBC05" d="M6.41 13.93a6 6 0 0 1 0-3.86V7.48H3.07a10 10 0 0 0 0 9.04l3.34-2.59Z" />
        <path fill="#EA4335" d="M12 5.95c1.47 0 2.79.5 3.83 1.5l2.88-2.88A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.93 5.48l3.34 2.59A6 6 0 0 1 12 5.95Z" />
      </svg>
      {busy ? "Opening Google…" : "Continue with Google"}
    </button>
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}
