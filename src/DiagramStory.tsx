import { memo, useEffect, useRef, useState, type RefObject } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  AudioLines,
  BookOpen,
  Check,
  Hand,
  Keyboard,
  Lock,
  MessageCircle,
  Network,
  ScanText,
  Send,
} from "lucide-react";
import "./diagram-story.css";
import { Anatomy, DiagramDefs, parts, VESSELS } from "./heartDiagram";
import { Words } from "./motion";



const flowName = "Blood through the pulmonary circuit";
// Printed label positions on the source sheet (x = text anchor start).
const labels = [
  { x: 96, y: 452 },
  { x: 262, y: 142 },
  { x: 76, y: 64 },
  { x: 438, y: 300 },
  { x: 452, y: 380 },
];
const leaders = [
  "M150 440 L262 408",
  "M320 150 L320 238",
  "M104 72 L150 110",
  "M436 296 L408 290",
  "M450 376 L398 342",
];
const phrases = [
  "I have a question",
  "Please repeat",
  "I don't understand this step",
  "I need more time",
  "Can I answer?",
];
const surfaces = [
  { icon: Network, name: "Diagram Explorer", detail: "Step 2 of 5 node" },
  { icon: BookOpen, name: "Glossary", detail: "Plain definition" },
  { icon: MessageCircle, name: "Caption highlight", detail: "Live transcript" },
  { icon: AudioLines, name: "Audio description", detail: "Read aloud" },
  { icon: Hand, name: "Question anchor", detail: "Ask about this" },
];
const sentence =
  "Today we are following blood from the Right ventricle to the Pulmonary artery. The Pulmonary artery carries blood toward the Lungs.";

/** Asks the story to travel to a chapter; see goToChapter below. */
export const CHAPTER_EVENT = "sahpaath:chapter";
export function goToChapter(index: number) {
  dispatchEvent(new CustomEvent(CHAPTER_EVENT, { detail: index }));
}

const chapters = [
  {
    label: "One lesson",
    title: "SAME LESSON.\nYOUR WAY IN.",
    body: "SahPaath transforms one teacher-approved lesson into accessible experiences for students who read, hear, and communicate differently.",
  },
  {
    label: "Structure",
    title: "A picture becomes a map.",
    body: "Labels are read from the teacher's diagram and proposed as parts, links and a reading order. Every part must trace back to a label that is really there.",
  },
  {
    label: "Teacher review",
    title: "AI proposes. A teacher decides.",
    body: "Deterministic checks flag anything uncertain. Nothing reaches students until a teacher approves it, and a published version never changes.",
  },
  {
    label: "Explore",
    title: "Explore it without seeing it.",
    body: "Move through the diagram by keyboard, screen reader or audio. Each step says where you are, what the part does and what it connects to.",
  },
  {
    label: "Captions",
    title: "Hard words, made clear.",
    body: "Live captions use the teacher's approved vocabulary. Open any technical term for a plain definition and its place in the diagram.",
  },
  {
    label: "Ask",
    title: "Ask without speaking.",
    body: "Fast phrases plus questions anchored to the exact concept. One or two taps, and the teacher knows precisely what to explain.",
  },
  {
    label: "Shared vocabulary",
    title: "One word.\nEvery way in.",
    body: "Approve “Pulmonary artery” once. It becomes the explorer node, the glossary entry, the caption highlight, the audio description and the question anchor.",
  },
];

/** Chapter names, in order, for anything that offers the story as a list. */
export const storyChapters = chapters.map((c) => c.label);
const last = chapters.length - 1;
const pad = (n: number) => String(n).padStart(2, "0");
const clamp = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
// Camera pose per chapter: rotateX, rotateY, rotateZ (deg), translateX, translateY (%), scale, opacity.
const POSES: number[][] = [
  [46, 0, -10, 0, 4, 0.9, 1],
  [14, 0, -3, 0, 0, 0.94, 1],
  [0, 12, 0, -17, 3, 0.72, 1],
  [0, 10, 0, -15, 3, 0.76, 1],
  [8, 0, 0, 0, -12, 0.8, 1],
  [0, 12, 0, -17, 3, 0.72, 1],
  [0, 0, 0, 0, -4, 0.7, 0.28],
];

