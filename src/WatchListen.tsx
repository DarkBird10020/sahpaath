import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Captions as CaptionsIcon, FileText, Sparkles } from "lucide-react";
import { api, fileBase64 } from "./api";
import WordExplainer from "./WordExplainer";

type Segment = { startMs: number; endMs: number; text: string };
type HardWord = { word: string; meaning: string };
const transcriptSchema = z.object({
  segments: z.array(z.object({ startMs: z.number(), endMs: z.number(), text: z.string() })),
  hardWords: z.array(z.object({ word: z.string(), meaning: z.string() })),
  model: z.string(),
});

/** Parses WebVTT or SRT subtitles into timed segments. */
export function parseSubtitles(text: string): Segment[] {
  const time = (t: string) => {
    const m = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/.exec(t.trim());
    if (!m) return NaN;
    return ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4].padEnd(3, "0"));
  };
  const out: Segment[] = [];
  for (const block of text.replace(/\r/g, "").split(/\n{2,}/)) {
    const lines = block.split("\n");
    const at = lines.findIndex((l) => l.includes("-->"));
    if (at < 0) continue;
    const [a, b] = lines[at].split("-->");
    const caption = lines.slice(at + 1).join(" ").replace(/<[^>]+>/g, "").trim();
    const startMs = time(a);
    const endMs = time(b.split(" ").filter(Boolean)[0] ?? "");
    if (caption && Number.isFinite(startMs) && Number.isFinite(endMs)) out.push({ startMs, endMs, text: caption });
  }
  return out.sort((x, y) => x.startMs - y.startMs);
}

const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Splits a caption into plain text and hard-word buttons. */
function withHardWords(text: string, words: HardWord[]) {
  const list = words.map((w) => w.word).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!list.length) return [{ text, word: null as HardWord | null }];
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(${list.map(escape).join("|")})(?![\\p{L}\\p{N}])`, "giu");
  const parts: { text: string; word: HardWord | null }[] = [];
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    const i = m.index ?? 0;
    if (i > last) parts.push({ text: text.slice(last, i), word: null });
    parts.push({ text: m[0], word: words.find((w) => w.word.toLowerCase() === m[0].toLowerCase()) ?? null });
    last = i + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), word: null });
  return parts;
}

export default function WatchListen({ report }: { report: (m: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [hardWords, setHardWords] = useState<HardWord[]>([]);
  const [source, setSource] = useState<string>("");
  const [now, setNow] = useState(0);
  const [picked, setPicked] = useState<HardWord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const media = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  const isVideo = !!file?.type.startsWith("video/");
  const current = segments.findIndex((s) => now >= s.startMs && now < Math.max(s.endMs, s.startMs + 500));

  async function createCaptions() {
    if (!file) return;
    if (file.size > 10_000_000) {
      setError("For AI captions, use a recording below 10 MB (about 5 minutes of audio). Or load a subtitle file.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const t = await api("/ai/transcribe", transcriptSchema, "POST", { mime: file.type, base64: await fileBase64(file) });
      setSegments(t.segments);
      setHardWords(t.hardWords);
      setSource(`AI captions (${t.model}). They can contain mistakes.`);
      report(`${t.segments.length} caption lines and ${t.hardWords.length} hard words ready.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const nowLine = current >= 0 ? segments[current] : null;
  return (
    <div className="workspace ai-page">
      <span className="section-kicker">Watch &amp; listen</span>
      <h1>Captions that explain the hard words.</h1>
      <p className="ai-intro">
        Load a lesson video, a lecture recording or an audiobook chapter. Get captions that follow along, then tap any
        highlighted word for a simple meaning.
      </p>
      <div className="ai-upload">
        <label>
          Video or audio file
          <input
            type="file"
            accept="video/mp4,video/webm,video/quicktime,audio/*"
            onChange={(e) => {
              const chosen = e.target.files?.[0] ?? null;
              setFile(chosen);
              setUrl(chosen ? URL.createObjectURL(chosen) : "");
              setSegments([]);
              setHardWords([]);
              setSource("");
              setPicked(null);
              setError("");
            }}
          />
        </label>
        <button className="primary" disabled={!file || busy} onClick={() => void createCaptions()}>
          <Sparkles size={17} aria-hidden="true" />
          {busy ? "Creating captions…" : "Create captions with AI"}
        </button>
        <label>
          Or load subtitles (.vtt or .srt), free and instant
          <input
            type="file"
            accept=".vtt,.srt,text/vtt"
            onChange={async (e) => {
              const sub = e.target.files?.[0];
              if (!sub) return;
              const parsed = parseSubtitles(await sub.text());
              if (!parsed.length) {
                setError("No captions found in that file. Use a .vtt or .srt subtitle file.");
                return;
              }
              setSegments(parsed);
              setHardWords([]);
              setSource(`Subtitles from ${sub.name}.`);
              setError("");
            }}
          />
        </label>
      </div>
      {busy && (
        <p role="status" className="ai-progress">
          Listening and writing captions… a one-minute recording takes a few seconds.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {url && (
        <div className="watch-layout">
          <section aria-label="Player">
            {isVideo ? (
              <video ref={media} src={url} controls onTimeUpdate={(e) => setNow(e.currentTarget.currentTime * 1000)} />
            ) : (
              <audio ref={media} src={url} controls onTimeUpdate={(e) => setNow(e.currentTarget.currentTime * 1000)} />
            )}
            <div className="caption-now" aria-label="Current caption">
              {nowLine
                ? withHardWords(nowLine.text, hardWords).map((p, i) =>
                    p.word ? (
                      <button key={i} className="term" aria-pressed={picked?.word === p.word.word} onClick={() => setPicked(p.word)}>
                        {p.text}
                      </button>
                    ) : (
                      <span key={i}>{p.text}</span>
                    ),
                  )
                : segments.length
                  ? "…"
                  : "Captions appear here."}
            </div>
            {source && (
              <p className="small">
                <CaptionsIcon size={14} aria-hidden="true" /> {source}
              </p>
            )}
            {picked && (
              <div className="word-card" role="status">
                <span className="ai-badge">
                  <Sparkles size={13} aria-hidden="true" /> AI explanation
                </span>
                <h4>{picked.word}</h4>
                <p>{picked.meaning}</p>
              </div>
            )}
          </section>
          <aside>
            {segments.length > 0 && (
              <>
                <h2>
                  <FileText size={18} aria-hidden="true" /> Transcript
                </h2>
                <ol className="transcript-list">
                  {segments.map((s, i) => (
                    <li key={i}>
                      <button
                        aria-current={i === current ? "true" : undefined}
                        onClick={() => {
                          if (media.current) {
                            media.current.currentTime = s.startMs / 1000;
                            void media.current.play().catch(() => {});
                          }
                        }}
                      >
                        <span className="small">{clock(s.startMs)}</span> {s.text}
                      </button>
                    </li>
                  ))}
                </ol>
              </>
            )}
            {hardWords.length > 0 && (
              <>
                <h2>Hard words</h2>
                <dl className="ai-words">
                  {hardWords.map((w) => (
                    <div key={w.word}>
                      <dt>{w.word}</dt>
                      <dd>{w.meaning}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
            <WordExplainer context={nowLine?.text ?? null} />
          </aside>
        </div>
      )}
    </div>
  );
}
