import { useEffect, useRef, useState } from "react";
import { Words } from "./motion";
import { z } from "zod";
import {
  Check,
  Upload,
  Search,
  Plus,
  ArrowRight,
  FileText,
  RotateCcw,
  LockKeyhole,
  ChevronRight,
  CircleCheck,
  AlertTriangle,
} from "lucide-react";
import { poll } from "./lib/poll";
import { api } from "./api";
import MapEditor from "./MapEditor";
import DemoGuide from "./DemoGuide";
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
import { items, validateMap, itemGrounded, missingCallouts, partNumber, sequencePartIds } from "../shared/domain";
import { fixtures } from "../shared/catalog";

const searchResultSchema = z.object({
  results: z.array(
    z.object({
      title: z.string(),
      thumbUrl: z.string(),
      imageUrl: z.string().nullable(),
      mime: z.string(),
      width: z.number().nullable(),
      height: z.number().nullable(),
      licenseName: z.string(),
      sourceUrl: z.string(),
    }),
  ),
});
type SearchResult = z.infer<typeof searchResultSchema>["results"][number];
import { Diagram, Empty, FileField, Status, SurfaceList } from "./components";
import { DiagramWorking, Spinner, Thinking } from "./Working";

/** The server answers an upload at once and reads the diagram in the background. */
const isReading = (lesson: { stages: { name: string; status: string }[] }) =>
  lesson.stages.some((stage) => stage.name === "Analysis" && stage.status === "waiting");

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
  // Analysing again clears every decision, so it asks once, inline.
  const [confirmReanalyse, setConfirmReanalyse] = useState(false);
  // A real re-analysis took about half a minute; say so while it runs.
  const [reanalysing, setReanalysing] = useState(false);
  const [fixture, setFixture] = useState("heart");
  const [title, setTitle] = useState("");
  const [source, setSource] = useState({
    sourceUrl: "",
    licenseName: "",
    attribution: "",
    sourceType: "open_license" as "self_created" | "open_license" | "ncert_section_52",
  });
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"review" | "pipeline" | "inbox">("review");
  const [editor, setEditor] = useState(false);
  const [focusItem, setFocusItem] = useState("");
  const [notePromptFor, setNotePromptFor] = useState("");
  // Which card's note field is open. Eight always-open, always-empty boxes
  // stacked down the column was the heaviest thing on this screen; the field
  // is asked for now, and still opens itself wherever one is required.
  const [openNote, setOpenNote] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [questions, setQuestions] = useState<Question[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [engine, setEngine] = useState<{ ocr: string; model: string; standIn: boolean } | null>(null);
  const [analysing, setAnalysing] = useState(false);
  // The picture being analysed, shown with the reading beam while it runs.
  const [analysingImage, setAnalysingImage] = useState<string | null>(null);
  useEffect(() => () => void (analysingImage?.startsWith("blob:") && URL.revokeObjectURL(analysingImage)), [analysingImage]);
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [fetching, setFetching] = useState<string | null>(null);
  useEffect(() => {
    void api(
      "/health",
      z.object({ analysis: z.object({ ocr: z.string(), model: z.string(), standIn: z.boolean() }).nullable().optional() }),
    )
      .then((h) => setEngine(h.analysis ?? null))
      .catch(() => setEngine(null));
  }, []);
  const lesson = lessons.find((l) => l.id === selected);
  const processing = lesson?.stages.some((s) => s.name === "Analysis" && s.status === "waiting");
  useEffect(() => {
    if (!selected || !processing) return;
    let cancelled = false;
    const stop = poll(async () => {
      try {
        await api(`/lessons/${selected}/processing-status`, lessonSchema);
        if (!cancelled) await onChange();
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
        throw e;
      }
    }, 3000);
    return () => { cancelled = true; stop(); };
  }, [selected, processing, onChange]);
  // When the background reading of THIS lesson finishes, say what came out and open the right view.
  const watchedLesson = useRef<string | null>(null);
  useEffect(() => {
    if (processing && lesson) {
      watchedLesson.current = lesson.id;
      return;
    }
    if (!watchedLesson.current || lesson?.id !== watchedLesson.current) return;
    watchedLesson.current = null;
    const parts = lesson.map.parts.length;
    setEditor(parts === 0);
    report(
      parts
        ? `Analysis ready: ${parts} proposed parts from ${lesson.map.labels.length} OCR labels. Review every item.`
        : lesson.map.labels.length
          ? "OCR labels found, but no proposal. Build the map in the manual editor."
          : "The diagram was read, but nothing was found. Add visible labels in the manual map editor.",
    );
  }, [processing, lesson]); // eslint-disable-line react-hooks/exhaustive-deps
  const issues = lesson ? validateMap(lesson.map) : [];
  // Whether this analysis recorded any confidence at all, for the one line that
  // replaces the same two dead sentences repeated on every card.
  const measuredAnywhere = !lesson
    ? false
    : lesson.map.labels.some((l) => l.confidence !== null) ||
      lesson.map.parts.some((p) => p.modelConfidence !== null);
  const sequence = lesson ? sequencePartIds(lesson.map) : [];
  const missing = lesson ? missingCallouts(lesson.map) : [];
  const pending = lesson
    ? items(lesson.map).filter(
        (i) => !["teacher_approved", "rejected"].includes(i.state),
      ).length
    : 0;
  // Publish is honest about exactly what still blocks it, so the locked button
  // is never a mystery: the same checks the server runs at publish time.
  const errorFindings = issues.filter((i) => i.severity === "error");
  const publishBlockers = !lesson
    ? []
    : [
        ...(!lesson.license || !lesson.license.licenseName.trim()
          ? ["Add the diagram's source and license."]
          : []),
        ...(pending > 0
          ? [
              `${pending} item${pending === 1 ? " still needs" : "s still need"} an approve or reject decision.`,
            ]
          : []),
        ...(errorFindings.length
          ? [
              `${errorFindings.length} validation error${errorFindings.length === 1 ? "" : "s"} must be fixed or the items rejected.`,
            ]
          : []),
        ...(!lesson.map.parts.some((p) => p.state === "teacher_approved")
          ? ["Approve at least one concept."]
          : []),
      ];
  // Relationships missing their endpoint labels: one repair fixes all of them.
  // Evidence that is missing, or that names labels which do not exist, can be
  // replaced by the two endpoints' own labels - what the evidence must be.
  const citesMissing = (r: { evidence: string[] }) =>
    !!lesson && r.evidence.some((e) => !lesson.map.labels.some((l) => l.id === e));
  const repairableRelations = lesson
    ? lesson.map.relations.filter(
        (r) =>
          r.state !== "rejected" &&
          (!r.evidence.length || citesMissing(r)) &&
          [r.from, r.to].every((pid) =>
            lesson.map.parts.some(
              (p) =>
                p.id === pid &&
                lesson.map.labels.some((l) => l.id === p.labelId),
            ),
          ),
      ).length
    : 0;
  // Clean items (no validation findings): safe to approve together, since the
  // server only demands a review note for flagged content.
  const validPending = lesson
    ? items(lesson.map).filter(
        (i) =>
          !["teacher_approved", "rejected"].includes(i.state) &&
          !issues.some((issue) => issue.itemId === i.id),
      ).length
    : 0;
  function repairMissingEvidence() {
    if (!lesson || !repairableRelations) return;
    void run(
      () => {
        const map = structuredClone(lesson.map);
        for (const r of map.relations) {
          if (r.state === "rejected" || (r.evidence.length && !citesMissing(r))) continue;
          const ends = [r.from, r.to]
            .map((pid) => map.parts.find((p) => p.id === pid)?.labelId)
            .filter((lid): lid is string => !!lid && map.labels.some((l) => l.id === lid));
          if (ends.length === 2) r.evidence = ends;
        }
        return api(`/lessons/${lesson.id}/map`, lessonSchema, "PUT", {
          revision: lesson.revision,
          map,
        });
      },
      `Endpoint labels attached to ${repairableRelations} relationship${repairableRelations === 1 ? "" : "s"}. Saving resets decisions, so approve the items again.`,
    );
  }
  function approveValidItems() {
    if (!lesson || !validPending) return;
    void run(
      async () => {
        // Sequential decisions: each response carries the next revision.
        let current = lesson;
        for (const item of items(current.map).filter(
          (i) =>
            !["teacher_approved", "rejected"].includes(i.state) &&
            !issues.some((issue) => issue.itemId === i.id),
        )) {
          current = await api(
            `/lessons/${current.id}/decision`,
            lessonSchema,
            "POST",
            {
              revision: current.revision,
              itemId: item.id,
              decision: "approve",
              note: "Bulk-approved after checking the map has no findings.",
            },
          );
        }
      },
      `${validPending} valid item${validPending === 1 ? "" : "s"} approved. Flagged items still need your own decision.`,
    );
  }
  /** Runs the uploaded image through analysis again; every decision starts over. */
  function reanalyse() {
    if (!lesson) return;
    setConfirmReanalyse(false);
    setAnalysingImage(lesson.image ? `/api/images/${lesson.image}` : null);
    setReanalysing(true);
    void run(
      () => api(`/lessons/${lesson.id}/reanalyse`, lessonSchema, "POST", { revision: lesson.revision }),
      "Reading your diagram again. The new proposal opens by itself when it is ready.",
    ).finally(() => setReanalysing(false));
  }
  async function run(
    action: () => Promise<unknown>,
    message: string | (() => string),
    onError?: (error: Error) => void,
  ) {
    setBusy(true);
    setError("");
    try {
      await action();
      await onChange();
      setNotePromptFor("");
      report(typeof message === "string" ? message : message());
    } catch (e) {
      const error = e as Error;
      onError?.(error);
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    setEditor(false);
    setConfirmReanalyse(false);
    setFocusItem("");
    setNotes({});
    setError("");
  }, [selected]);  useEffect(() => {
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
        throw e;
      }
    };
    void load().catch(() => {});
    const stop = poll(load, 4000);
    return () => {
      cancelled = true;
      stop();
    };
  }, [selected, tab]);
  const addFixture = () =>
    run(async () => {
      const created = await api("/lessons", lessonSchema, "POST", {
        fixtureId: fixture,
      });
      onSelect(created.id);
    }, "Lesson created. Review the proposed map before publishing.");
  async function runSearch(q: string) {
    const query = q.trim();
    if (!query) return;
    setSearching(true);
    setError("");
    try {
      const data = await api(
        `/diagram-search?q=${encodeURIComponent(query)}`,
        searchResultSchema,
      );
      setSearchResults(data.results);
      if (!data.results.length)
        setError(`No PNG or JPEG diagrams found for “${query}”. Try different words or upload a file.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSearching(false);
    }
  }
  async function useSearchResult(r: SearchResult) {
    if (analysing || processing || fetching) {
      setError("A diagram is still being read. Wait for it to finish before choosing another.");
      return;
    }
    setFetching(r.imageUrl ?? r.thumbUrl);
    setError("");
    try {
      const image = await api(
        "/diagram-search/fetch",
        z.object({ mime: z.enum(["image/png", "image/jpeg"]), base64: z.string() }),
        "POST",
        { imageUrl: r.imageUrl ?? r.thumbUrl },
      );
      let uploaded = "Original uploaded. Add visible labels in the manual map editor.";
      if (engine) {
        setAnalysingImage(r.thumbUrl);
        setAnalysing(true);
      }
      await run(async () => {
        const created = await api("/upload", lessonSchema, "POST", {
          title: title.trim() || r.title.slice(0, 140) || "Diagram",
          mime: image.mime,
          base64: image.base64,
          license: {
            sourceUrl: r.sourceUrl,
            licenseName: r.licenseName,
            attribution: "",
            sourceType: "open_license" as const,
          },
        });
        onSelect(created.id);
        if (isReading(created)) {
          setEditor(false);
          uploaded = "Reading your diagram. The review opens by itself when it is ready.";
        } else {
          const proposed = created.map.parts.length > 0;
          setEditor(!proposed);
          if (proposed)
            uploaded = `Analysis ready: ${created.map.parts.length} proposed parts from ${created.map.labels.length} OCR labels. Review every item.`;
          else if (created.map.labels.length)
            uploaded = "OCR labels found, but no proposal. Build the map in the manual editor.";
        }
      }, () => uploaded);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setFetching(null);
      setAnalysing(false);
    }
  }
  return (
    <div className="workspace">
      <div className="page-heading">
        <div>
          <span className="section-kicker">Teacher workspace</span>
          <h1>
            <Words text="Make the lesson open to everyone." timed />
          </h1>
          <p>Review once. Connect every way of learning.</p>
        </div>
        <span className="local-pill">
          <span />
          Local classroom
        </span>
      </div>
      <div className="teacher-layout">
        <aside className="lesson-sidebar">
          {/* Finding a diagram comes first: it is where most lessons start. */}
          <form
            className="create-lesson diagram-search"
            onSubmit={(e) => {
              e.preventDefault();
              void runSearch(search);
            }}
          >
            <h3>Search for a diagram</h3>
            <label>
              Diagram or structure
              <input
                value={search}
                maxLength={120}
                placeholder="e.g. heart, water cycle, cell organelles"
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <button className="primary" disabled={busy || searching || !search.trim()}>
              {searching ? <Spinner /> : <Search size={17} aria-hidden="true" />}
              {searching ? "Searching…" : "Search diagrams"}
            </button>
            {searchResults && (
              <div className="search-results" role="list">
                {searchResults.map((r) => (
                  <button
                    key={r.thumbUrl}
                    role="listitem"
                    type="button"
                    className="search-result"
                    disabled={fetching !== null || busy}
                    onClick={() => void useSearchResult(r)}
                    title={`${r.title} · ${r.licenseName}`}
                  >
                    <img
                      src={r.thumbUrl}
                      alt={`Diagram result: ${r.title}`}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                    <span className="search-result-meta">
                      <strong>{r.title}</strong>
                      <small>
                        {fetching === (r.imageUrl ?? r.thumbUrl)
                          ? "Fetching & analysing…"
                          : `${r.licenseName}${r.width ? ` · ${r.width}×${r.height}` : ""}`}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
            )}
            <p className="small">
              Search finds openly licensed diagrams and uploads your pick
              straight into review — the same pipeline as a file upload.
            </p>
          </form>
          <details className="upload-panel" open={!!engine}>
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
            <FileField
              label="Diagram image"
              hint="PNG or JPEG · up to 5 MB"
              accept="image/png,image/jpeg"
              disabled={busy}
              onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (analysing || processing) {
                    setError("A diagram is still being read. Wait for it to finish before uploading another.");
                    e.target.value = "";
                    return;
                  }
                  if (file.size > 5_000_000) {
                    setError("Choose a PNG or JPEG image smaller than 5 MB.");
                    return;
                  }
                  let uploaded = "Original uploaded. Add visible labels in the manual map editor.";
                  if (engine) {
                    setAnalysingImage(URL.createObjectURL(file));
                    setAnalysing(true);
                  }
                  void run(async () => {
                    const buffer = await file.arrayBuffer();
                    const bytes = new Uint8Array(buffer);
                    let binary = "";
                    for (let i = 0; i < bytes.length; i++)
                      binary += String.fromCharCode(bytes[i]);
                    const created = await api("/upload", lessonSchema, "POST", {
                      // The file name is used when no title was typed.
                      title: title.trim() || file.name.replace(/.[^.]+$/, "").slice(0, 140) || "Uploaded diagram",
                      mime: file.type,
                      base64: btoa(binary),
                      license: source.licenseName.trim() ? source : null,
                    });
                    onSelect(created.id);
                    if (isReading(created)) {
                      setEditor(false);
                      uploaded = "Reading your diagram. The review opens by itself when it is ready.";
                    } else {
                      const proposed = created.map.parts.length > 0;
                      setEditor(!proposed);
                      if (proposed)
                        uploaded = `Analysis ready: ${created.map.parts.length} proposed parts from ${created.map.labels.length} OCR labels. Review every item.`;
                      else if (created.map.labels.length)
                        uploaded = "OCR labels found, but no proposal. Build the map in the manual editor.";
                    }
                  }, () => uploaded).finally(() => {
                    setAnalysing(false);
                    e.target.value = "";
                  });
              }}
            />
            <div className="editor-grid source-fields">
              <label>
                Source URL or reference
                <input
                  value={source.sourceUrl}
                  maxLength={500}
                  placeholder="Where the diagram came from"
                  onChange={(e) =>
                    setSource({ ...source, sourceUrl: e.target.value })
                  }
                />
              </label>
              <label>
                License (required)
                <input
                  value={source.licenseName}
                  maxLength={120}
                  placeholder="e.g. CC BY 4.0, Self-created"
                  required
                  onChange={(e) =>
                    setSource({ ...source, licenseName: e.target.value })
                  }
                />
              </label>
              <label>
                Attribution
                <input
                  value={source.attribution}
                  maxLength={300}
                  placeholder="Who made it / how to credit"
                  onChange={(e) =>
                    setSource({ ...source, attribution: e.target.value })
                  }
                />
              </label>
              <label>
                Source type
                <select
                  value={source.sourceType}
                  onChange={(e) =>
                    setSource({
                      ...source,
                      sourceType: e.target
                        .value as typeof source.sourceType,
                    })
                  }
                >
                  <option value="self_created">Self-created</option>
                  <option value="open_license">Openly licensed</option>
                  <option value="ncert_section_52">
                    NCERT · Copyright Act s.52(1)(zb)
                  </option>
                </select>
              </label>
              <p className="small">
                Publishing is blocked until source and license information is
                recorded.
              </p>
            </div>
            {!source.licenseName.trim() && (
              <p className="small upload-hint">
                You can upload now. Add the license before publishing to students.
              </p>
            )}
            {(analysing || processing) && <Thinking>Analysing your diagram. Follow it in the main panel.</Thinking>}
            {engine ? (
              <p className="small">
                Diagram analysis: {engine.ocr} + {engine.model}
                {engine.standIn ? " (test stand-in, not AWS)" : ""}. You review
                every label, part and relationship before students see it.
              </p>
            ) : (
              <p className="small">
                OCR is not connected. You can add labels, parts, relationships
                and reading order by hand.
              </p>
            )}
          </details>
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
          <DemoGuide onOpen={onSelect} onChange={onChange} report={report} />
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
              {engine && " To run the AI on a diagram, upload an image below."}
            </p>
          </form>
        </aside>
        <section className="lesson-main" aria-label="Lesson review">
          {error && (
            <div className="error" role="alert">
              {error}
              {/reload/i.test(error) && (
                <button onClick={() => void run(onChange, "Lesson reloaded.")}>
                  Reload lesson
                </button>
              )}
            </div>
          )}
          {analysing || reanalysing || processing ? (
            <DiagramWorking
              image={analysing || reanalysing ? analysingImage : lesson?.image ? `/api/images/${lesson.image}` : null}
              title={reanalysing ? "Reading your diagram again" : "Reading your diagram"}
              stages={[
                "Reading the labels on the picture",
                "Checking every numbered callout",
                "Finding the parts and how they connect",
                "Writing each explanation at three lengths",
                "Checking every claim against the labels",
              ]}
              typical={[15, 30]}
            />
          ) : !lesson ? (
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
              {/* The four steps were four loose circles with nothing between
                  them. A rail under the strip fills to where the lesson has
                  actually reached, and moves when it advances. */}
              <div
                className="workflow-strip"
                aria-label="Lesson progress"
                style={{ "--done": `${(lesson.status === "published" ? 4 : 2.5) * 25}%` } as React.CSSProperties}
              >
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
                    <>
                    {!lesson.license && (
                      <form
                        className="license-needed"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void run(
                            () =>
                              api(`/lessons/${lesson.id}/license`, lessonSchema, "PUT", {
                                revision: lesson.revision,
                                license: source,
                              }),
                            "License recorded. Publishing is now possible once every item is decided.",
                          );
                        }}
                      >
                        <strong>Add the diagram’s license before publishing.</strong>
                        <label>
                          License
                          <input
                            required
                            maxLength={120}
                            value={source.licenseName}
                            placeholder="e.g. CC BY 4.0, Self-created"
                            onChange={(e) => setSource({ ...source, licenseName: e.target.value })}
                          />
                        </label>
                        <label>
                          Source type
                          <select
                            value={source.sourceType}
                            onChange={(e) =>
                              setSource({ ...source, sourceType: e.target.value as typeof source.sourceType })
                            }
                          >
                            <option value="self_created">Self-created</option>
                            <option value="open_license">Openly licensed</option>
                            <option value="ncert_section_52">NCERT · Copyright Act s.52(1)(zb)</option>
                          </select>
                        </label>
                        <button disabled={busy || !source.licenseName.trim()}>Save license</button>
                      </form>
                    )}
                    <div className="review-banner">
                      <div>
                        <strong>{pending} items need your decision</strong>
                        <span>
                          {issues.length
                            ? `${issues.length} validation finding(s). Start with the flagged content.`
                            : "The structure is valid. Check the educational content before approving."}
                        </span>
                      </div>
                      {repairableRelations > 0 && (
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={repairMissingEvidence}
                        >
                          Attach missing labels ({repairableRelations})
                        </button>
                      )}
                      {validPending > 0 && (
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={approveValidItems}
                        >
                          Approve {validPending} valid item
                          {validPending === 1 ? "" : "s"}
                        </button>
                      )}
                      <button
                        className="secondary"
                        onClick={() => setEditor((v) => !v)}
                      >
                        {editor ? "Close editor" : "Edit map"}
                      </button>
                      {lesson.image && !lesson.fixtureId && !reanalysing && (
                        confirmReanalyse ? (
                          <span className="reanalyse-confirm" role="group" aria-label="Analyse the diagram again">
                            <span>Every decision on this lesson will be cleared.</span>
                            <button className="primary" disabled={busy} onClick={reanalyse}>
                              Analyse again
                            </button>
                            <button className="secondary" disabled={busy} onClick={() => setConfirmReanalyse(false)}>
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button className="secondary" disabled={busy} onClick={() => setConfirmReanalyse(true)}>
                            Analyse diagram again
                          </button>
                        )
                      )}
                    </div>
                    </>
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
                                  : l.source === "textract"
                                    ? "Textract OCR"
                                    : l.source === "local_ocr"
                                      ? "Local OCR (test stand-in)"
                                      : l.source === "model_read"
                                        ? "Callout number read by the AI model, not OCR"
                                        : "Teacher entered"}
                              </span>
                              <small>
                                {l.source === "model_read"
                                  ? "No OCR confidence: check the number against the image."
                                  : `OCR confidence: ${l.confidence === null ? "Not measured yet." : `${l.confidence}%`}`}
                              </small>
                            </li>
                          ))}
                        </ul>
                      </details>
                    </div>
                    <div className="review-items">
                      <div className="panel-heading">
                        <h3>Structured lesson</h3>
                        <span className="small">
                          In diagram order, 1 to last
                          {" · "}
                          {new Set(issues.map((i) => i.itemId)).size} to check
                        </span>
                      </div>
                      {/* Said once, above the column, instead of on all eight
                          cards: nothing here has a measured confidence yet. */}
                      {!measuredAnywhere && (
                        <p className="small confidence-note">
                          No confidence figures were recorded for this analysis, so none are shown on the
                          items. Check each one against the diagram.
                        </p>
                      )}
                      {missing.length > 0 && (
                        <p className="missing-callouts" role="note">
                          <AlertTriangle size={15} aria-hidden="true" />
                          <span>
                            {missing.length === 1 ? "Number " : "Numbers "}
                            <strong>{missing.join(", ")}</strong>
                            {missing.length === 1 ? " is" : " are"} on the diagram but{" "}
                            {missing.length === 1 ? "has" : "have"} no part here. Analyse the diagram again, or add{" "}
                            {missing.length === 1 ? "it" : "them"} with Edit map.
                          </span>
                        </p>
                      )}
                      {[...items(lesson.map)]
                        .sort((a, b) => {
                          // The diagram's own sequence, 1 to last: numbered
                          // callouts, then flow, then reading order. Flagged
                          // items keep their place and carry their badge, so the
                          // lesson reads the way it will be taught. Relations
                          // and the reading order come after every part.
                          const isPart = (x: typeof a) => "description" in x;
                          if (isPart(a) && isPart(b))
                            return (
                              sequence.indexOf(a.id) - sequence.indexOf(b.id)
                            );
                          if (isPart(a) !== isPart(b)) return isPart(a) ? -1 : 1;
                          return 0;
                        })
                        .map((item) => {
                          const findings = issues.filter(
                            (i) => i.itemId === item.id,
                          );
                          const isPart = "description" in item;
                          const grounded = itemGrounded(lesson.map, item.id);
                          const sourceLabel = isPart
                            ? lesson.map.labels.find(
                                (l) => l.id === item.labelId,
                              )
                            : null;
                          // A note is asked for when something is flagged, and
                          // stays open once there is one to read.
                          const noteWanted = findings.some((f) => f.severity === "warning");
                          const noteOpen =
                            noteWanted ||
                            !!(notes[item.id] ?? item.reviewNote) ||
                            openNote === item.id ||
                            notePromptFor === item.id;
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
                              <h4>
                                {isPart ? (
                                  <PartName map={lesson.map} id={item.id} order={sequence} />
                                ) : "from" in item ? (
                                  <>
                                    <PartName map={lesson.map} id={item.from} order={sequence} />
                                    <span aria-hidden="true">→</span>
                                    <span className="sr-only">to</span>
                                    <PartName map={lesson.map} id={item.to} order={sequence} />
                                  </>
                                ) : (
                                  label
                                )}
                              </h4>
                              <div className="grounding-line">
                                <span
                                  className={`grounded ${grounded ? "ok" : "warn"}`}
                                >
                                  {grounded ? (
                                    <Check size={13} aria-hidden="true" />
                                  ) : (
                                    <AlertTriangle size={13} aria-hidden="true" />
                                  )}
                                  {grounded ? "Grounded" : "Not grounded"}
                                </span>
                                {/* Only a figure we actually have. Printed on
                                    every card, "Not measured yet." and "Not
                                    provided." were the same two dead lines
                                    repeated down the whole column; the note
                                    above the list says it once instead. */}
                                {sourceLabel && sourceLabel.source === "model_read" && (
                                  <span className="small">
                                    Number {sourceLabel.text} read by the AI model, not OCR
                                  </span>
                                )}
                                {sourceLabel && sourceLabel.source !== "model_read" && sourceLabel.confidence !== null && (
                                  <span className="small">OCR confidence: {sourceLabel.confidence}%</span>
                                )}
                                {"modelConfidence" in item && item.modelConfidence !== null && (
                                  <span className="small">
                                    Model confidence: {item.modelConfidence}% (the model’s own estimate)
                                  </span>
                                )}
                              </div>
                              {isPart ? (
                                <>
                                  <p>{item.description}</p>
                                  {item.descriptions && (
                                    <details className="description-levels">
                                      <summary>
                                        Short and detailed versions
                                      </summary>
                                      <p>
                                        <strong>Short: </strong>
                                        {item.descriptions.short}
                                      </p>
                                      <p>
                                        <strong>Detailed: </strong>
                                        {item.descriptions.detailed}
                                      </p>
                                    </details>
                                  )}
                                </>
                              ) : "from" in item ? (
                                <>
                                  {/* What the relationship means, laid out as a part's
                                      explanation is: a sentence, then both lengths. */}
                                  {item.descriptions ? (
                                    <>
                                      <p>{item.descriptions.short}</p>
                                      <details className="description-levels">
                                        <summary>Short and detailed versions</summary>
                                        <p>
                                          <strong>Short: </strong>
                                          {item.descriptions.short}
                                        </p>
                                        <p>
                                          <strong>Detailed: </strong>
                                          {item.descriptions.detailed}
                                        </p>
                                      </details>
                                    </>
                                  ) : (
                                    <p className="small">
                                      No explanation was written for this relationship.
                                      {/* Only an upload can be analysed again; a built-in sample cannot. */}
                                      {lesson.image && !lesson.fixtureId && " Analyse the diagram again to get one."}
                                    </p>
                                  )}
                                <p className="small">
                                  {item.kind.replaceAll("_", " ")} · Evidence on the image:{" "}
                                  {item.evidence.length
                                    ? item.evidence
                                        .map((id) => {
                                          const l = lesson.map.labels.find((x) => x.id === id);
                                          return l ? `label “${l.text}”` : `unknown label (${id})`;
                                        })
                                        .join(", ")
                                    : "Missing source labels"}
                                  {item.evidence.some((id) => lesson.map.labels.find((x) => x.id === id)?.source === "model_read") &&
                                    " (numbers read by the AI model, not OCR)"}
                                </p>
                                </>
                              ) : (
                                <ol className="flow-preview">
                                  {item.steps.map((s, n) => (
                                    <li key={`${s}-${n}`}>
                                      <PartName map={lesson.map} id={s} order={sequence} />
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
                                  {noteOpen ? (
                                    <label>
                                      Review note
                                      {noteWanted
                                        ? " (required for flagged content)"
                                        : " (optional)"}
                                      <input
                                        autoFocus={openNote === item.id}
                                        aria-label={`Review note for ${label}`}
                                        value={notes[item.id] ?? item.reviewNote}
                                        maxLength={1000}
                                        className={
                                          notePromptFor === item.id
                                            ? "note-required"
                                            : undefined
                                        }
                                        onChange={(e) =>
                                          setNotes({
                                            ...notes,
                                            [item.id]: e.target.value,
                                          })
                                        }
                                      />
                                    </label>
                                  ) : (
                                    <button
                                      type="button"
                                      className="link-button add-note"
                                      onClick={() => setOpenNote(item.id)}
                                    >
                                      Add a review note
                                    </button>
                                  )}
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
                                          (e) => {
                                            // The server refuses approvals of
                                            // flagged items without a note;
                                            // put the cursor in the field.
                                            if (!/review note/i.test(e.message))
                                              return;
                                            setNotePromptFor(item.id);
                                            requestAnimationFrame(() => {
                                              const input = [
                                                ...document.querySelectorAll<HTMLInputElement>("input"),
                                              ].find(
                                                (i) =>
                                                  i.getAttribute("aria-label") ===
                                                  `Review note for ${label}`,
                                              );
                                              input?.scrollIntoView({ block: "center", behavior: "smooth" });
                                              input?.focus();
                                            });
                                          },
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
                      {lesson.status === "published" ? (
                        <p>
                          Students use the same approved vocabulary everywhere.
                        </p>
                      ) : publishBlockers.length ? (
                        <ul className="publish-blockers">
                          {publishBlockers.map((b) => (
                            <li key={b}>
                              <AlertTriangle size={13} aria-hidden="true" />
                              {b}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p>
                          Every item is decided and the map is valid. Publishing
                          creates the immutable student version.
                        </p>
                      )}
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
                        {s.durationMs !== null && (
                          <span className="stage-duration">{s.durationMs.toFixed(1)} ms</span>
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
                      <article key={q.id} data-status={q.status}>
                        <div>
                          <span className="small">
                            Session {q.sessionCode} · version {q.version} ·{" "}
                            {q.status}
                          </span>
                          <p>{q.text}</p>
                          {q.aiAnswer && (
                            <div className="ai-answer-note">
                              <strong>AI tutor answered the student{q.aiAnswer.outsideLesson ? " (goes beyond this lesson, please check)" : ""}:</strong>{" "}
                              {q.aiAnswer.answer}
                            </div>
                          )}
                          {q.conceptId && (
                            <small>
                              Concept:{" "}
                              {lesson.map.parts.find(
                                (p) => p.id === q.conceptId,
                              )?.name || q.conceptId}
                            </small>
                          )}
                        </div>
                        <div className="button-row">
                          {q.status === "queued" || q.status === "seen" ? (
                            (
                              [
                                ["seen", "Mark seen"],
                                ["answered", "Mark answered"],
                                ["dismissed", "Dismiss"],
                              ] as const
                            )
                              .filter(([status]) => status !== q.status)
                              .map(([status, label]) => (
                                <button
                                  key={status}
                                  className={status === "answered" ? "approve" : undefined}
                                  disabled={busy}
                                  onClick={() =>
                                    void run(async () => {
                                      const updated = await api(
                                        `/questions/${q.id}/status`,
                                        questionSchema,
                                        "POST",
                                        { status },
                                      );
                                      setQuestions((v) =>
                                        v.map((x) => (x.id === q.id ? updated : x)),
                                      );
                                    }, `Question marked ${status}.`)
                                  }
                                >
                                  {label}
                                </button>
                              ))
                          ) : (
                            <Status state={`question_${q.status}`} />
                          )}
                        </div>
                      </article>
                    ))
                  )}
                  <h3>Review history</h3>
                  {/* A history is a sequence, so it reads as one: a rail down
                      the events, and how long ago rather than a full timestamp.
                      The exact time stays on the element for anyone who wants
                      it. */}
                  <ol className="audit-list activity-feed">
                    {audit.map((a) => (
                      <li key={a.id}>
                        <span className="activity-dot" aria-hidden="true" />
                        <div className="activity-body">
                          <strong>{a.action.replaceAll("_", " ")}</strong>
                          <p>{a.detail}</p>
                        </div>
                        <time dateTime={a.createdAt} title={new Date(a.createdAt).toLocaleString()}>
                          {since(a.createdAt)}
                        </time>
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
/** How long ago, in the words a reader uses. The exact time stays in `title`. */
function since(iso: string) {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return "just now";
  const steps: [number, string][] = [
    [60, "min"],
    [3600, "hour"],
    [86400, "day"],
  ];
  for (const [unit, name] of steps) {
    const next = unit * (name === "min" ? 60 : name === "hour" ? 24 : 365);
    if (seconds < next) {
      const n = Math.round(seconds / unit);
      return `${n} ${name}${n === 1 ? "" : "s"} ago`;
    }
  }
  return new Date(iso).toLocaleDateString();
}

/**
 * A part as a reader sees it: the diagram's own number, then its name. Used for
 * a part's title and for both ends of a relationship, so "6 → 7" can never
 * appear without saying what 6 and 7 are.
 */
function PartName({ map, id, order }: { map: DiagramMap; id: string; order: string[] }) {
  const part = map.parts.find((p) => p.id === id);
  if (!part) return <span className="part-name">Missing part</span>;
  const n = partNumber(map, part, order.indexOf(id));
  return (
    <span className="part-name">
      <span className="callout-no" aria-hidden="true">
        {n}
      </span>
      <span className="sr-only">Number {n}, </span>
      {part.name}
    </span>
  );
}

function BookGlyph() {
  return <FileText size={20} aria-hidden="true" />;
}
