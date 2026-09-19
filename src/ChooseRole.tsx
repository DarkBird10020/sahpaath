import { useState } from "react";
import { BookOpen, GraduationCap, ArrowRight } from "lucide-react";
import { api } from "./api";
import { sessionSchema, type Session } from "../shared/schema";

export default function ChooseRole({ onContinue }: { onContinue: (session: Session) => void }) {
  const [role, setRole] = useState<"teacher" | "student" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    if (!role || busy) return;
    setBusy(true);
    setError("");
    try { onContinue(await api("/session", sessionSchema, "POST", { role })); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="login-page role-page">
    <div className="login-copy">
      <BookOpen size={42} aria-hidden="true" />
      <span className="section-kicker">Step 2 of 2 · Signed in</span>
      <h1>How will you use SahPaath?</h1>
      <p>Choose your role to open your classroom.</p>
    </div>
    <form className="login-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <h2>Choose your role</h2>
      <fieldset className="onboarding-roles" disabled={busy}>
        <legend>I am joining as</legend>
        <label><input type="radio" name="classroom-role" checked={role === "teacher"} onChange={() => setRole("teacher")} />
          <GraduationCap size={24} aria-hidden="true" /><span>I'm a teacher<small>Create lessons, review diagrams, and teach your class.</small></span></label>
        <label><input type="radio" name="classroom-role" checked={role === "student"} onChange={() => setRole("student")} />
          <BookOpen size={24} aria-hidden="true" /><span>I'm a student<small>Explore lessons, follow captions, and ask questions.</small></span></label>
      </fieldset>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary" disabled={!role || busy}>{busy ? "Opening classroom…" : "Continue to dashboard"}<ArrowRight size={18} aria-hidden="true" /></button>
    </form>
  </section>;
}
