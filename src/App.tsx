import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { ArrowRight, BookOpen, Captions as CaptionsIcon, Compass, GraduationCap, Headphones, LogOut, MessageSquare, Pin, PinOff, ScanText, Settings2 } from "lucide-react";
import { api, okSchema } from "./api";
import { getAccessToken, supabase, supabaseSignOut } from "./lib/supabase";
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
import { useMotion, useStickyHeader, usePointerLight } from "./motion";
import NavMenu from "./NavMenu";
import Teacher from "./Teacher";
import Account from "./Account";
import ChooseRole from "./ChooseRole";
import Student from "./Student";
import TeacherInbox from "./TeacherInbox";
import ExplainDiagram from "./ExplainDiagram";
import WatchListen from "./WatchListen";

const pages = new Set(["home", "login", "account", "choose-role", "teacher", "explore", "captions", "communicate", "diagram", "watch", "evaluation"]);
const publicPages = new Set(["home", "login", "account", "evaluation"]);
function locationPage() {
  if (new URLSearchParams(location.search).get("auth") === "callback") return "account";
  const value = location.hash.replace(/^#\/?/, "");
  return pages.has(value) ? value : "home";
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [page, updatePage] = useState(locationPage);
  const [sessionReady, setSessionReady] = useState(false);
  const setPage = useCallback((next: string) => {
    if (locationPage() !== next) history.pushState(null, "", `#/${next}`);
    updatePage(next);
  }, []);
  useEffect(() => {
    const sync = () => {
      const hash = location.hash.replace(/^#\/?/, "");
      // In-page anchors (including the skip link) are not application routes.
      if (!hash || pages.has(hash)) updatePage(locationPage());
    };
    addEventListener("popstate", sync);
    addEventListener("hashchange", sync);
    return () => {
      removeEventListener("popstate", sync);
      removeEventListener("hashchange", sync);
    };
  }, []);
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
  // Whether the deployed backend reports its cloud store (DynamoDB) connected;
  // drives the landing-page "demo simulation" vs "cloud" wording honestly.
  const [cloudLive, setCloudLive] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api("/v1/health", z.object({ awsConnected: z.boolean().default(false) }))
      .then((h) => {
        if (!cancelled) setCloudLive(h.awsConnected);
      })
      .catch(() => {
        /* health probe failing is not a landing-page concern */
      });
    return () => {
      cancelled = true;
    };
  }, []);
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
  usePointerLight(motion);
  const [menu, setMenu] = useState(false);
  const closeMenu = useCallback(() => setMenu(false), []);
  useEffect(() => {
    setSettings(false);
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [page]);
  const landing = page === "home";
  // Pinning keeps the landing bar on screen; the choice is remembered per browser.
  const [pinned, setPinned] = useState(() => {
    try {
      return localStorage.getItem("sahpaath:pinned-bar") === "yes";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("sahpaath:pinned-bar", pinned ? "yes" : "no");
    } catch {
      // A browser with storage blocked simply forgets the choice.
    }
  }, [pinned]);
  useStickyHeader(header, motion && landing, pinned);
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
    let active = true;
    const oauthReturn = new URLSearchParams(location.search).get("auth") === "callback";
    void (oauthReturn
      ? getAccessToken().then((token) => token ? api("/session", sessionSchema, "POST", {}) : api("/session", sessionSchema))
      : api("/session", sessionSchema))
      .catch(async (error) => {
        // Email confirmation and refreshed Supabase sessions may arrive without
        // the local classroom cookie. Recreate it from the verified identity.
        if (await getAccessToken()) return api("/session", sessionSchema, "POST", {});
        throw error;
      })
      .then((value) => {
        if (active) {
          setSession(value);
          if (oauthReturn) {
            const destination = value.needsRoleSelection ? "choose-role" : "account";
            history.replaceState(null, "", `${location.pathname}#/${destination}`);
            updatePage(destination);
          }
        }
      })
      .catch((error) => { if (active && oauthReturn) setError(error.message); })
      .finally(() => { if (active) setSessionReady(true); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!sessionReady) return;
    if (session?.needsRoleSelection && page !== "choose-role") {
      setPage("choose-role");
      return;
    }
    if (supabase && page === "login") { setPage("account"); return; }
    if (!session && !publicPages.has(page)) {
      setAfterLogin(page);
      setPage(supabase ? "account" : "login");
    } else if (page === "teacher" && session?.role === "student") {
      setPage("explore");
    }
  }, [page, session, sessionReady, setPage]);
  const refresh = async () => {
    if (!session || session.needsRoleSelection) return;
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
    if (!session || session.needsRoleSelection) return;
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
    setError("");
    if (!publicPages.has(next) && !session) {
      setAfterLogin(next);
      setPage(supabase ? "account" : "login");
    } else setPage(next);
    setTimeout(() => main.current?.focus(), 0);
  }
  async function login() {
    setLoading(true);
    setError("");
    try {
      // Supabase identity, when one exists, opens the classroom from the
      // verified token — the server derives the role from the users table.
      // The local flow below stays exactly as it was for everyone else.
      if (supabase && (await getAccessToken())) {
        const s = await api("/session", sessionSchema, "POST", {});
        setSession(s);
        setPassword("");
        setPage(
          afterLogin && s.role === "teacher"
            ? afterLogin
            : s.role === "teacher"
              ? "teacher"
              : "explore",
        );
        setAfterLogin(null);
        setAnnouncement("Local classroom opened.");
        return;
      }
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
    go(session ? session.needsRoleSelection ? "choose-role" : session.role === "teacher" ? "teacher" : "explore" : supabase ? "account" : "login");
  };
  // Configured accounts authenticate before opening classroom tools.
  async function openTool(next: string) {
    setError("");
    if (!session && supabase) { setAfterLogin(next); setPage("account"); return; }
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
      {/* The landing carries the quiet bar that gets out of the way; every working
          page keeps the plain navigation, where getting somewhere matters more. */}
      <header className={`site-header${landing ? " is-landing" : " is-plain"}${pinned ? " is-pinned-open" : ""}`} ref={header}>
       <div className="header-bar">
        {landing && (
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
        )}
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
        {landing ? (
          <button
            className="icon-button pin-button"
            aria-pressed={pinned}
            aria-label={pinned ? "Unpin the navigation bar" : "Pin the navigation bar"}
            title={pinned ? "Unpin the navigation bar" : "Pin the navigation bar"}
            onClick={() => setPinned((v) => !v)}
          >
            {pinned ? <PinOff size={18} aria-hidden="true" /> : <Pin size={18} aria-hidden="true" />}
          </button>
        ) : (
          <>
            <nav aria-label="Main navigation">
              {session ? (
                <>
                  {session.role === "teacher" && (
                    <button aria-current={page === "teacher" ? "page" : undefined} onClick={() => go("teacher")}>
                      Teacher workspace
                    </button>
                  )}
                  <button aria-current={page === "explore" ? "page" : undefined} onClick={() => go("explore")}>
                    Explore
                  </button>
                  <button aria-current={page === "captions" ? "page" : undefined} onClick={() => go("captions")}>
                    Captions
                  </button>
                  <button aria-current={page === "communicate" ? "page" : undefined} onClick={() => go("communicate")}>
                    Communicate
                  </button>
                  <button aria-current={page === "diagram" ? "page" : undefined} onClick={() => go("diagram")}>
                    Explain a diagram
                  </button>
                  <button aria-current={page === "watch" ? "page" : undefined} onClick={() => go("watch")}>
                    Watch &amp; listen
                  </button>
                  <button aria-current={page === "account" ? "page" : undefined} onClick={() => go("account")}>
                    Account
                  </button>
                </>
              ) : (
                <>
                  <button onClick={() => void openTool("diagram")}>Explain a diagram</button>
                  <button onClick={() => void openTool("watch")}>Watch &amp; listen</button>
                  <button onClick={() => go("evaluation")}>Our approach</button>
                  <button onClick={() => go("account")}>Sign in / Sign up</button>
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
                      await supabaseSignOut();
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
          </>
        )}
       </div>
      </header>
      <NavMenu
        open={menu}
        onClose={closeMenu}
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
                  await supabaseSignOut();
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
                { label: "Account", hint: "Your profile and classroom role.", icon: BookOpen, current: page === "account", run: () => go("account") },
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
                  hint: "Sign in, then choose your classroom role.",
                  icon: GraduationCap,
                  run: openTeacher,
                },
                {
                  label: "Sign in / Sign up",
                  hint: "Use your email to access your account.",
                  icon: BookOpen,
                  run: () => go("account"),
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
            All features work without 3D or animation. Choose Calm motion to
            stop animations throughout the app.
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
            <LandingSections motion={motion} onExplore={() => void openTool("explore")} onTeacher={openTeacher} cloudLive={cloudLive} />
          </>
        )}
        {!sessionReady && page !== "home" && <p role="status">Opening your classroom…</p>}
        {page === "account" && sessionReady && (
          <Account
            session={session}
            onBack={() => go("home")}
            onLocalLogin={() => go("login")}
            onSignedIn={(signedIn) => {
              setSession(signedIn);
              setAnnouncement("Signed in.");
              setPage("choose-role");
            }}
            onSignedOut={() => {
              setSession(null);
              setLessons([]);
              setPublished([]);
              go("home");
              setAnnouncement("Signed out.");
            }}
          />
        )}
        {page === "choose-role" && session && (
          <ChooseRole onContinue={(chosen) => {
            setSession(chosen);
            setLessons([]);
            setSelected("");
            setPage(chosen.role === "teacher" ? "teacher" : "explore");
            setAfterLogin(null);
            setAnnouncement("Your classroom is ready.");
          }} />
        )}
        {page === "login" && !supabase && (
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
              <button type="button" className="link-button" onClick={() => go("account")}>
                Sign in or create an account with email
              </button>
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
        {studentPage && session && !(page === "communicate" && session.role === "teacher") && (
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
        {page === "communicate" && session?.role === "teacher" && (
          <TeacherInbox report={setAnnouncement} />
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
                // The number is the card, not a sentence about the number. With
                // nothing recorded the card shows the shape a figure will take -
                // a dash where it goes, a flat bar under it - instead of saying
                // "Not measured yet." ten times down the grid. The paragraph
                // above the grid already says it once, with the run count.
                return (
                  <article key={label} className={value === null ? "metric is-blank" : "metric"}>
                    <h2>{label}</h2>
                    <p className="metric-value">
                      {value === null ? (
                        <>
                          <span aria-hidden="true">—</span>
                          <span className="sr-only">Not measured yet.</span>
                        </>
                      ) : (
                        <>
                          {ratio ? Math.round(value * 1000) / 10 : Math.round(value * 100) / 100}
                          <span className="metric-unit">{ratio ? "%" : "ms"}</span>
                        </>
                      )}
                    </p>
                    <span
                      className="metric-bar"
                      aria-hidden="true"
                      style={{ "--fill": ratio && value !== null ? `${Math.min(100, value * 100)}%` : "0%" } as React.CSSProperties}
                    />
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
        <span>{cloudLive ? "Cloud edition · Gemini, DynamoDB & S3 connected" : "Local edition · AWS not connected"}</span>
      </footer>
    </>
  );
}
