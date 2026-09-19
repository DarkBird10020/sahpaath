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
  explorerSchema,
  phrases,
  questionSchema,
  type Caption,
  type Explorer,
  type Published,
  type Question,
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
  const [mine, setMine] = useState<Question[]>([]);
  const [aiReply, setAiReply] = useState<{ answer: string; outsideLesson: boolean; model: string } | null>(null);
  useEffect(() => {
    setSelected(lesson?.map.parts[0]?.id || "");
    setError("");
    setSent("");
    setMine([]);
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
  // Flow, connections and audio come from the server's explorer view, which is
  // built from published, approved content only.
  const [explorer, setExplorer] = useState<Explorer | null>(null);
  useEffect(() => {
    if (!lesson) return;
    let active = true;
    void api(`/published/${lesson.lessonId}/explorer`, explorerSchema)
      .then((v) => active && setExplorer(v))
      .catch(() => active && setExplorer(null));
    return () => {
      active = false;
    };
  }, [lesson?.lessonId, lesson?.version]);
  const node =
    explorer?.lessonId === lesson?.lessonId && explorer?.version === lesson?.version
      ? explorer?.parts.find((p) => p.partId === part?.id)
      : undefined;
  const nameOf = (id: string | null | undefined) =>
    lesson?.map.parts.find((p) => p.id === id)?.name;
  const loadMine = () => {
    if (!lesson) return;
    void api(
      `/questions/mine?lessonId=${lesson.lessonId}`,
      z.array(questionSchema),
    )
      .then(setMine)
      .catch(() => {});
  };
  useEffect(() => {
    if (page === "communicate") loadMine();
  }, [page, lesson?.lessonId]); // eslint-disable-line react-hooks/exhaustive-deps
  // AI tutor: answers from the approved lesson now; the teacher sees it later.
  async function askAi(text: string) {
    if (!lesson) return;
    setError("");
    setBusy(true);
    setAiReply(null);
    try {
      const result = await api(
        "/ai/ask",
        z.object({ question: questionSchema, conceptIds: z.array(z.string()) }),
        "POST",
        { lessonId: lesson.lessonId, version: lesson.version, conceptId: part.id, text },
      );
      setAiReply(result.question.aiAnswer);
      setCustom("");
      loadMine();
      report("AI answer ready. Your question was also sent to your teacher.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
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
      loadMine();
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
              <p className="concept-description">
                {node?.detailedDescription ?? part.description}
              </p>
              {node?.detailedDescription &&
                node.detailedDescription !== part.description && (
                  <details className="description-levels">
                    <summary>Shorter version</summary>
                    <p>{part.description}</p>
                  </details>
                )}
              {node?.audio ? (
                <div className="recorded-audio">
                  <audio
                    controls
                    preload="none"
                    src={node.audio.url}
                    aria-label={`Recorded description of ${part.name}`}
                  />
                  <small className="speech-note">
                    Cached audio of the approved description
                  </small>
                </div>
              ) : (
                <Speak text={description} />
              )}
              <div className="sr-only" role="status" aria-live="polite">
                {description}
              </div>
              {node?.flow && (
                <div className="button-row flow-nav">
                  <button
                    disabled={!node.flow.previous}
                    onClick={() => node.flow?.previous && setSelected(node.flow.previous)}
                  >
                    <ArrowLeft size={16} aria-hidden="true" />
                    {node.flow.previous
                      ? `Previous in flow: ${nameOf(node.flow.previous)}`
                      : "Start of the flow"}
                  </button>
                  <button
                    className="primary"
                    disabled={!node.flow.next}
                    onClick={() => node.flow?.next && setSelected(node.flow.next)}
                  >
                    {node.flow.next
                      ? `Next in flow: ${nameOf(node.flow.next)}`
                      : "End of the flow"}
                    <ArrowRight size={16} aria-hidden="true" />
                  </button>
                </div>
              )}
              <div className="connections">
                <h3>Connected concepts</h3>
                {(node?.connectedParts ?? []).map((c) => (
                  <button key={`${c.direction}-${c.partId}`} onClick={() => setSelected(c.partId)}>
                    <span>
                      {c.direction === "outgoing"
                        ? c.relationship.replaceAll("_", " ")
                        : "Connected from"}
                    </span>
                    {c.name}
                    {/* The teacher-approved sentence on how the two connect. */}
                    {c.explanation && <small className="connection-why">{c.explanation}</small>}
                    <ArrowRight size={16} aria-hidden="true" />
                  </button>
                ))}
                {!node && (
                  <p className="small">Loading connections…</p>
                )}
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
                    {["?", "↻", "…", "◷", "＋", "✎", "✓", "!"][i]}
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
            {mine.length > 0 && (
              <div className="my-questions">
                <h3>Your recent messages</h3>
                <ul>
                  {mine.slice(-5).map((q) => (
                    <li key={q.id}>
                      <p>{q.text}</p>
                      {q.aiAnswer && <p className="small">AI tutor: {q.aiAnswer.answer}</p>}
                      <Status state={`question_${q.status}`} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
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
              <div className="button-row">
                <button disabled={busy || !custom.trim()}>Send to teacher</button>
                <button
                  type="button"
                  className="primary"
                  disabled={busy || !custom.trim()}
                  onClick={() => void askAi(custom)}
                >
                  Ask AI now
                </button>
              </div>
            </form>
            {busy && <p role="status" className="small">The AI tutor is reading your lesson…</p>}
            {aiReply && (
              <div className="ai-answer" role="status">
                <span className="ai-badge">AI tutor ({aiReply.model}), not checked by your teacher</span>
                <p>{aiReply.answer}</p>
                <Speak text={aiReply.answer} />
                <p className="small">
                  {aiReply.outsideLesson
                    ? "Part of this answer goes beyond your teacher’s lesson. Your teacher can see it and correct it."
                    : "Answered from your teacher-approved lesson. Your teacher can also see this answer."}
                </p>
              </div>
            )}
            <small>Anonymous classroom session {session.code}</small>
          </aside>
        </div>
      )}
    </div>
  );
}
