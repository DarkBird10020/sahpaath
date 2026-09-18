import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { ArrowRight, BookOpen, Captions as CaptionsIcon, Compass, GraduationCap, Headphones, MessageSquare, ScanText } from "lucide-react";
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
import { useMotion, useStickyHeader } from "./motion";
import NavMenu from "./NavMenu";
import Teacher from "./Teacher";
import Student from "./Student";
import ExplainDiagram from "./ExplainDiagram";
import WatchListen from "./WatchListen";

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
  // Where to go after logging in, when a visitor picked a page first.
  const [afterLogin, setAfterLogin] = useState<string | null>(null);
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
  const header = useRef<HTMLElement>(null);
  const motion = useMotion(preferences.calm);
  useStickyHeader(header, motion);
  const [menu, setMenu] = useState(false);
  // Escape closes the settings card, like the menu.
  useEffect(() => {
    if (!settings) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSettings(false);
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [settings]);
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
    if (!["home", "login", "evaluation"].includes(next) && !session) {
      setAfterLogin(next);
      setPage("login");
    }
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
      setPage(afterLogin && (afterLogin !== "teacher" || loginRole === "teacher") ? afterLogin : loginRole === "teacher" ? "teacher" : "explore");
      setAfterLogin(null);
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
  /**
   * The learner tools open straight away. Only "Open classroom" asks who you are:
   * a visitor who wants a diagram explained gets a student session in the
   * background instead of a login form in the way.
   */
  async function openTool(next: string) {
    setError("");
    if (!session) {
      try {
        setSession(await api("/session", sessionSchema, "POST", { role: "student" }));
      } catch (e) {
        // Only if that fails does the visitor see the sign-in page.
        setLoginRole("student");
        setAfterLogin(next);
        setPage("login");
        setError((e as Error).message);
        return;
      }
    }
    setPage(next);
    setTimeout(() => main.current?.focus(), 0);
  }
  const studentPage = ["explore", "captions", "communicate"].includes(page);
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <header className="site-header" ref={header}>
       <div className="header-bar">
        <button
          className="menu-button"
          aria-label="Menu"
          aria-expanded={menu}
          onClick={() => setMenu(true)}
        >
          <span className="menu-lines" aria-hidden="true" />
          <span className="menu-word" aria-hidden="true">
            Menu
          </span>
        </button>
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
       </div>
      </header>
      <NavMenu
        open={menu}
        onClose={() => setMenu(false)}
        onHome={() => {
          const already = page === "home";
          if (!already) setPage("home");
          return already;
        }}
        settingsOpen={() => setSettings(true)}
        signOut={
          session
            ? async () => {
                try {
                  await api("/session", okSchema, "DELETE");
                  setSession(null);
                  setLessons([]);
                  setPublished([]);
                  go("home");
                } catch (e) {
                  setError((e as Error).message);
                }
              }
            : undefined
        }
        actions={
          session
            ? [
                ...(session.role === "teacher"
                  ? [
                      {
                        label: "Teacher workspace",
                        hint: "Review, approve and publish your lessons.",
                        icon: GraduationCap,
                        current: page === "teacher",
                        run: () => go("teacher"),
                      },
                    ]
                  : []),
                { label: "Explore", hint: "The lesson, part by part.", icon: Compass, current: page === "explore", run: () => go("explore") },
                { label: "Captions", hint: "Live captions with the class glossary.", icon: CaptionsIcon, current: page === "captions", run: () => go("captions") },
                { label: "Communicate", hint: "Ask without speaking.", icon: MessageSquare, current: page === "communicate", run: () => go("communicate") },
                { label: "Explain a diagram", hint: "Upload a picture and explore it.", icon: ScanText, current: page === "diagram", run: () => go("diagram") },
                { label: "Watch & listen", hint: "Captions for a lecture or audiobook.", icon: Headphones, current: page === "watch", run: () => go("watch") },
              ]
            : [
                {
                  label: "Explain a diagram",
                  hint: "Upload a picture from a book and explore it part by part.",
                  icon: ScanText,
                  run: () => void openTool("diagram"),
                },
                {
                  label: "Watch & listen",
                  hint: "Captions for a lecture or audiobook, with the hard words explained.",
                  icon: CaptionsIcon,
                  run: () => void openTool("watch"),
                },
                {
                  label: "Our approach",
                  hint: "What the system checks, and what it still gets wrong.",
                  icon: Compass,
                  run: () => go("evaluation"),
                },
                {
                  label: "Open classroom",
                  hint: "Sign in as a teacher or a student.",
                  icon: GraduationCap,
                  run: openTeacher,
                },
              ]
        }
      />
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
      {/* The landing runs under the header, so its own colour reaches the top of the
          window; every other page starts below the bar. */}
      <main id="main" ref={main} tabIndex={-1} className={page === "home" ? "under-header" : ""}>
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
            <DiagramStory calm={!motion} onExplore={() => void openTool("explore")} />
            <LandingSections motion={motion} onExplore={() => void openTool("explore")} onTeacher={openTeacher} />
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
        {page === "diagram" && session && <ExplainDiagram report={setAnnouncement} />}
        {page === "watch" && session && <WatchListen report={setAnnouncement} />}
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
