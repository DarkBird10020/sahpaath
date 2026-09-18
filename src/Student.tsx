import { lazy, Suspense, useEffect, useState } from "react";
import { z } from "zod";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  MessageCircle,
  Send,
  Search,
  Network,
  BookOpen,
  Download,
} from "lucide-react";
import { api } from "./api";
import Captions from "./Captions";
import CaptionCorrection from "./CaptionCorrection";
import { vocabularyPattern } from "../shared/vocabulary";
import {
  captionSchema,
  phrases,
  questionSchema,
  type Caption,
  type Published,
  type Session,
} from "../shared/schema";
import {
  ConceptTree,
  Diagram,
  Empty,
  Speak,
  Status,
  SurfaceList,
} from "./components";

const SpatialGraph = lazy(() => import("./SpatialGraph"));
type Props = {
  lessons: Published[];
  lessonId: string;
  setLessonId: (id: string) => void;
  page: string;
  go: (page: string) => void;
  session: Session;
  report: (message: string) => void;
  spatial: boolean;
};
export default function Student({
  lessons,
  lessonId,
  setLessonId,
  page,
  go,
  session,
  report,
  spatial,
}: Props) {
  const lesson = lessons.find((l) => l.lessonId === lessonId) || lessons[0];
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState("");
  const [sent, setSent] = useState("");
  useEffect(() => {
    setSelected(lesson?.map.parts[0]?.id || "");
    setError("");
    setSent("");
  }, [lesson?.lessonId, lesson?.version]);
  const part =
    lesson?.map.parts.find((p) => p.id === selected) || lesson?.map.parts[0];
  const position = lesson?.map.parts.findIndex((p) => p.id === part?.id) ?? 0;
  const flow = lesson?.map.flows.find((f) => f.steps.includes(part?.id || ""));
  const incoming =
    lesson?.map.relations
      .filter((r) => r.to === part?.id)
      .map((r) => lesson.map.parts.find((p) => p.id === r.from)?.name)
      .filter(Boolean) || [];
  const description = part
    ? `${part.name}. ${flow ? `Step ${flow.steps.indexOf(part.id) + 1} of ${flow.steps.length}, ${flow.name}. ` : `Concept ${position + 1} of ${lesson.map.parts.length}. `}${part.description}${incoming.length ? ` Receives a connection from ${incoming.join(", ")}.` : ""}`
    : "";
  async function send(text: string, anchored: boolean) {
    if (!lesson) return;
    setError("");
    setBusy(true);
    try {
      await api("/questions", questionSchema, "POST", {
        lessonId: lesson.lessonId,
        version: lesson.version,
        conceptId: anchored ? part.id : null,
        text,
      });
      setSent(text);
      setCustom("");
      report("Question sent to the teacher’s local inbox.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!lesson)
    return (
      <div className="workspace">
        <Empty title="Your lesson is waiting for its teacher">
          No approved lesson has been published yet. Open the teacher workspace,
          review a map, and publish it first.
        </Empty>
      </div>
    );
  return (
    <div className="workspace student-workspace">
      <div className="student-top">
        <div>
          <span className="section-kicker">
            {page === "captions"
              ? "ClassCaption"
              : page === "communicate"
                ? "Classroom communication"
                : "Diagram Explorer"}
          </span>
          <h1>
            {page === "communicate"
              ? "Your question belongs here."
              : page === "captions"
                ? "Follow the lesson. Find your words."
                : "A lesson, at your pace."}
          </h1>
        </div>
        <label className="lesson-picker">
          Published lesson
          <select
            value={lesson.lessonId}
            onChange={(e) => setLessonId(e.target.value)}
          >
            {lessons.map((l) => (
              <option value={l.lessonId} key={l.lessonId}>
                {l.title} · v{l.version}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="student-lesson-bar">
        <BookOpen aria-hidden="true" />
        <strong>{lesson.title}</strong>
        <Status state="teacher_approved" />
        <span className="small">Version {lesson.version}</span>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
          <button onClick={() => setError("")}>Dismiss</button>
        </div>
      )}
      {page === "explore" && (
        <>
          <div className="explorer-layout">
            <aside className="tree-panel">
              <h2>Explore the concepts</h2>
              <ConceptTree
                key={`${lesson.lessonId}-${lesson.version}`}
                lesson={lesson}
                selected={part.id}
                onSelect={setSelected}
              />
            </aside>
            <section className="concept-panel" aria-label="Selected concept">
              <span className="section-kicker">
                Concept {position + 1} of {lesson.map.parts.length}
              </span>
              <h2>{part.name}</h2>
              <p className="concept-description">{part.description}</p>
              <Speak text={description} />
              <div className="sr-only" role="status" aria-live="polite">
                {description}
              </div>
              <div className="connections">
                <h3>Connected concepts</h3>
                {lesson.map.relations
                  .filter((r) => r.from === part.id || r.to === part.id)
                  .map((r) => {
                    const other = lesson.map.parts.find(
                      (p) => p.id === (r.from === part.id ? r.to : r.from),
                    );
                    return other ? (
                      <button key={r.id} onClick={() => setSelected(other.id)}>
                        <span>
                          {r.from === part.id
                            ? r.kind.replaceAll("_", " ")
                            : "Connected from"}
                        </span>
                        {other.name}
                        <ArrowRight size={16} aria-hidden="true" />
                      </button>
                    ) : null;
                  })}
              </div>
              {flow && (
                <div className="flow-steps">
                  <h3>{flow.name}</h3>
                  <ol>
                    {flow.steps.map((s, i) => (
                      <li key={s}>
                        <button
                          aria-current={s === part.id ? "step" : undefined}
                          onClick={() => setSelected(s)}
                        >
                          <span>{i + 1}</span>
                          {lesson.map.parts.find((p) => p.id === s)?.name}
                        </button>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              <div className="button-row concept-actions">
                <button className="primary" onClick={() => go("communicate")}>
                  <MessageCircle size={18} aria-hidden="true" />
                  Ask about {part.name}
                </button>
                <button onClick={() => go("captions")}>Find in captions</button>
              </div>
              <div className="button-row">
                <button
                  disabled={position === 0}
                  onClick={() => setSelected(lesson.map.parts[position - 1].id)}
                >
                  <ArrowLeft size={16} aria-hidden="true" />
                  Previous concept
                </button>
                <button
                  disabled={position === lesson.map.parts.length - 1}
                  onClick={() => setSelected(lesson.map.parts[position + 1].id)}
                >
                  Next concept
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
              </div>
            </section>
            <aside className="student-diagram">
              <Diagram
                map={lesson.map}
                selected={part.id}
                onSelect={setSelected}
                image={lesson.image}
              />
              <p className="small">
                The same approved concepts, shown spatially.
              </p>
              {spatial && (
                <Suspense
                  fallback={
                    <p role="status">Loading optional concept graph…</p>
                  }
                >
                  <SpatialGraph map={lesson.map} selected={part.id} />
                </Suspense>
              )}
            </aside>
          </div>
          <div className="shared-strip">
            <Network aria-hidden="true" />
            <span>
              <strong>One vocabulary. Every pathway.</strong> {part.name} is the
              same concept in your diagram, captions and questions.
            </span>
          </div>
        </>
      )}
      {page === "captions" && (
        <Captions
          lesson={lesson}
          session={session}
          selected={part.id}
          select={setSelected}
          go={go}
          report={report}
        />
      )}
      {page === "communicate" && (
        <div className="communication-layout">
          <section>
            <h2>A little support, right when you need it.</h2>
            <p>
              One tap sends a phrase to your teacher. No name or email needed.
            </p>
            <div className="phrase-grid">
              {phrases.map((phrase, i) => (
                <button
                  key={phrase}
                  disabled={busy}
                  onClick={() => void send(phrase, false)}
                >
                  <span className="phrase-symbol" aria-hidden="true">
                    {["?", "↻", "…", "◷", "＋"][i]}
                  </span>
                  <strong>{phrase}</strong>
                  <Send size={18} aria-hidden="true" />
                </button>
              ))}
            </div>
            <div className="sent-message" role="status">
              {sent ? (
                <>
                  <Check aria-hidden="true" />
                  Sent: “{sent}”
                </>
              ) : (
                "Your messages go to the teacher’s local inbox."
              )}
            </div>
          </section>
          <aside className="anchored-question">
            <span className="section-kicker">Stay connected to the lesson</span>
            <h2>Ask about a concept</h2>
            <label>
              Approved concept
              <select
                value={part.id}
                onChange={(e) => setSelected(e.target.value)}
              >
                {lesson.vocabulary.map((t) => (
                  <option value={t.id} key={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <p>{part.description}</p>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void send(
                  `Ask about ${part.name}: I don't understand what this does.`,
                  true,
                )
              }
            >
              <Send size={17} aria-hidden="true" />I don’t understand what this
              does
            </button>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send(`Ask about ${part.name}: ${custom}`, true);
              }}
            >
              <label>
                Or write your question
                <textarea
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  maxLength={300}
                  required
                  placeholder="What would you like to know?"
                />
              </label>
              <button disabled={busy || !custom.trim()}>Send question</button>
            </form>
            <small>Anonymous classroom session {session.code}</small>
          </aside>
        </div>
      )}
    </div>
  );
}
