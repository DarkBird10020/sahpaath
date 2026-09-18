import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  ArrowRight,
  BookOpen,
  Check,
  AudioLines,
  MessageCircle,
  Network,
  Settings2,
  LogOut,
  ShieldCheck,
  GraduationCap,
} from "lucide-react";
import { api, okSchema } from "./api";
import {
  lessonSchema,
  publishedSchema,
  sessionSchema,
  type Lesson,
  type Published,
  type Session,
} from "../shared/schema";
import LessonJourney from "./LessonJourney";
import PathwayEmblem from "./PathwayEmblem";
import Teacher from "./Teacher";
import Student from "./Student";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [page, setPage] = useState("home");
  const [settings, setSettings] = useState(false);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [published, setPublished] = useState<Published[]>([]);
  const [selected, setSelected] = useState("");
  const [studentId, setStudentId] = useState("");
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [loading, setLoading] = useState(false);
  const [loginRole, setLoginRole] = useState<"teacher" | "student">("teacher");
  const [password, setPassword] = useState("");
  const [preferences, setPreferences] = useState(() => {
    try {
      return z
        .object({
          contrast: z.boolean(),
          large: z.boolean(),
          spatial: z.boolean(),
        })
        .parse(
          JSON.parse(localStorage.getItem("sahpaath-preferences") || "{}"),
        );
    } catch {
      return { contrast: false, large: false, spatial: false };
    }
  });
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    document.documentElement.dataset.contrast = String(preferences.contrast);
    document.documentElement.dataset.large = String(preferences.large);
    try {
      localStorage.setItem("sahpaath-preferences", JSON.stringify(preferences));
    } catch {
      /* Preferences still apply if storage is unavailable. */
    }
  }, [preferences]);
  useEffect(() => {
    void api("/session", sessionSchema)
      .then(setSession)
      .catch(() => {});
  }, []);
  const refresh = async () => {
    if (!session) return;
    const pubs = await api("/published", z.array(publishedSchema));
    setPublished(pubs);
    if (session.role === "teacher") {
      const ls = await api("/lessons", z.array(lessonSchema));
      setLessons(ls);
      setSelected((v) => v || ls[0]?.id || "");
    }
  };
  useEffect(() => {
    if (session) void refresh().catch((e) => setError((e as Error).message));
  }, [session]);
  useEffect(() => {
    if (!session) return;
    let active = true;
    const timer = setInterval(() => {
      void api("/published", z.array(publishedSchema))
        .then((value) => {
          if (active) setPublished(value);
        })
        .catch((e) => {
          if (active) setError((e as Error).message);
        });
    }, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [session]);
  function go(next: string) {
    setPage(next);
    setError("");
    if (!["home", "login", "evaluation"].includes(next) && !session)
      setPage("login");
    setTimeout(() => main.current?.focus(), 0);
  }
  async function login() {
    setLoading(true);
    setError("");
    try {
      const s = await api("/session", sessionSchema, "POST", {
        role: loginRole,
        ...(loginRole === "teacher" ? { password } : {}),
      });
      setSession(s);
      setPassword("");
      setPage(loginRole === "teacher" ? "teacher" : "explore");
      setAnnouncement("Local classroom opened.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  const openTeacher = () => {
    setLoginRole("teacher");
    go(session?.role === "teacher" ? "teacher" : "login");
  };
  const studentPage = ["explore", "captions", "communicate"].includes(page);
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <header className="site-header">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            go("home");
          }}
          aria-label="SahPaath home"
        >
          <span className="brand-mark">
            <BookOpen size={23} aria-hidden="true" />
          </span>
          SahPaath<span className="brand-dot">.</span>
        </a>
        <nav aria-label="Main navigation">
          {session ? (
            <>
              {session.role === "teacher" && (
                <button
                  aria-current={page === "teacher" ? "page" : undefined}
                  onClick={() => go("teacher")}
                >
                  Teacher workspace
                </button>
              )}
              <button
                aria-current={page === "explore" ? "page" : undefined}
                onClick={() => go("explore")}
              >
                Explore
              </button>
              <button
                aria-current={page === "captions" ? "page" : undefined}
                onClick={() => go("captions")}
              >
                Captions
              </button>
              <button
                aria-current={page === "communicate" ? "page" : undefined}
                onClick={() => go("communicate")}
              >
                Communicate
              </button>
            </>
          ) : (
            <>
              <a href="#how-it-works" onClick={() => setPage("home")}>
                How it works
              </a>
              <button onClick={() => go("evaluation")}>Our approach</button>
            </>
          )}
        </nav>
        <div className="header-actions">
          <button
            className="icon-button"
            aria-label="Accessibility settings"
            aria-expanded={settings}
            onClick={() => setSettings((v) => !v)}
          >
            <Settings2 size={20} aria-hidden="true" />
          </button>
          {session ? (
            <button
              className="icon-button"
              aria-label="Leave classroom"
              onClick={async () => {
                try {
                  await api("/session", okSchema, "DELETE");
                  setSession(null);
                  setLessons([]);
                  setPublished([]);
                  go("home");
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <LogOut size={19} aria-hidden="true" />
            </button>
          ) : (
            <button className="primary header-cta" onClick={openTeacher}>
              Open classroom <ArrowRight size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      </header>
      {settings && (
        <section className="settings-panel" aria-label="Accessibility settings">
          <h2>Make yourself comfortable</h2>
          {(["contrast", "large", "spatial"] as const).map((key) => (
            <label className="check-label" key={key}>
              <input
                type="checkbox"
                checked={preferences[key]}
                onChange={(e) =>
                  setPreferences({ ...preferences, [key]: e.target.checked })
                }
              />
              {key === "contrast"
                ? "High contrast"
                : key === "large"
                  ? "Larger text"
                  : "Enable optional 3D concept graph"}
            </label>
          ))}
          <p className="small">
            All features work without 3D. Motion follows your device preference.
          </p>
          <button onClick={() => setSettings(false)}>Close settings</button>
        </section>
      )}
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
      <main id="main" ref={main} tabIndex={-1}>
        {error && page !== "login" && (
          <div className="error global-error" role="alert">
            {error}
            <button
              onClick={() =>
                void refresh()
                  .then(() => setError(""))
                  .catch((e) => setError(e.message))
              }
            >
              Retry
            </button>
          </div>
        )}
        {page === "home" && (
          <>
            <LessonJourney
              onExplore={() => {
                setLoginRole("student");
                go("explore");
              }}
            />
            <section className="trust-ribbon" aria-label="Our approach">
              <span>
                <Check size={18} aria-hidden="true" />
                Teacher approval comes first
              </span>
              <span>
                <Network size={18} aria-hidden="true" />
                One vocabulary, everywhere
              </span>
              <span>
                <BookOpen size={18} aria-hidden="true" />
                Keyboard & text pathways
              </span>
            </section>
            <section id="how-it-works" className="how-section">
              <div className="section-heading">
                <span className="section-kicker">
                  A thoughtful path from lesson to learner
                </span>
                <h2>
                  Different ways in.
                  <br />
                  The same place to belong.
                </h2>
                <p>
                  A diagram becomes a structured lesson. Your teacher checks the
                  concepts. You choose how to engage.
                </p>
              </div>
              <div className="pathway-features">
                <article>
                  <PathwayEmblem kind="explore" />
                  <h3>Explore, one concept at a time.</h3>
                  <p>
                    Follow a diagram through its parts and connections. Read,
                    listen, or use the keyboard to move at your pace.
                  </p>
                  <button onClick={() => go("explore")}>
                    Open Diagram Explorer{" "}
                    <ArrowRight size={17} aria-hidden="true" />
                  </button>
                </article>
                <article>
                  <PathwayEmblem kind="read" />
                  <h3>Keep the words within reach.</h3>
                  <p>
                    Read classroom transcripts and open a definition without
                    losing your place. Every highlighted term belongs to the
                    approved lesson.
                  </p>
                  <button onClick={() => go("captions")}>
                    Open ClassCaption{" "}
                    <ArrowRight size={17} aria-hidden="true" />
                  </button>
                </article>
                <article>
                  <PathwayEmblem kind="ask" />
                  <h3>A question is a way in, too.</h3>
                  <p>
                    Ask for a little more time, a repeat, or help with a
                    specific concept. Your words arrive with their context.
                  </p>
                  <button onClick={() => go("communicate")}>
                    Open Communication{" "}
                    <ArrowRight size={17} aria-hidden="true" />
                  </button>
                </article>
              </div>
            </section>
            <section className="teacher-story">
              <div>
                <span className="section-kicker">
                  Built around a teacher’s judgment
                </span>
                <h2>
                  Technology proposes.
                  <br />
                  You make it a lesson.
                </h2>
                <p>
                  A valid structure is just the beginning. Check the source,
                  make corrections, and decide what students see. Published
                  versions stay intact.
                </p>
                <button className="primary" onClick={openTeacher}>
                  Try the teacher workspace{" "}
                  <ArrowRight size={18} aria-hidden="true" />
                </button>
              </div>
              <div className="trust-example">
                <span className="small">
                  A concept, shared across the classroom
                </span>
                <div className="example-term">
                  <span className="status teacher_approved">
                    <Check size={15} aria-hidden="true" />
                    Illustrative teacher approval
                  </span>
                  <h3>Pulmonary artery</h3>
                  <p>
                    One canonical term connects its description, diagram and
                    student questions.
                  </p>
                </div>
                <div className="example-surfaces">
                  <span>Explorer</span>
                  <span>Glossary</span>
                  <span>Captions</span>
                  <span>Questions</span>
                </div>
                <small>
                  Illustration of the workflow. Create and approve your own
                  local lesson to try it.
                </small>
              </div>
            </section>
            <section className="closing">
              <img
                className="classroom-art"
                src="/assets/shared-classroom.png"
                width="1344"
                height="752"
                loading="lazy"
                alt=""
              />
              <div className="closing-copy">
                <h2>One lesson. Multiple ways in.</h2>
                <p>No student left outside the lesson.</p>
                <button className="primary" onClick={openTeacher}>
                  Start with a lesson{" "}
                  <ArrowRight size={18} aria-hidden="true" />
                </button>
                <small className="art-credit">
                  Classroom artwork generated with Higgsfield.
                </small>
              </div>
            </section>
          </>
        )}
        {page === "login" && (
          <section className="login-page">
            <div className="login-copy">
              <GraduationCap size={42} aria-hidden="true" />
              <h1>A shared lesson starts here.</h1>
              <p>
                This classroom runs on your computer. No AWS account, student
                name, or email is needed.
              </p>
              <div className="local-note">
                <strong>Local development edition</strong>
                <p>
                  Teacher access uses a local password. Student sessions only
                  receive published lessons. This is not a production identity
                  system.
                </p>
              </div>
            </div>
            <form
              className="login-form"
              onSubmit={(e) => {
                e.preventDefault();
                void login();
              }}
            >
              <h2>Open your classroom</h2>
              <fieldset>
                <legend>Choose your role</legend>
                <div className="role-options">
                  {(["teacher", "student"] as const).map((role) => (
                    <label key={role}>
                      <input
                        type="radio"
                        name="role"
                        value={role}
                        checked={loginRole === role}
                        onChange={() => setLoginRole(role)}
                      />
                      {role === "teacher"
                        ? "I’m a teacher"
                        : "I’m a student"}
                    </label>
                  ))}
                </div>
              </fieldset>
              {loginRole === "teacher" && (
                <label>
                  Local teacher password
                  <input
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    aria-describedby="password-help login-error"
                    aria-invalid={!!error}
                  />
                  <span id="password-help" className="small">
                    Default for local development: <code>sahpaath-local</code>.
                    Change it in your .env file.
                  </span>
                </label>
              )}
              <p id="login-error" className={error ? "error" : ""} role="alert">
                {error}
              </p>
              <button className="primary" disabled={loading}>
                {loading ? "Opening classroom…" : "Enter classroom"}
                <ArrowRight size={18} aria-hidden="true" />
              </button>
            </form>
          </section>
        )}
        {page === "teacher" && session?.role === "teacher" && (
          <Teacher
            lessons={lessons}
            selected={selected}
            onSelect={setSelected}
            onChange={refresh}
            report={setAnnouncement}
            onExplore={(id) => {
              setStudentId(id);
              go("explore");
            }}
          />
        )}
        {studentPage && session && (
          <Student
            lessons={published}
            lessonId={studentId}
            setLessonId={setStudentId}
            page={page}
            go={go}
            session={session}
            report={setAnnouncement}
            spatial={preferences.spatial}
          />
        )}
        {page === "evaluation" && (
          <section className="workspace evaluation">
            <span className="section-kicker">Evidence before claims</span>
            <h1>Measured, not imagined.</h1>
            <p>
              Local review and publishing are real. OCR and model proposals for
              sample diagrams are labeled simulations. AWS and live recognition
              are not connected.
            </p>
            <div className="metric-grid">
              {[
                "Label recall",
                "Relationship precision / recall",
                "Flow accuracy",
                "Grounding rate",
                "Teacher correction rate",
                "Cloud processing latency",
                "Caption word-error rate",
                "Technical-term accuracy",
                "Time to phrase",
              ].map((m) => (
                <article key={m}>
                  <h2>{m}</h2>
                  <p>Not measured yet.</p>
                </article>
              ))}
            </div>
            <p>
              Internal evaluation tooling accepts actual run files. Fixture
              tests check software behavior; they do not measure AI accuracy or
              student outcomes.
            </p>
            <button onClick={() => go("home")}>Back to SahPaath</button>
          </section>
        )}
      </main>
      <footer className="site-footer">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            go("home");
          }}
        >
          SahPaath<span className="brand-dot">.</span>
        </a>
        <p>Same lesson. Your way in.</p>
        <button onClick={() => go("evaluation")}>Evidence & limitations</button>
        <span>Local edition · AWS not connected</span>
      </footer>
    </>
  );
}