export default function DiagramStory({
  onExplore,
  calm = false,
}: {
  onExplore: () => void;
  /** Calm motion setting: no pinned scroll, no depth. */
  calm?: boolean;
}) {
  const root = useRef<HTMLElement>(null);
  const tiltRef = useRef<HTMLDivElement>(null);
  const [chapter, setChapter] = useState(0);
  // Progress inside the current chapter. Quantised, and the illustration only
  // re-renders when one of the things it draws actually changes (see storyFrame).
  const [local, setLocal] = useState(1);
  const [flat, setFlat] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    // Phones keep the simple layout; motion itself follows the Calm motion setting.
    const media = matchMedia("(max-width: 700px)");
    const sync = () => setFlat(calm || media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [calm]);

  useEffect(() => {
    const el = root.current;
    if (flat || !el) {
      root.current?.style.setProperty("--story-progress", "1");
      setLocal(1);
      return;
    }
    let frame = 0;
    let running = true;
    let lastIndex = -1;
    let lastLocal = -1;
    // Pointer tilt target and smoothed value, in degrees.
    const tiltTarget = { x: 0, y: 0 };
    const tiltNow = { x: 0, y: 0 };
    const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;
    const onPointer = (e: PointerEvent) => {
      tiltTarget.x = (e.clientY / innerHeight - 0.5) * -5;
      tiltTarget.y = (e.clientX / innerWidth - 0.5) * 7;
    };
    if (finePointer) addEventListener("pointermove", onPointer, { passive: true });

    /**
     * The scroll-linked values go on the few elements that read them, not on the
     * whole story: a custom property set on the section invalidates the style of
     * every element inside it, once per frame, which is what made scrolling the
     * story feel heavy. React can replace these nodes, so each is looked up again
     * once it leaves the document.
     */
    const targets: Record<string, HTMLElement | null> = {};
    const target = (selector: string) => {
      const found = targets[selector];
      if (found?.isConnected) return found;
      return (targets[selector] = el.querySelector<HTMLElement>(selector));
    };
    const set = (selector: string, name: string, value: string) => target(selector)?.style.setProperty(name, value);

    const tick = () => {
      if (!running) return;
      const rect = el.getBoundingClientRect();
      const progress = clamp(-rect.top / Math.max(1, rect.height - innerHeight));
      const scaled = progress * chapters.length;
      const index = Math.min(last, Math.floor(scaled));
      const within = index === last && progress >= 1 ? 1 : clamp(scaled - index);
      const q = Math.round(within * 40) / 40;
      if (index !== lastIndex) setChapter((lastIndex = index));
      if (q !== lastLocal) setLocal((lastLocal = q));
      // The progress bar follows the scroll through a custom property, so the whole
      // story does not re-render on every frame of it.
      set(".story-progress span", "--story-progress", ((index + within) / chapters.length).toFixed(4));

      // Hold each chapter's camera pose, then travel to the next one over the last 35% of the chapter.
      const t = index < last ? ease(clamp((within - 0.65) / 0.35)) : 0;
      const a = POSES[index];
      const b = POSES[Math.min(last, index + 1)];
      const m = (k: number) => a[k] + (b[k] - a[k]) * t;
      tiltNow.x += (tiltTarget.x - tiltNow.x) * 0.08;
      tiltNow.y += (tiltTarget.y - tiltNow.y) * 0.08;
      const tilt = tiltRef.current;
      if (tilt) {
        tilt.style.transform = `translate(${m(3)}%, ${m(4)}%) rotateX(${m(0) + tiltNow.x}deg) rotateY(${m(1) + tiltNow.y}deg) rotateZ(${m(2)}deg) scale(${m(5)})`;
        tilt.style.opacity = String(m(6));
      }
      // The scanning beam belongs to the reading chapter only: it sweeps once, fades
      // out, and then the proposed structure appears over a settled diagram.
      const sweep = index === 1 ? clamp(within / SCAN_END) : 0;
      set(".scan-bar", "--scan", sweep.toFixed(3));
      set(".scan-bar", "--beam", (index === 1 ? 1 - clamp((within - SCAN_END) / 0.12) : 0).toFixed(3));
      // The diagram "comes alive" across the Teacher review → Explore hand-off.
      set(".living-layer", "--alive", clamp((scaled - 2.6) / 0.5).toFixed(3));
      const cp = within.toFixed(3);
      set(".story-copy", "--cp", cp);
      set(".story-numeral", "--cp", cp);

      frame = requestAnimationFrame(tick);
    };
    // Only animate while the story is on screen.
    const io = new IntersectionObserver(([entry]) => {
      cancelAnimationFrame(frame);
      if (entry.isIntersecting) frame = requestAnimationFrame(tick);
    });
    io.observe(el);
    return () => {
      running = false;
      cancelAnimationFrame(frame);
      io.disconnect();
      removeEventListener("pointermove", onPointer);
      if (tiltRef.current) {
        tiltRef.current.style.transform = "";
        tiltRef.current.style.opacity = "";
      }
      for (const node of Object.values(targets)) {
        node?.style.removeProperty("--alive");
        node?.style.removeProperty("--cp");
        node?.style.removeProperty("--story-progress");
        node?.style.removeProperty("--scan");
        node?.style.removeProperty("--beam");
      }
    };
  }, [flat]);

  // The menu (and anything else on the page) can ask for a chapter by name.
  useEffect(() => {
    const onJump = (e: Event) => jump((e as CustomEvent<number>).detail);
    addEventListener(CHAPTER_EVENT, onJump);
    return () => removeEventListener(CHAPTER_EVENT, onJump);
  }, [flat]); // eslint-disable-line react-hooks/exhaustive-deps

  function jump(index: number) {
    const target = Math.max(0, Math.min(last, index));
    setAnnouncement(`Chapter ${target + 1} of ${chapters.length}: ${chapters[target].label}`);
    const el = root.current;
    if (!flat && el) {
      const top = scrollY + el.getBoundingClientRect().top;
      scrollTo({
        // Land two-thirds into the chapter so its animation has visibly played.
        top: top + (el.offsetHeight - innerHeight) * ((target + 0.66) / chapters.length),
        behavior: "smooth",
      });
    } else {
      setChapter(target);
      setLocal(1);
      root.current?.style.setProperty("--story-progress", String((target + 1) / chapters.length));
    }
  }

  const c = chapters[chapter];
  const p = flat ? 1 : local;

  return (
    <section
      ref={root}
      className={`diagram-story ${flat ? "story-flat" : ""}`}
      aria-label="How one lesson becomes many ways in"
    >
      <div className="story-stage" data-chapter={chapter}>
        <div className="story-progress" aria-hidden="true">
          <span />
        </div>
        <span key={`n${chapter}`} className="story-numeral" aria-hidden="true">
          {pad(chapter + 1)}
        </span>
        <div className="story-top">
          <span className="story-kicker">
            <ScanText size={16} aria-hidden="true" /> A real diagram, step by step
          </span>
        </div>

        <div className="story-copy">
          {chapter === 0 ? (
            <h1 className="story-hero">
              <span className="sr-only">Same lesson. Your way in.</span>
              <span aria-hidden="true">
                <Words text="SAME LESSON." timed />
                <br />
                <span className="hero-accent">
                  <Words text="YOUR WAY IN." timed delay={2} />
                </span>
              </span>
            </h1>
          ) : (
            <>
              <p className="story-brandline">Same lesson. Your way in.</p>
              <span className="story-count" aria-hidden="true">
                {pad(chapter + 1)} — {c.label}
              </span>
              <h2 key={chapter} className="story-title">
                <Words text={c.title} timed />
              </h2>
            </>
          )}
          <p key={`b${chapter}`} className="story-body">
            <Words text={c.body} timed />
          </p>
          {chapter === 0 || chapter === last ? (
            <div className="story-actions">
              <button className="primary" onClick={onExplore}>
                Explore a lesson <ArrowRight size={18} aria-hidden="true" />
              </button>
              <a href="#how-it-works">See how it works</a>
            </div>
          ) : null}
          <div className="story-pager" aria-label="Story controls">
            <button onClick={() => jump(chapter - 1)} disabled={chapter === 0} aria-label="Previous chapter">
              <ArrowLeft size={18} aria-hidden="true" /> Previous
            </button>
            <span aria-hidden="true">
              {pad(chapter + 1)} / {pad(chapters.length)}
            </span>
            <button onClick={() => jump(chapter + 1)} disabled={chapter === last} aria-label="Next chapter">
              Next <ArrowRight size={18} aria-hidden="true" />
            </button>
          </div>
        </div>

        <StoryCanvas chapter={chapter} p={p} tiltRef={tiltRef} />

        <div className="story-bottom">
          <nav aria-label="Lesson story chapters">
            {chapters.map((item, index) => (
              <button
                key={item.label}
                aria-current={chapter === index ? "step" : undefined}
                onClick={() => jump(index)}
              >
                <span>{pad(index + 1)}</span>
                {item.label}
              </button>
            ))}
          </nav>
          <a href="#how-it-works" className="story-skip">
            Skip story <ArrowDown size={16} aria-hidden="true" />
          </a>
        </div>
      </div>
      <p className="sr-only" role="status">
        {announcement}
      </p>
      <div className="sr-only">
        <h2>What the illustration shows</h2>
        <p>
          An illustrative heart diagram with five labels: {parts.map((x) => x.name).join(", ")}. The
          labels are read and proposed as connected parts. One link, Pulmonary artery to Lungs, is
          flagged for review and then approved by the teacher. The diagram is explored step by step
          with spoken descriptions. A caption highlights Pulmonary artery and opens its definition. A
          student sends the question: I don't understand what this does, anchored to Pulmonary
          artery. The same approved term then appears in the explorer, glossary, captions, audio
          description and question.
        </p>
      </div>
    </section>
  );
}

