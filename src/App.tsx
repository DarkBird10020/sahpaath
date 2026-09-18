import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { ArrowRight, BookOpen, Settings2, LogOut, GraduationCap } from "lucide-react";
import { api, okSchema } from "./api";
import {
  lessonSchema,
  publishedSchema,
  sessionSchema,
  type Lesson,
  type Published,
  type Session,
} from "../shared/schema";
import { summarySchema, type Summary } from "../shared/evaluation";
import DiagramStory from "./DiagramStory";
import LandingSections from "./LandingSections";
import { useMotion } from "./motion";
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
  const [summary, setSummary] = useState<Summary | null>(null);
  const [preferences, setPreferences] = useState(() => {
    try {
      return z
        .object({
          contrast: z.boolean(),
          large: z.boolean(),
          spatial: z.boolean(),
          calm: z.boolean().default(false),
        })
        .parse(
          JSON.parse(localStorage.getItem("sahpaath-preferences") || "{}"),
        );
    } catch {
      return { contrast: false, large: false, spatial: false, calm: false };
    }
  });
  const main = useRef<HTMLElement>(null);
  const motion = useMotion(preferences.calm);
  useEffect(() => {
    document.documentElement.dataset.contrast = String(preferences.contrast);
    document.documentElement.dataset.large = String(preferences.large);
    document.documentElement.dataset.calm = String(preferences.calm);
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
  useEffect(() => {
    if (page !== "evaluation" || !session) return;
    let active = true;
    void api("/evaluation/summary", summarySchema)
      .then((value) => {
        if (active) setSummary(value);
      })
      .catch((e) => {
        if (active) setError((e as Error).message);
      });
    return () => {
      active = false;
    };
  }, [page, session]);
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
          {(["contrast", "large", "calm", "spatial"] as const).map((key) => (
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
                  : key === "calm"
                    ? "Calm motion (stop scroll animations)"
                    : "Enable optional 3D concept graph"}
            </label>
          ))}
          <p className="small">
            All features work without 3D or animation. Motion also follows your
            device's reduced-motion setting.
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
            <DiagramStory
              calm={!motion}
              onExplore={() => {
                setLoginRole("student");
                go("explore");
              }}
            />
            <LandingSections
              onExplore={() => {
                setLoginRole("student");
                go("explore");
              }}
              onTeacher={openTeacher}
            />
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
              are not connected. Numbers appear only from recorded actual runs
              {summary ? ` (${summary.runs} recorded)` : ""}.
            </p>
            <div className="metric-grid">
              {(
                [
                  ["Label recall", "labelRecall", true],
                  ["Relationship precision", "relationPrecision", true],
                  ["Relationship recall", "relationRecall", true],
                  ["Flow accuracy", "flowAccuracy", true],
                  ["Grounding rate", "groundingRate", true],
                  ["Teacher correction rate", "teacherCorrectionRate", true],
                  ["Processing latency", "processingMs", false],
                  ["Caption word-error rate", "captionWordErrorRate", false],
                  ["Technical-term accuracy", "technicalTermAccuracy", true],
                  ["Time to phrase", "timeToPhraseMs", false],
                ] as const
              ).map(([label, key, ratio]) => {
                const value = summary?.[key] ?? null;
                return (
                  <article key={label}>
                    <h2>{label}</h2>
                    <p>
                      {value === null
                        ? "Not measured yet."
                        : ratio
                          ? `${Math.round(value * 1000) / 10}%`
                          : `${Math.round(value * 100) / 100} ms`}
                    </p>
                  </article>
                );
              })}
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
      <footer className="site-footer" data-reveal="up">
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
