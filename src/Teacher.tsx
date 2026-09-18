import { useEffect, useState } from "react";
import { z } from "zod";
import {
  Check,
  Upload,
  Plus,
  ArrowRight,
  FileText,
  RotateCcw,
  LockKeyhole,
  ChevronRight,
  CircleCheck,
} from "lucide-react";
import { api, okSchema } from "./api";
import MapEditor from "./MapEditor";
import {
  auditSchema,
  lessonSchema,
  publishedSchema,
  questionSchema,
  type DiagramMap,
  type Lesson,
  type Question,
  type Audit,
} from "../shared/schema";
import { items, validateMap } from "../shared/domain";
import { fixtures } from "../shared/catalog";
import { Diagram, Empty, Status, SurfaceList } from "./components";

type Props = {
  lessons: Lesson[];
  selected: string;
  onSelect: (id: string) => void;
  onChange: () => Promise<void>;
  onExplore: (id: string) => void;
  report: (message: string) => void;
};
export default function Teacher({
  lessons,
  selected,
  onSelect,
  onChange,
  onExplore,
  report,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [fixture, setFixture] = useState("heart");
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"review" | "pipeline" | "inbox">("review");
  const [editor, setEditor] = useState(false);
  const [focusItem, setFocusItem] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [questions, setQuestions] = useState<Question[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const lesson = lessons.find((l) => l.id === selected);
  const issues = lesson ? validateMap(lesson.map) : [];
  const pending = lesson
    ? items(lesson.map).filter(
        (i) => !["teacher_approved", "rejected"].includes(i.state),
      ).length
    : 0;
  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    try {
      await action();
      await onChange();
      report(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    setEditor(false);
    setFocusItem("");
    setNotes({});
    setError("");
  }, [selected]);
  useEffect(() => {
    if (!selected || tab !== "inbox") return;
    let cancelled = false;
    const load = async () => {
      try {
        const [q, a] = await Promise.all([
          api(`/lessons/${selected}/questions`, z.array(questionSchema)),
          api(`/lessons/${selected}/audit`, z.array(auditSchema)),
        ]);
        if (!cancelled) {
          setQuestions(q);
          setAudit(a);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [selected, tab]);
  const addFixture = () =>
    run(async () => {
      const created = await api("/lessons", lessonSchema, "POST", {
        fixtureId: fixture,
      });
      onSelect(created.id);
    }, "Lesson created. Review the proposed map before publishing.");
  return (
    <div className="workspace">
      <div className="page-heading">
        <div>
          <span className="section-kicker">Teacher workspace</span>
          <h1>Make the lesson open to everyone.</h1>
          <p>Review once. Connect every way of learning.</p>
        </div>
        <span className="local-pill">
          <span />
          Local classroom
        </span>
      </div>
      <div className="teacher-layout">
        <aside className="lesson-sidebar">
          <h2>
            Your lessons <span>{lessons.length}</span>
          </h2>
          <div className="lesson-links">
            {lessons.map((l) => (
              <button
                key={l.id}
                className={selected === l.id ? "active" : ""}
                onClick={() => onSelect(l.id)}
              >
                <BookGlyph />
                <span>
                  <strong>{l.title}</strong>
                  <small>
                    {l.status === "published"
                      ? `Published · version ${l.version}`
                      : "Draft · teacher review"}
                  </small>
                </span>
                <ChevronRight aria-hidden="true" size={16} />
              </button>
            ))}
          </div>
          <form
            className="create-lesson"
            onSubmit={(e) => {
              e.preventDefault();
              void addFixture();
            }}
          >
            <h3>Start with a lesson</h3>
            <label>
              Self-created diagram
              <select
                value={fixture}
                onChange={(e) => setFixture(e.target.value)}
              >
                {fixtures.map((f) => (
                  <option value={f.id} key={f.id}>
                    {f.title}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary" disabled={busy}>
              <Plus size={17} aria-hidden="true" />
              Use sample diagram
            </button>
            <span className="simulation">Demo simulation</span>
            <p className="small">
              Authored labels and proposals. Real review and publishing. No
              model has been called.
            </p>
          </form>
          <details className="upload-panel">
            <summary>
              <Upload size={17} aria-hidden="true" />
              Upload your diagram
            </summary>
            <label>
              Lesson title
              <input
                value={title}
                maxLength={140}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Inside a plant"
              />
            </label>
            <label>
              PNG or JPEG · up to 5 MB
              <input
                type="file"
                accept="image/png,image/jpeg"
                disabled={busy || !title.trim()}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 5_000_000) {
                    setError("Choose a PNG or JPEG image smaller than 5 MB.");
                    return;
                  }
                  void run(async () => {
                    const buffer = await file.arrayBuffer();
                    const bytes = new Uint8Array(buffer);
                    let binary = "";
                    for (let i = 0; i < bytes.length; i++)
                      binary += String.fromCharCode(bytes[i]);
                    const created = await api("/upload", lessonSchema, "POST", {
                      title,
                      mime: file.type,
                      base64: btoa(binary),
                    });
                    onSelect(created.id);
                    setEditor(true);
                  }, "Original uploaded. Add visible labels in the manual map editor.");
                }}
              />
            </label>
            <p className="small">
              OCR is not connected. You can add labels, parts, relationships and
              reading order by hand.
            </p>
          </details>
        </aside>
        <section className="lesson-main" aria-label="Lesson review">
          {error && (
            <div className="error" role="alert">
              {error}
              <button onClick={() => void run(onChange, "Lesson reloaded.")}>
                Reload lesson
              </button>
            </div>
          )}
          {!lesson ? (
            <Empty title="Your first shared lesson starts here">
              Choose a sample diagram or upload your own. Nothing reaches
              students until you approve it.
            </Empty>
          ) : (
            <>
              <div className="lesson-heading">
                <div>
                  <span className="small">
                    {lesson.subject} / Version {lesson.version}
                  </span>
                  <h2>{lesson.title}</h2>
                  <span className="small">
                    {lesson.map.parts.length} concepts ·{" "}
                    {lesson.map.relations.length} relationships
                  </span>
                </div>
                <Status
                  state={
                    lesson.status === "published" ? "published" : "needs_review"
                  }
                />
              </div>
              <div className="workflow-strip" aria-label="Lesson progress">
                {["Upload", "Validate", "Review", "Publish"].map((s, i) => (
                  <span
                    key={s}
                    className={
                      i < 2 || lesson.status === "published"
                        ? "done"
                        : i === 2
                          ? "current"
                          : ""
                    }
                  >
                    <span>
                      {i < 2 || lesson.status === "published" ? (
                        <Check size={14} aria-hidden="true" />
                      ) : (
                        i + 1
                      )}
                    </span>
                    {s}
                  </span>
                ))}
              </div>
              <div className="tab-row" aria-label="Teacher views">
                {(["review", "pipeline", "inbox"] as const).map((t) => (
                  <button
                    key={t}
                    aria-pressed={tab === t}
                    onClick={() => setTab(t)}
                  >
                    {t === "review"
                      ? "Review the map"
                      : t === "pipeline"
                        ? "Processing details"
                        : "Questions & activity"}
                  </button>
                ))}
              </div>
              {tab === "review" && (
                <>
                  {lesson.status === "published" ? (
                    <div className="success-bar">
                      <CircleCheck aria-hidden="true" />
                      <span>
                        This version is published and cannot be edited.
                      </span>
                      <button onClick={() => onExplore(lesson.id)}>
                        Open student lesson{" "}
                        <ArrowRight size={16} aria-hidden="true" />
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () =>
                              api(
                                `/lessons/${lesson.id}/version`,
                                lessonSchema,
                                "POST",
                                { revision: lesson.revision },
                              ),
                            "New draft created. The previous published version is still available.",
                          )
                        }
                      >
                        Create new version
                      </button>
                    </div>
                  ) : (
                    <div className="review-banner">
                      <div>
                        <strong>{pending} items need your decision</strong>
                        <span>
                          {issues.length
                            ? `${issues.length} validation finding(s). Start with the flagged content.`
                            : "The structure is valid. Check the educational content before approving."}
                        </span>
                      </div>
                      <button
                        className="secondary"
                        onClick={() => setEditor((v) => !v)}
                      >
                        {editor ? "Close editor" : "Edit map"}
                      </button>
                    </div>
                  )}
                  {editor && lesson.status !== "published" && (
                    <MapEditor
                      lesson={lesson}
                      busy={busy}
                      onSave={(map) =>
                        run(async () => {
                          await api(
                            `/lessons/${lesson.id}/map`,
                            lessonSchema,
                            "PUT",
                            { revision: lesson.revision, map },
                          );
                          setEditor(false);
                        }, "Map saved. All previous decisions were reset for a fresh review.")
                      }
                    />
                  )}
                  <div className="review-columns">
                    <div className="source-panel">
                      <div className="panel-heading">
                        <h3>Source diagram</h3>
                        <span className="small">
                          {lesson.image
                            ? "Your original"
                            : "Self-created schematic"}
                        </span>
                      </div>
                      <Diagram
                        map={lesson.map}
                        selected={focusItem}
                        onSelect={setFocusItem}
                        image={lesson.image}
                      />
                      <p className="source-caption">
                        {lesson.image
                          ? "Source image stays unchanged. The structured map is reviewed separately."
                          : "A simplified pathway, not an anatomical illustration. Teacher verification required."}
                      </p>
                      <details>
                        <summary>Source labels & confidence</summary>
                        <ul className="source-labels">
                          {lesson.map.labels.map((l) => (
                            <li key={l.id}>
                              <strong>{l.text}</strong>
                              <span>
                                {l.id} ·{" "}
                                {l.source === "demo_fixture"
                                  ? "Demo simulation"
                                  : "Teacher entered"}
                              </span>
                              <small>
                                OCR confidence:{" "}
                                {l.confidence === null
                                  ? "Not measured yet."
                                  : `${l.confidence}%`}
                              </small>
                            </li>
                          ))}
                        </ul>
                      </details>
                    </div>
                    <div className="review-items">
                      <div className="panel-heading">
                        <h3>Structured lesson</h3>
                        <span className="small">Flagged items first</span>
                      </div>
                      {[...items(lesson.map)]
                        .sort(
                          (a, b) =>
                            Number(issues.some((i) => i.itemId === b.id)) -
                            Number(issues.some((i) => i.itemId === a.id)),
                        )
                        .map((item) => {
                          const findings = issues.filter(
                            (i) => i.itemId === item.id,
                          );
                          const isPart = "description" in item;
                          const label = isPart
                            ? item.name
                            : "from" in item
                              ? `${lesson.map.parts.find((p) => p.id === item.from)?.name || item.from} → ${lesson.map.parts.find((p) => p.id === item.to)?.name || item.to}`
                              : item.name;
                          return (
                            <article
                              key={item.id}
                              className={`review-item ${focusItem === item.id ? "focused-item" : ""}`}
                            >
                              <div className="item-heading">
                                <span className="small">
                                  {isPart
                                    ? "Concept"
                                    : "from" in item
                                      ? "Relationship"
                                      : "Reading order"}
                                </span>
                                <Status state={item.state} />
                              </div>
                              <h4>{label}</h4>
                              {isPart ? (
                                <p>{item.description}</p>
                              ) : "from" in item ? (
                                <p>
                                  {item.kind.replaceAll("_", " ")} · Evidence:{" "}
                                  {item.evidence.length
                                    ? item.evidence.join(", ")
                                    : "Missing source labels"}
                                </p>
                              ) : (
                                <ol className="flow-preview">
                                  {item.steps.map((s, n) => (
                                    <li key={`${s}-${n}`}>
                                      {lesson.map.parts.find((p) => p.id === s)
                                        ?.name || s}
                                    </li>
                                  ))}
                                </ol>
                              )}
                              {findings.length > 0 && (
                                <ul className="findings">
                                  {findings.map((f, n) => (
                                    <li key={n}>
                                      <strong>
                                        {f.severity === "error"
                                          ? "Fix required"
                                          : "Verify"}
                                        :
                                      </strong>{" "}
                                      {f.message}
                                    </li>
                                  ))}
                                </ul>
                              )}
                              {lesson.status !== "published" && (
                                <div className="decision-controls">
                                  <label>
                                    Review note
                                    {findings.some(
                                      (f) => f.severity === "warning",
                                    )
                                      ? " (required for flagged content)"
                                      : " (optional)"}
                                    <input
                                      aria-label={`Review note for ${label}`}
                                      value={notes[item.id] ?? item.reviewNote}
                                      maxLength={1000}
                                      onChange={(e) =>
                                        setNotes({
                                          ...notes,
                                          [item.id]: e.target.value,
                                        })
                                      }
                                    />
                                  </label>
                                  <div className="button-row">
                                    <button
                                      className="approve"
                                      disabled={
                                        busy ||
                                        item.state === "teacher_approved" ||
                                        findings.some(
                                          (f) => f.severity === "error",
                                        )
                                      }
                                      onClick={() =>
                                        void run(
                                          () =>
                                            api(
                                              `/lessons/${lesson.id}/decision`,
                                              lessonSchema,
                                              "POST",
                                              {
                                                revision: lesson.revision,
                                                itemId: item.id,
                                                decision: "approve",
                                                note:
                                                  notes[item.id] ??
                                                  item.reviewNote,
                                              },
                                            ),
                                          `${label} approved.`,
                                        )
                                      }
                                    >
                                      <Check size={16} aria-hidden="true" />
                                      Approve
                                    </button>
                                    <button
                                      disabled={
                                        busy || item.state === "rejected"
                                      }
                                      onClick={() =>
                                        void run(
                                          () =>
                                            api(
                                              `/lessons/${lesson.id}/decision`,
                                              lessonSchema,
                                              "POST",
                                              {
                                                revision: lesson.revision,
                                                itemId: item.id,
                                                decision: "reject",
                                                note:
                                                  notes[item.id] ??
                                                  item.reviewNote,
                                              },
                                            ),
                                          `${label} rejected.`,
                                        )
                                      }
                                    >
                                      Reject
                                    </button>
                                    {"from" in item &&
                                      item.evidence.length === 0 && (
                                        <button
                                          className="repair"
                                          disabled={busy}
                                          onClick={() =>
                                            void run(() => {
                                              const map = structuredClone(
                                                lesson.map,
                                              );
                                              const r = map.relations.find(
                                                (r) => r.id === item.id,
                                              )!;
                                              r.evidence = map.parts
                                                .filter(
                                                  (p) =>
                                                    p.id === r.from ||
                                                    p.id === r.to,
                                                )
                                                .map((p) => p.labelId);
                                              return api(
                                                `/lessons/${lesson.id}/map`,
                                                lessonSchema,
                                                "PUT",
                                                {
                                                  revision: lesson.revision,
                                                  map,
                                                },
                                              );
                                            }, "Endpoint source labels attached. Verify that the diagram supports the relationship; previous decisions have been reset.")
                                          }
                                        >
                                          Attach endpoint labels
                                        </button>
                                      )}
                                  </div>
                                </div>
                              )}
                              {isPart && item.state === "teacher_approved" && (
                                <SurfaceList
                                  term={item.name}
                                  published={lesson.status === "published"}
                                />
                              )}
                            </article>
                          );
                        })}
                    </div>
                  </div>
                  <div className="publish-bar">
                    <div>
                      <strong>
                        {lesson.status === "published"
                          ? "One lesson. Multiple ways in."
                          : "Your decision opens the lesson."}
                      </strong>
                      <p>
                        {lesson.status === "published"
                          ? "Students use the same approved vocabulary everywhere."
                          : "Only approved items enter the published version. Rejected items stay out."}
                      </p>
                    </div>
                    <button
                      className="primary"
                      disabled={
                        busy ||
                        lesson.status === "published" ||
                        pending > 0 ||
                        issues.some((i) => i.severity === "error") ||
                        !lesson.map.parts.some(
                          (p) => p.state === "teacher_approved",
                        )
                      }
                      onClick={() =>
                        void run(
                          () =>
                            api(
                              `/lessons/${lesson.id}/publish`,
                              publishedSchema,
                              "POST",
                              { revision: lesson.revision },
                            ),
                          "Lesson published. The immutable version is now available to students.",
                        )
                      }
                    >
                      <LockKeyhole size={17} aria-hidden="true" />
                      {lesson.status === "published"
                        ? `Version ${lesson.version} published`
                        : "Publish lesson"}
                    </button>
                  </div>
                </>
              )}
              {tab === "pipeline" && (
                <div className="pipeline">
                  <p>
                    Local execution <code>{lesson.jobId}</code>. These records
                    describe actual local work. AWS execution history is
                    unavailable.
                  </p>
                  {lesson.stages.map((s, i) => (
                    <details key={s.name}>
                      <summary>
                        <span className="stage-number">{i + 1}</span>
                        <strong>{s.name}</strong>
                        {s.simulation && (
                          <span className="simulation">Demo simulation</span>
                        )}
                        <span className="stage-status">{s.status}</span>
                      </summary>
                      <p>{s.detail}</p>
                      <dl>
                        <dt>Duration</dt>
                        <dd>
                          {s.durationMs === null
                            ? "Not measured yet."
                            : `${s.durationMs.toFixed(2)} ms (local only)`}
                        </dd>
                        <dt>Retries</dt>
                        <dd>{s.retries}</dd>
                        <dt>Error</dt>
                        <dd>{s.error || "None recorded"}</dd>
                        <dt>Execution ID</dt>
                        <dd>
                          <code>{lesson.jobId}</code>
                        </dd>
                      </dl>
                    </details>
                  ))}
                </div>
              )}
              {tab === "inbox" && (
                <div className="inbox">
                  <h3>Student questions</h3>
                  <p className="small">
                    Anonymous session codes. Refreshes every 4 seconds.
                  </p>
                  {questions.length === 0 ? (
                    <p>No questions yet.</p>
                  ) : (
                    questions.map((q) => (
                      <article key={q.id}>
                        <div>
                          <span className="small">
                            Session {q.sessionCode} · version {q.version}
                          </span>
                          <p>{q.text}</p>
                          {q.conceptId && (
                            <small>
                              Concept:{" "}
                              {lesson.map.parts.find(
                                (p) => p.id === q.conceptId,
                              )?.name || q.conceptId}
                            </small>
                          )}
                        </div>
                        <button
                          disabled={q.acknowledged || busy}
                          onClick={() =>
                            void run(async () => {
                              await api(
                                `/questions/${q.id}/acknowledge`,
                                okSchema,
                                "POST",
                                {},
                              );
                              setQuestions((v) =>
                                v.map((x) =>
                                  x.id === q.id
                                    ? { ...x, acknowledged: true }
                                    : x,
                                ),
                              );
                            }, "Question acknowledged.")
                          }
                        >
                          {q.acknowledged ? "Acknowledged" : "Acknowledge"}
                        </button>
                      </article>
                    ))
                  )}
                  <h3>Review history</h3>
                  <ol className="audit-list">
                    {audit.map((a) => (
                      <li key={a.id}>
                        <strong>{a.action.replaceAll("_", " ")}</strong>
                        <p>{a.detail}</p>
                        <time>{new Date(a.createdAt).toLocaleString()}</time>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
function BookGlyph() {
  return <FileText size={20} aria-hidden="true" />;
}