/**
 * What the illustration shows at this point in the story. Everything it draws comes
 * from these few values, so the canvas can skip a re-render while the scroll moves
 * between two thresholds.
 */
/** The beam has finished reading by this point in the chapter. */
const SCAN_END = 0.5;

function storyFrame(chapter: number, p: number) {
  const step = chapter === 3 ? Math.min(4, Math.floor(p * 5)) : -1;
  return {
    // The beam sweeps over the first half of the chapter and the labels are read as
    // it passes; the structure it proposes only appears once it has finished.
    scanned: chapter === 1 ? Math.floor(clamp(p / SCAN_END) * 6) : chapter > 1 ? 5 : 0,
    structured: chapter >= 1 && (chapter > 1 || p > 0.55),
    approved: chapter > 2 || (chapter === 2 && p > 0.55),
    step,
    focus: chapter >= 4 ? 1 : step,
    typed: chapter === 4 ? Math.floor(clamp(p / 0.6) * sentence.length) : sentence.length,
    defined: chapter === 4 && p > 0.62,
    sent: chapter === 5 && p > 0.5,
    alive: chapter >= 3,
  };
}
const sameFrame = (a: { chapter: number; p: number }, b: { chapter: number; p: number }) =>
  a.chapter === b.chapter &&
  JSON.stringify(storyFrame(a.chapter, a.p)) === JSON.stringify(storyFrame(b.chapter, b.p));

