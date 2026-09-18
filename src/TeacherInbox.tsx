import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Inbox,
  MessageCircleQuestion,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { z } from "zod";
import { api } from "./api";
import {
  inboxRowSchema,
  questionSchema,
  type InboxRow,
} from "../shared/schema";
import { Empty, Status } from "./components";

type Filter = "all" | "waiting" | "answered" | "dismissed";
const WAITING = new Set(["queued", "seen"]);

const filters: [Filter, string][] = [
  ["waiting", "Needs a decision"],
  ["all", "All messages"],
  ["answered", "Answered"],
  ["dismissed", "Dismissed"],
];

export default function TeacherInbox({
  report,
}: {
  report: (message: string) => void;
}) {
  const [rows, setRows] = useState<InboxRow[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>("waiting");
  const [lessonFilter, setLessonFilter] = useState("all");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await api("/inbox", z.array(inboxRowSchema));
        if (!cancelled) {
          setRows(data);
          setError("");
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const lessons = useMemo(
    () =>
      [...new Map((rows ?? []).map((r) => [r.lessonId, r.lessonTitle])).entries()],
    [rows],
  );
  const visible = useMemo(() => {
    const list = rows ?? [];
    return list
      .filter((r) => (lessonFilter === "all" ? true : r.lessonId === lessonFilter))
      .filter((r) =>
        filter === "all"
          ? true
          : filter === "waiting"
            ? WAITING.has(r.status)
            : r.status === filter,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [rows, filter, lessonFilter]);
  const waitingCount = (rows ?? []).filter((r) => WAITING.has(r.status)).length;
  const aiCount = (rows ?? []).filter((r) => r.aiAnswer).length;

  async function act(row: InboxRow, status: "seen" | "answered" | "dismissed") {
    setBusy(true);
    setError("");
    try {
      const updated = await api(
        `/questions/${row.id}/status`,
        questionSchema,
        "POST",
        { status },
      );
      setRows((v) =>
        (v ?? []).map((x) =>
          x.id === updated.id ? { ...x, status: updated.status } : x,
        ),
      );
      report(`Message marked ${status}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="workspace teacher-inbox-page">
      <div className="inbox-header">
        <div>
          <span className="section-kicker">Teacher inbox</span>
          <h1>Every question, one desk.</h1>
          <p className="small">
            What your class sent while learning — newest first. You decide what
            needs an answer; nothing leaves this room.
          </p>
        </div>
        <div className="inbox-stats" aria-label="Inbox summary">
          <span className="stat-chip">
            <MessageCircleQuestion size={16} aria-hidden="true" />
            {waitingCount} waiting
          </span>
          <span className="stat-chip">
            <Sparkles size={16} aria-hidden="true" />
            {aiCount} AI-tutored to check
          </span>
        </div>
      </div>

      {rows === null && !error && <p className="small">Loading the inbox…</p>}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      {rows !== null && (
        <>
          <div className="inbox-controls">
            <div className="inbox-filters" role="group" aria-label="Filter by state">
              {filters.map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={filter === value}
                  className={filter === value ? "primary" : undefined}
                  onClick={() => setFilter(value)}
                >
                  {label}
                  {value === "waiting" && waitingCount > 0 && (
                    <strong> · {waitingCount}</strong>
                  )}
                </button>
              ))}
            </div>
            <label className="lesson-picker">
              Lesson
              <select
                value={lessonFilter}
                onChange={(e) => setLessonFilter(e.target.value)}
              >
                <option value="all">All lessons</option>
                {lessons.map(([id, title]) => (
                  <option value={id} key={id}>
                    {title}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {visible.length === 0 ? (
            <Empty title={filter === "waiting" ? "Nothing is waiting on you" : "No messages here yet"}>
              Students send questions from the Communicate page. They appear
              here the moment they arrive.
            </Empty>
          ) : (
            <div className="inbox-thread">
              {visible.map((q) => (
                <article key={q.id} data-status={q.status}>
                  <div className="inbox-row-main">
                    <div className="inbox-row-meta">
                      <span className="inbox-lesson">{q.lessonTitle}</span>
                      {q.conceptName && (
                        <span className="inbox-concept">· {q.conceptName}</span>
                      )}
                      <span className="small">
                        · session {q.sessionCode} ·{" "}
                        {new Date(q.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="inbox-text">{q.text}</p>
                    {q.aiAnswer && (
                      <div className="ai-answer-note">
                        <strong>
                          AI tutor already told the student
                          {q.aiAnswer.outsideLesson
                            ? " (went beyond the lesson — please check)"
                            : ""}
                          :
                        </strong>{" "}
                        {q.aiAnswer.answer}
                      </div>
                    )}
                    <Status state={`question_${q.status}`} />
                  </div>
                  <div className="button-row">
                    {q.status !== "answered" && q.status !== "dismissed" && (
                      <button
                        className="approve"
                        disabled={busy}
                        onClick={() => void act(q, "answered")}
                      >
                        <Check size={15} aria-hidden="true" />
                        Mark answered
                      </button>
                    )}
                    {q.status === "queued" && (
                      <button disabled={busy} onClick={() => void act(q, "seen")}>
                        Mark seen
                      </button>
                    )}
                    {q.status !== "dismissed" && (
                      <button disabled={busy} onClick={() => void act(q, "dismissed")}>
                        <X size={15} aria-hidden="true" />
                        Dismiss
                      </button>
                    )}
                    {q.status === "dismissed" && (
                      <button disabled={busy} onClick={() => void act(q, "seen")}>
                        <Send size={15} aria-hidden="true" />
                        Reopen
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}

      {rows !== null && rows.length === 0 && filter === "waiting" && (
        <p className="small inbox-footnote">
          <Inbox size={14} aria-hidden="true" /> Tip: the student Communicate
          page still works exactly as before — this inbox is your side of it.
        </p>
      )}
    </div>
  );
}
