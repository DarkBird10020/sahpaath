import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Captions as CaptionsIcon, FileText, Film, Search, Sparkles } from "lucide-react";
import { api, fileBase64 } from "./api";
import WordExplainer from "./WordExplainer";
import { CaptionsWorking, Spinner } from "./Working";
import { decodeToMono, encodeWav, MAX_SECONDS, planChunks, SAMPLE_RATE } from "./audioChunks";
import { loadYouTubeApi, type YouTubePlayer } from "./youtubePlayer";

type Segment = { startMs: number; endMs: number; text: string };
type HardWord = { word: string; meaning: string };
const transcriptSchema = z.object({
  segments: z.array(z.object({ startMs: z.number(), endMs: z.number(), text: z.string() })),
  hardWords: z.array(z.object({ word: z.string(), meaning: z.string() })),
  model: z.string(),
});
const videoSchema = z.object({
  videoId: z.string(),
  title: z.string(),
  channel: z.string(),
  publishedAt: z.string(),
  thumbUrl: z.string(),
  durationSeconds: z.number(),
  tooLong: z.boolean(),
});
type Video = z.infer<typeof videoSchema>;
const searchSchema = z.object({ results: z.array(videoSchema) });

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
const length = (seconds: number) => clock(seconds * 1000);
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
  const [progress, setProgress] = useState("");
  const [audioOnly, setAudioOnly] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Video[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [video, setVideo] = useState<Video | null>(null);
  const media = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const mount = useRef<HTMLDivElement>(null);
  const player = useRef<YouTubePlayer | null>(null);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  const isVideo = !!file?.type.startsWith("video/");
  const current = segments.findIndex((s) => now >= s.startMs && now < Math.max(s.endMs, s.startMs + 500));

  /** Builds the embedded player for the chosen video and follows its clock. */
  useEffect(() => {
    if (!video) return;
    let stop = false;
    let timer = 0;
    void loadYouTubeApi()
      .then((YT) => {
        if (stop || !mount.current) return;
        player.current = new YT.Player(mount.current, {
          videoId: video.videoId,
          host: "https://www.youtube-nocookie.com",
          playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
          events: {
            onReady: () => {
              // Four times a second is enough for a caption line and costs
              // nothing next to the video itself.
              timer = window.setInterval(() => {
                const t = player.current?.getCurrentTime();
                if (typeof t === "number") setNow(t * 1000);
              }, 250);
            },
          },
        });
      })
      .catch((e: Error) => setError(e.message));
    return () => {
      stop = true;
      clearInterval(timer);
      player.current?.destroy();
      player.current = null;
    };
  }, [video]);

  /** One source at a time: picking a video clears a loaded file, and vice versa. */
  function reset() {
    setSegments([]);
    setHardWords([]);
    setSource("");
    setPicked(null);
    setError("");
    setNow(0);
  }
  function chooseVideo(chosen: Video | null) {
    reset();
    setFile(null);
    setUrl("");
    setAudioOnly(false);
    setVideo(chosen);
  }

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setError("");
    try {
      const found = await api(`/youtube/search?q=${encodeURIComponent(query.trim())}`, searchSchema);
      setResults(found.results);
      report(found.results.length ? `${found.results.length} videos found.` : "No videos found.");
    } catch (err) {
      setError((err as Error).message);
      setResults(null);
    } finally {
      setSearching(false);
    }
  }

  /** Captions for the chosen YouTube video: one call, read by the AI from its address. */
  async function captionVideo() {
    if (!video) return;
    setBusy(true);
    reset();
    try {
      setProgress(`Watching “${video.title}” and writing captions…`);
      const t = await api("/ai/transcribe-youtube", transcriptSchema, "POST", { videoId: video.videoId });
      setSegments(t.segments);
      setHardWords(t.hardWords);
      setSource(`AI captions (${t.model}). They can contain mistakes.`);
      report(`Captions ready: ${t.segments.length} lines, ${t.hardWords.length} hard words.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  /** Jumps whichever player is showing to a caption's start time. */
  function seek(startMs: number) {
    if (player.current) {
      player.current.seekTo(startMs / 1000, true);
      player.current.playVideo();
    } else if (media.current) {
      media.current.currentTime = startMs / 1000;
      void media.current.play().catch(() => {});
    }
  }

  /** One part to the AI, waiting and retrying if the free-tier limit is hit. */
  async function transcribePart(base64: string, mime: string, offsetMs: number) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await api("/ai/transcribe", transcriptSchema, "POST", { mime, base64, offsetMs });
      } catch (e) {
        const message = (e as Error).message;
        if (attempt >= 3 || !/limit|busy|try again|Too many/i.test(message)) throw e;
        setProgress(`Waiting for the free AI limit to reset, then continuing…`);
        await new Promise((r) => setTimeout(r, 15_000 * (attempt + 1)));
      }
    }
  }
  async function createCaptions() {
    if (!file) return;
    setBusy(true);
    setError("");
    setSegments([]);
    setHardWords([]);
    setPicked(null);
    try {
      setProgress("Reading the audio…");
      let samples: Float32Array | null = null;
      try {
        samples = await decodeToMono(file);
      } catch {
        samples = null;
      }
      const parts: { base64: string; mime: string; offsetMs: number }[] = [];
      if (samples) {
        const seconds = samples.length / SAMPLE_RATE;
        if (seconds > MAX_SECONDS) {
          setError(`This recording is ${Math.round(seconds / 60)} minutes long. AI captions support up to 30 minutes; trim it or load a subtitle file.`);
          return;
        }
        for (const [start, end] of planChunks(samples))
          parts.push({
            base64: await fileBase64(new Blob([encodeWav(samples.subarray(start, end))], { type: "audio/wav" })),
            mime: "audio/wav",
            offsetMs: Math.round((start / SAMPLE_RATE) * 1000),
          });
      } else if (file.size <= 10_000_000) {
        // The browser could not decode it; small files go to the AI as they are.
        parts.push({ base64: await fileBase64(file), mime: file.type, offsetMs: 0 });
      } else {
        setError("This browser could not read the file's audio. Use MP3, M4A, WAV, OGG, MP4 or WebM, or load a subtitle file.");
        return;
      }
      const words = new Map<string, HardWord>();
      let model = "";
      for (let i = 0; i < parts.length; i++) {
        setProgress(parts.length > 1 ? `Writing captions: part ${i + 1} of ${parts.length}…` : "Writing captions…");
        const t = await transcribePart(parts[i].base64, parts[i].mime, parts[i].offsetMs);
        model = t.model;
        // Captions appear part by part while the rest are still being written.
        setSegments((prev) => [...prev, ...t.segments].sort((a, b) => a.startMs - b.startMs));
        for (const w of t.hardWords) if (!words.has(w.word.toLowerCase())) words.set(w.word.toLowerCase(), w);
        setHardWords([...words.values()]);
      }
      setSource(`AI captions (${model}). They can contain mistakes.`);
      report(`Captions ready: ${parts.length > 1 ? `${parts.length} parts, ` : ""}${words.size} hard words.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setProgress("");
    }
  }
  const nowLine = current >= 0 ? segments[current] : null;
  return (
    <div className="workspace ai-page">
      <span className="section-kicker">Watch &amp; listen</span>
      <h1>Captions that explain the hard words.</h1>
      <p className="ai-intro">
        Search YouTube for a lesson, or load a video, a lecture recording or an audiobook chapter of your own (up to 30
        minutes). Get captions that follow along, then tap any highlighted word for a simple meaning.
      </p>
      <form className="yt-search" onSubmit={(e) => void search(e)}>
        <label>
          Search YouTube for a lesson, or paste a video link
          <input
            type="search"
            value={query}
            placeholder="e.g. pulmonary circulation class 10"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button className="primary" disabled={!query.trim() || searching}>
          <Search size={17} aria-hidden="true" />
          {searching ? "Searching…" : "Search"}
        </button>
      </form>
      {results !== null && (
        <div className="yt-results" role="group" aria-label="Search results">
          {results.length === 0 && <p className="small">No videos found. Try different words, or load a file below.</p>}
          {results.map((r) => (
            <button
              key={r.videoId}
              type="button"
              className="yt-result"
              aria-pressed={video?.videoId === r.videoId}
              onClick={() => chooseVideo(r)}
            >
              <img src={r.thumbUrl} alt="" width={120} height={90} loading="lazy" />
              <span className="yt-result-meta">
                <strong>{r.title}</strong>
                <small>
                  {r.channel} · {length(r.durationSeconds)}
                  {r.tooLong ? " · too long for AI captions" : ""}
                </small>
              </span>
            </button>
          ))}
        </div>
      )}
      {video && (
        <div className="ai-upload">
          <p className="yt-chosen">
            <Film size={17} aria-hidden="true" /> {video.title}
            <small>
              {video.channel} · {length(video.durationSeconds)}
            </small>
          </p>
          <button className="primary" disabled={busy || video.tooLong} aria-busy={busy} onClick={() => void captionVideo()}>
            {busy ? <Spinner /> : <Sparkles size={17} aria-hidden="true" />}
            {busy ? "Creating captions…" : "Create captions with AI"}
          </button>
          <button type="button" onClick={() => chooseVideo(null)}>
            Clear
          </button>
          {video.tooLong && (
            <p className="small">
              This video is {length(video.durationSeconds)} long. AI captions support up to 30 minutes — you can still
              watch it here with YouTube's own captions.
            </p>
          )}
        </div>
      )}
      <div className="ai-upload">
        {/* Hidden while a YouTube video is chosen: two identical "Create
            captions with AI" buttons on screen at once asked the reader to
            work out which one they meant. Clear brings this back. */}
        {!video && (
          <>
            <label>
              Video or audio file
              <input
                type="file"
                accept="video/*,audio/*"
                onChange={(e) => {
                  const chosen = e.target.files?.[0] ?? null;
                  reset();
                  setVideo(null);
                  setFile(chosen);
                  setUrl(chosen ? URL.createObjectURL(chosen) : "");
                  setAudioOnly(false);
                }}
              />
            </label>
            <button className="primary" disabled={!file || busy} aria-busy={busy} onClick={() => void createCaptions()}>
              {busy ? <Spinner /> : <Sparkles size={17} aria-hidden="true" />}
              {busy ? "Creating captions…" : "Create captions with AI"}
            </button>
          </>
        )}
        <label>
          {/* Subtitles work for a chosen video too: our own player follows them. */}
          {video ? "Subtitles for this video (.vtt or .srt), free and instant" : "Or load subtitles (.vtt or .srt), free and instant"}
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
      {busy && <CaptionsWorking progress={progress || "Listening to the recording…"} />}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {(url || video) && (
        <div className="watch-layout">
          <section aria-label="Player">
            {video ? (
              <div className="yt-player">
                <div ref={mount} />
              </div>
            ) : isVideo ? (
              <video
                ref={media}
                src={url}
                controls
                className={audioOnly ? "audio-only" : undefined}
                // Some audio files are labelled as video (e.g. .mpeg); hide the empty picture.
                onLoadedMetadata={(e) => setAudioOnly(e.currentTarget.videoWidth === 0)}
                onTimeUpdate={(e) => setNow(e.currentTarget.currentTime * 1000)}
              />
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
                        onClick={() => seek(s.startMs)}
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
