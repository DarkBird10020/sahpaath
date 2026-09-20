import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Mic, MicOff, Square, Keyboard, PlayCircle, Download } from "lucide-react";
import { startLiveTranscription } from "./lib/liveTranscribe";
import { requestMicrophone, quietSpeechErrors, speechErrorMessage } from "./lib/microphone";
import { api } from "./api";
import {
  captionSessionSchema,
  liveCaptionSchema,
  segmentSchema,
  type CaptionSource,
  type LiveCaption,
  type Published,
  type Session,
} from "../shared/schema";
import { normalize } from "../shared/domain";
import { segmentsFromHits } from "../shared/vocabulary";

const sourceLabel: Record<CaptionSource, string> = {
  transcribe: "Amazon Transcribe",
  browser_speech: "Browser speech recognition · your browser’s own speech service, not AWS",
  ai_speech: "AI speech-to-text · microphone audio is sent to Google Gemini; lines appear a few seconds after speaking",
  typed: "Typed live by the teacher",
  demo_script: "Demo simulation · scripted lecture lines",
};
// Includes one misheard term so the glossary match is visible in a demo.
const sampleLecture = [
  "Today we follow blood as it leaves the right ventricle.",
  "It travels through the pulmonary artary toward the lungs.",
  "In the lungs, the blood takes in oxygen and releases carbon dioxide.",
  "The pulmonary veins carry it back to the left atrium.",
];

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
const aiTranscriptSchema = z.object({
  segments: z.array(z.object({ startMs: z.number(), endMs: z.number(), text: z.string() })),
});
const Recognizer = (): (new () => Recognition) | undefined =>
  (window as unknown as Record<string, new () => Recognition>).SpeechRecognition ??
  (window as unknown as Record<string, new () => Recognition>).webkitSpeechRecognition;