/** Decorative, aria-hidden illustration; the text equivalent lives in DiagramStory. */
const StoryCanvas = memo(function StoryCanvas({
  chapter,
  p,
  tiltRef,
}: {
  chapter: number;
  p: number;
  tiltRef: RefObject<HTMLDivElement | null>;
}) {
  const { scanned, structured, approved, step, focus, typed, defined, sent, alive } = storyFrame(chapter, p);

  return (
    <div className={`story-canvas ch-${chapter} ${alive ? "is-alive" : ""}`} aria-hidden="true">
      <div className="canvas-tilt" ref={tiltRef}>
        <div className="lesson-sheet-3d">
          <div className="sheet-head">
            <span>Biology · Illustrative demo lesson</span>
            <span>A journey through the heart</span>
          </div>
          <svg viewBox="0 0 640 500" className="heart-svg" role="presentation">
            <defs>
              <marker id="ds-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
                <path d="M0 0L8 4L0 8Z" className="arrow-head" />
              </marker>
              <DiagramDefs prefix="ds" />
              <linearGradient id="ds-scan" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="#2f6fd0" stopOpacity="0" />
                <stop offset="0.92" stopColor="#2f6fd0" stopOpacity="0.16" />
                <stop offset="1" stopColor="#2f6fd0" stopOpacity="0.9" />
              </linearGradient>
            </defs>
            {/* Printed source layer: what the teacher uploaded. */}
            <g className="print-layer">
              <Anatomy />
            </g>
            {/* Living layer: the same shapes, coloured by meaning, faded in by scroll (--alive). */}
            <g className="living-layer">
              <ellipse cx="320" cy="478" rx="120" ry="10" fill="url(#ds-shadow)" />
              <Anatomy living focus={focus} />
              <g className="flow-dashes">
                <path d={VESSELS.artery[0]} />
                <path d={VESSELS.artery[1]} />
                <path d={VESSELS.veins[0]} />
                <path d={VESSELS.veins[1]} />
              </g>
            </g>
            {/* Printed labels + leader lines (the "source" sheet) */}
            <g className="print-labels">
              {parts.map((part, i) => (
                <g key={part.name} className={`print-label ${focus === i ? "is-focus" : ""}`}>
                  <path d={leaders[i]} className="leader" />
                  <text x={labels[i].x} y={labels[i].y}>
                    {part.name}
                  </text>
                  {/* OCR frame */}
                  <rect
                    className={`ocr-box ${i < scanned ? "is-on" : ""}`}
                    x={labels[i].x - 6}
                    y={labels[i].y - 16}
                    width={part.name.length * 7.6 + 12}
                    height={23}
                    rx="3"
                  />
                  <text className={`ocr-tag ${i < scanned ? "is-on" : ""}`} x={labels[i].x - 6} y={labels[i].y + 20}>
                    label-{i}
                  </text>
                </g>
              ))}
            </g>
            {/* Structure: proposed parts as nodes linked in reading order */}
            <g className={`structure ${structured ? "is-on" : ""}`}>
              {parts.slice(0, -1).map((part, i) => {
                const next = parts[i + 1];
                const flagged = i === 1;
                return (
                  <line
                    key={part.name}
                    x1={part.x}
                    y1={part.y}
                    x2={next.x}
                    y2={next.y}
                    markerEnd="url(#ds-arrow)"
                    className={`link ${flagged ? (approved ? "is-approved" : "is-flagged") : ""}`}
                  />
                );
              })}
              {parts.map((part, i) => (
                <g key={part.name} className={`node ${focus === i ? "is-focus" : ""}`}>
                  <circle cx={part.x} cy={part.y} r="11" />
                  <text x={part.x} y={part.y + 4}>
                    {i + 1}
                  </text>
                </g>
              ))}
            </g>
            <rect className="scan-bar" x="0" width="640" height="60" fill="url(#ds-scan)" />
          </svg>
          <div className="sheet-foot">
            <span>
              <ScanText size={13} /> Source diagram
            </span>
            {chapter >= 1 && <span className="sim-badge">Demo simulation · OCR &amp; AI stages</span>}
          </div>
        </div>
      </div>

      {/* Chapter panels layered over the lesson sheet */}
      <div className="panel panel-proposals">
        <div className="panel-title">
          <Network size={15} /> Proposed links
        </div>
        {parts.slice(0, -1).map((part, i) => {
          const flagged = i === 1;
          const state = flagged ? (approved ? "approved" : "review") : chapter >= 2 ? "validated" : "proposed";
          return (
            <div key={part.name} className={`proposal state-${state}`}>
              <span>
                {part.name} <ArrowRight size={12} /> {parts[i + 1].name}
              </span>
              <em>
                {state === "review" && (
                  <>
                    <AlertTriangle size={13} /> Needs review
                  </>
                )}
                {state === "approved" && (
                  <>
                    <Check size={13} /> Teacher approved
                  </>
                )}
                {state === "validated" && (
                  <>
                    <Check size={13} /> Validated
                  </>
                )}
                {state === "proposed" && <>AI proposed</>}
              </em>
            </div>
          );
        })}
        {chapter === 2 && (
          <div className={`review-note ${approved ? "is-done" : ""}`}>
            {approved ? (
              <>
                <Check size={14} /> “Verified against the source diagram.” Publish unlocked.
              </>
            ) : (
              <>
                <AlertTriangle size={14} /> No evidence label for this link. <Lock size={13} /> Publish locked.
              </>
            )}
          </div>
        )}
      </div>

      <div className="panel panel-explore">
        <div className="panel-title">
          <Keyboard size={15} /> Diagram Explorer · <kbd>↑</kbd> <kbd>↓</kbd>
        </div>
        <ol className="explore-tree">
          {parts.map((part, i) => (
            <li key={part.name} className={i === Math.max(0, step) ? "is-current" : ""}>
              {part.name}
            </li>
          ))}
        </ol>
        <div className="sr-voice">
          <AudioLines size={15} />
          <p>
            {(() => {
              const i = Math.max(0, step);
              const from = i > 0 ? ` Receives from ${parts[i - 1].name}.` : "";
              return `${parts[i].name}. Step ${i + 1} of 5, ${flowName}. ${parts[i].text}${from}`;
            })()}
          </p>
        </div>
      </div>

      <div className="panel panel-caption">
        <div className="panel-title">
          <MessageCircle size={15} /> ClassCaption · live
        </div>
        <p className="caption-line">
          <CaptionText text={sentence.slice(0, typed)} />
          {typed < sentence.length && <i className="caret" />}
        </p>
      </div>
      <div className={`panel panel-define ${defined ? "is-on" : ""}`}>
        <span className="term-status">
          <Check size={13} /> Teacher-approved term
        </span>
        <strong>Pulmonary artery</strong>
        <p>{parts[1].text}</p>
        <div className="define-actions">
          <span>
            <Network size={13} /> Explore this
          </span>
          <span>
            <Hand size={13} /> Ask about this
          </span>
        </div>
      </div>

      <div className="panel panel-ask">
        <div className="panel-title">
          <Hand size={15} /> Classroom communication
        </div>
        <div className="phrase-grid">
          {phrases.map((phrase, i) => (
            <span key={phrase} className={i === 2 && chapter === 5 && p > 0.25 ? "is-pressed" : ""}>
              {phrase}
            </span>
          ))}
        </div>
        <div className={`anchored ${sent ? "is-sent" : ""}`}>
          <span className="anchor-chip">Ask about · Pulmonary artery</span>
          <p>I don't understand what this does.</p>
          <em>
            {sent ? (
              <>
                <Check size={13} /> Sent to teacher · anchored to the concept
              </>
            ) : (
              <>
                <Send size={13} /> One tap to send
              </>
            )}
          </em>
        </div>
      </div>

      <div className="panel panel-shared">
        <div className="shared-core">
          <span className="term-status">
            <Check size={13} /> Approved once
          </span>
          <strong>Pulmonary artery</strong>
        </div>
        {surfaces.map(({ icon: Icon, name, detail }, i) => (
          <div key={name} className={`surface s-${i}`} style={{ transitionDelay: `${i * 90}ms` }}>
            <Icon size={16} />
            <span>
              <b>{name}</b>
              <small>{detail}</small>
            </span>
          </div>
        ))}
        <svg className="shared-lines" viewBox="0 0 100 100" preserveAspectRatio="none">
          {[
            [50, 50, 12, 16],
            [50, 50, 88, 16],
            [50, 50, 6, 62],
            [50, 50, 94, 62],
            [50, 50, 50, 92],
          ].map(([x1, y1, x2, y2], i) => (
            <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />
          ))}
        </svg>
      </div>
    </div>
  );
}, sameFrame);

function CaptionText({ text }: { text: string }) {
  const pieces = text.split(/(Pulmonary artery)/g);
  return (
    <>
      {pieces.map((piece, i) =>
        piece === "Pulmonary artery" ? <mark key={i}>{piece}</mark> : <span key={i}>{piece}</span>,
      )}
    </>
  );
}
