import { useEffect, useState } from "react";
import { z } from "zod";
import { ArrowRight, MessageCircle, Search, Download } from "lucide-react";
import { api } from "./api";
import CaptionCorrection from "./CaptionCorrection";
import LiveCaptions from "./LiveCaptions";
import WordExplainer from "./WordExplainer";
import {
  captionSchema,
  termSurfacesSchema,
  type Caption,
  type Published,
  type Session,
  type TermSurfaces,
} from "../shared/schema";
import { highlightSegments } from "../shared/vocabulary";
import { Empty, FileField, Status, SurfaceList } from "./components";

export default function Captions({
  lesson,
  session,
  selected,
  select,
  go,
  report,
}: {
  lesson: Published;
  session: Session;
  selected: string;
  select: (id: string) => void;
  go: (p: string) => void;
  report: (m: string) => void;
}) {
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [surfaces, setSurfaces] = useState<TermSurfaces | null>(null);
  const demoTranscript = lesson.map.parts
    .map((p) => `${p.name}: ${p.description}`)
    .join(" ");
  const term =
    lesson.vocabulary.find((t) => t.id === selected) || lesson.vocabulary[0];
  useEffect(() => {
    let active = true;
    if (!term) return;
    void api(
      `/published/${lesson.lessonId}/vocabulary/${term.id}/surfaces`,
      termSurfacesSchema,
    )
      .then((s) => {
        if (active) setSurfaces(s);
      })
      .catch(() => {
        if (active) setSurfaces(null);
      });
    return () => {
      active = false;
    };
  }, [lesson.lessonId, lesson.version, term?.id]);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const value = await api(
          `/lessons/${lesson.lessonId}/captions`,
          z.array(captionSchema),
        );
        if (active) {
          setCaptions(value);
          setError("");
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 4000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [lesson.lessonId, lesson.version]);
  async function add(text: string, source: Caption["source"]) {
    setBusy(true);
    setError("");
    try {
      const c = await api(
        `/lessons/${lesson.lessonId}/captions`,
        captionSchema,
        "POST",
        { text, source },
      );
      setCaptions((v) => [...v, c]);
      setNote("");
      report(
        source === "loaded_transcript"
          ? "Loaded transcript added. This is not live transcription."
          : "Manual classroom note added.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const filtered = captions.filter((c) =>
    c.text.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="captions-layout">
      <section className="transcript-panel">
        <div className="panel-heading">
          <h2>Class transcript</h2>
        </div>
        <label className="search-label">
          <Search aria-hidden="true" size={18} />
          <span className="sr-only">Search transcript</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a word or concept"
          />
        </label>
        <LiveCaptions
          lesson={lesson}
          session={session}
          selected={selected}
          select={select}
          query={query}
          report={report}
        />
        <div className="panel-heading">
          <h3>Loaded transcripts & notes</h3>
          <span className="simulation">Loaded transcript / manual notes</span>
        </div>
        <p className="small">
          Pasted or loaded text, not live recognition. Refreshes every 4
          seconds. Highlighting uses only this published glossary.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="transcript-content">
          {!captions.length ? (
            <Empty title="Ready for your teacher’s words">
              Your teacher can load a transcript or add a classroom note. No
              microphone is active.
            </Empty>
          ) : !filtered.length ? (
            <p>No matching transcript passages.</p>
          ) : (
            filtered.map((c) => (
              <article key={c.id}>
                <div className="caption-meta">
                  <span>
                    {c.source === "loaded_transcript"
                      ? "Loaded transcript"
                      : "Manual note"}
                  </span>
                  <time>{new Date(c.createdAt).toLocaleTimeString()}</time>
                </div>
                <p>
                  {highlightSegments(c.text, lesson.vocabulary).map((seg, i) =>
                    seg.termId ? (
                      <button
                        className="term"
                        aria-pressed={selected === seg.termId}
                        key={i}
                        onClick={() => seg.termId && select(seg.termId)}
                      >
                        {seg.text}
                      </button>
                    ) : (
                      <span key={i}>{seg.text}</span>
                    ),
                  )}
                </p>
                {c.originalText && (
                  <details>
                    <summary>Teacher corrections & original</summary>
                    <p>{c.originalText}</p>
                    <ul>
                      {c.corrections.map((fix, i) => (
                        <li key={i}>
                          {fix.from} → {fix.to}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {session.role === "teacher" && (
                  <CaptionCorrection
                    caption={c}
                    lesson={lesson}
                    onCorrect={(next) => {
                      setCaptions((v) =>
                        v.map((x) => (x.id === next.id ? next : x)),
                      );
                      report(
                        "Technical term corrected. Original transcript retained.",
                      );
                    }}
                  />
                )}
              </article>
            ))
          )}
        </div>
        <button
          disabled={!captions.length}
          onClick={() => {
            const blob = new Blob(
              [captions.map((c) => `[${c.source}] ${c.text}`).join("\n\n")],
              { type: "text/plain" },
            );
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `sahpaath-transcript-v${lesson.version}.txt`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          <Download size={17} aria-hidden="true" />
          Download transcript
        </button>
        {session.role === "teacher" && (
          <form
            className="note-form"
            onSubmit={(e) => {
              e.preventDefault();
              void add(note, "manual_note");
            }}
          >
            <h3>Teacher’s notes</h3>
            <label>
              Add a note or paste a transcript
              <textarea
                required
                maxLength={12000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Write what the class should follow…"
              />
            </label>
            <div className="button-row">
              <button className="primary" disabled={busy || !note.trim()}>
                Add manual note
              </button>
              <button
                type="button"
                disabled={busy || !note.trim()}
                onClick={() => void add(note, "loaded_transcript")}
              >
                Load pasted transcript
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void add(demoTranscript, "loaded_transcript")}
              >
                Load heart sample transcript
              </button>
            </div>
            <FileField
              label="Load a text file"
              hint="Plain text · up to 12 KB"
              accept=".txt,text/plain"
              disabled={busy}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 12000) {
                  setError("Use a text file smaller than 12 KB.");
                  return;
                }
                await add(await file.text(), "loaded_transcript");
              }}
            />
          </form>
        )}
      </section>
      <aside className="glossary-panel">
        <span className="section-kicker">The shared vocabulary</span>
        <h2>{term.name}</h2>
        <Status state="teacher_approved" />
        <p>{term.definition}</p>
        <span className="small">Diagram reference: {term.labelId}</span>
        <div className="button-stack">
          <button className="primary" onClick={() => go("explore")}>
            Explore this <ArrowRight size={16} aria-hidden="true" />
          </button>
          <button className="secondary" onClick={() => go("communicate")}>
            {/* Teachers land on the question inbox, not the asking form. */}
            {session.role === "teacher" ? "See questions about this" : "Ask about this"}
            <MessageCircle size={16} aria-hidden="true" />
          </button>
        </div>
        <WordExplainer lessonId={lesson.lessonId} />
        <SurfaceList term={term.name} published surfaces={surfaces ?? undefined} />
        <h3>All approved terms</h3>
        <ul className="glossary-list">
          {lesson.vocabulary.map((t) => (
            <li key={t.id}>
              <button
                aria-pressed={term.id === t.id}
                onClick={() => select(t.id)}
              >
                {t.name}
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