export default function LiveCaptions({
  lesson,
  session,
  selected,
  select,
  query,
  report,
}: {
  lesson: Published;
  session: Session;
  selected: string;
  select: (id: string) => void;
  query: string;
  report: (m: string) => void;
}) {
  const [live, setLive] = useState<LiveCaption | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  // Microphone problems stay until the next attempt; the poll below clears `error` every tick.
  const [micError, setMicError] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const stopAi = useRef<(() => Promise<void>) | null>(null);
  const lastInterim = useRef(0);
  const teacher = session.role === "teacher";
  const isLive = live?.session.status === "live";

  const load = async () => {
    const sessions = await api(
      `/caption-sessions?lessonId=${lesson.lessonId}`,
      z.array(captionSessionSchema),
    );
    const current = [...sessions].reverse().find((s) => s.status === "live") ?? sessions.at(-1);
    setLive(current ? await api(`/caption-sessions/${current.id}`, liveCaptionSchema) : null);
  };
  useEffect(() => {
    let active = true;
    const tick = () =>
      void load()
        .then(() => active && setError(""))
        .catch((e) => active && setError((e as Error).message));
    tick();
    const timer = setInterval(tick, 1500);
    return () => {
      active = false;
      clearInterval(timer);
      recognition.current?.stop();
      void stopAi.current?.();
    };
  }, [lesson.lessonId, lesson.version]); // eslint-disable-line react-hooks/exhaustive-deps

  async function post(sessionId: string, text: string, isFinal: boolean) {
    if (!text.trim()) return;
    const path = `/caption-sessions/${sessionId}/segments`;
    if (isFinal) await api(path, segmentSchema, "POST", { text, isFinal });
    else await api(path, z.object({ partial: z.string() }), "POST", { text, isFinal });
  }
  async function start(source: CaptionSource) {
    setBusy(true);
    setError("");
    setMicError("");
    try {
      if (source === "browser_speech" || source === "ai_speech") {
        const problem = await requestMicrophone();
        if (problem) {
          setMicError(problem);
          return;
        }
      }
      const s = await api("/caption-sessions", captionSessionSchema, "POST", { lessonId: lesson.lessonId, source });
      await load();
      report(`Live captions started: ${sourceLabel[s.source]}.`);
      if (source === "browser_speech") void listen(s.id);
      if (source === "ai_speech") void listenAi(s.id);
      if (source === "demo_script") await playSample(s.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function playSample(sessionId: string) {
    for (const line of sampleLecture) {
      await post(sessionId, line.split(" ").slice(0, 5).join(" "), false);
      await load();
      await new Promise((r) => setTimeout(r, 700));
      await post(sessionId, line, true);
      await load();
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  async function listen(sessionId: string) {
    const R = Recognizer();
    if (!R) {
      setMicError("This browser has no speech recognition. Type captions instead.");
      return;
    }
    const problem = await requestMicrophone();
    if (problem) {
      setMicError(problem);
      return;
    }
    setMicError("");
    const rec = new R();
    rec.lang = "en-IN";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0].transcript.trim();
        if (!r.isFinal && Date.now() - lastInterim.current < 400) continue;
        if (!r.isFinal) lastInterim.current = Date.now();
        void post(sessionId, text, r.isFinal).catch((err) => setError((err as Error).message));
      }
    };
    rec.onerror = (e) => {
      if (quietSpeechErrors.has(e.error)) return;
      // A real failure: stop the auto-restart so it cannot loop on the same error.
      if (recognition.current === rec) recognition.current = null;
      setListening(false);
      setMicError(speechErrorMessage(e.error));
    };
    rec.onend = () => {
      if (recognition.current === rec) {
        try {
          rec.start();
        } catch {
          setListening(false);
        }
      }
    };
    recognition.current = rec;
    rec.start();
    setListening(true);
  }
  async function listenAi(sessionId: string) {
    const problem = await requestMicrophone();
    if (problem) {
      setMicError(problem);
      return;
    }
    setMicError("");
    try {
      stopAi.current = await startLiveTranscription({
        onChunk: async (base64, offsetMs) => {
          const t = await api("/ai/transcribe", aiTranscriptSchema, "POST", { mime: "audio/wav", base64, offsetMs });
          for (const seg of t.segments) await post(sessionId, seg.text, true);
          await load();
        },
        onError: (message) => setMicError(`Live captions paused: ${message}`),
      });
      setListening(true);
    } catch (e) {
      setMicError((e as Error).message || "The microphone could not be opened. Type captions instead.");
    }
  }
  function stopListening() {
    const stop = stopAi.current;
    stopAi.current = null;
    void stop?.();
    const rec = recognition.current;
    recognition.current = null;
    rec?.stop();
    setListening(false);
  }
  async function end() {
    if (!live) return;
    stopListening();
    setBusy(true);
    try {
      await api(`/caption-sessions/${live.session.id}/end`, captionSessionSchema, "POST");
      await load();
      report("Caption session ended. The transcript stays searchable.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const q = normalize(query);
  const segments = (live?.segments ?? []).filter((s) => !q || normalize(s.text).includes(q));
  return (
    <section className="live-captions" aria-labelledby="live-captions-heading">
      <div className="panel-heading">
        <h3 id="live-captions-heading">Live captions</h3>
        {live && (
          <span className={live.session.source === "demo_script" ? "simulation" : "small"}>
            {isLive ? "Live · " : "Ended · "}
            {sourceLabel[live.session.source]}
          </span>
        )}
      </div>
      <p className="small">
        Captions support, and do not replace, sign-language interpretation.
        Approved lesson terms are highlighted; lines are shown exactly as heard.
      </p>
      {(micError || error) && (
        <p className="error" role="alert">
          {micError || error}
        </p>
      )}
      {!live ? (
        <p>{teacher ? "No caption session yet for this version." : "Captions appear here when your teacher starts them."}</p>
      ) : (
        <div className="live-lines" role="log" aria-live="polite" aria-label="Caption lines">
          {segments.map((s) => {
            const near = s.matchedTerms.filter((h) => h.method === "near_spelling");
            return (
              <article key={s.id}>
                <div className="caption-meta">
                  <span>{`${Math.floor(s.startMs / 60000)}:${String(Math.floor(s.startMs / 1000) % 60).padStart(2, "0")}`}</span>
                </div>
                <p>
                  {segmentsFromHits(s.text, s.matchedTerms).map((seg, i) =>
                    seg.termId ? (
                      <button
                        key={i}
                        className="term"
                        aria-pressed={selected === seg.termId}
                        onClick={() => select(seg.termId!)}
                      >
                        {seg.text}
                      </button>
                    ) : (
                      <span key={i}>{seg.text}</span>
                    ),
                  )}
                </p>
                {near.map((h) => (
                  <p className="heard-as" key={h.start}>
                    Heard “{h.matched}” · matched to approved term <strong>{h.canonical}</strong>
                  </p>
                ))}
              </article>
            );
          })}
          {isLive && live.partial && (
            <p className="partial" aria-hidden="true">
              {live.partial}…
            </p>
          )}
          {!segments.length && !live.partial && <p className="small">{q ? "No matching caption lines." : "Waiting for the first line."}</p>}
        </div>
      )}
      <div className="button-row">
        {live && live.segments.length > 0 && (
          <a className="button-link" href={`/api/caption-sessions/${live.session.id}/export`} download>
            <Download size={17} aria-hidden="true" />
            Download captions & term index
          </a>
        )}
      </div>
      {teacher &&
        (isLive ? (
          <div className="live-controls">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const text = typed;
                setTyped("");
                void post(live.session.id, text, true)
                  .then(load)
                  .catch((err) => setError((err as Error).message));
              }}
            >
              <label>
                Type a caption line
                <input value={typed} maxLength={2000} onChange={(e) => setTyped(e.target.value)} />
              </label>
              <button disabled={!typed.trim()}>
                <Keyboard size={17} aria-hidden="true" />
                Add line
              </button>
            </form>
            <div className="button-row">
              {(Recognizer() || live.session.source === "ai_speech") &&
                (listening ? (
                  <button onClick={stopListening}>
                    <MicOff size={17} aria-hidden="true" />
                    Stop microphone
                  </button>
                ) : (
                  <button onClick={() => void (live.session.source === "ai_speech" ? listenAi(live.session.id) : listen(live.session.id))}>
                    <Mic size={17} aria-hidden="true" />
                    Use microphone
                  </button>
                ))}
              <button disabled={busy} onClick={() => void end()}>
                <Square size={16} aria-hidden="true" />
                End caption session
              </button>
            </div>
          </div>
        ) : (
          <div className="button-row live-controls">
            <button className="primary" disabled={busy} onClick={() => void start("ai_speech")}>
              <Mic size={17} aria-hidden="true" />
              Start with microphone
            </button>
            {Recognizer() && (
              <button disabled={busy} onClick={() => void start("browser_speech")}>
                <Mic size={17} aria-hidden="true" />
                Use browser speech instead
              </button>
            )}
            <button disabled={busy} onClick={() => void start("typed")}>
              <Keyboard size={17} aria-hidden="true" />
              Start typed captions
            </button>
            <button disabled={busy} onClick={() => void start("demo_script")}>
              <PlayCircle size={17} aria-hidden="true" />
              Play sample lecture
            </button>
            <span className="simulation">Sample lecture = Demo simulation</span>
          </div>
        ))}
      {teacher && (
        <p className="small">
          “Start with microphone” sends short audio parts to Google Gemini and adds each line a few
          seconds after it is spoken. “Use browser speech” uses your browser’s own speech service
          instead. Amazon Transcribe is not connected.
        </p>
      )}
    </section>
  );
}
