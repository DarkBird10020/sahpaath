import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import {
  Check,
  Circle,
  AlertTriangle,
  X,
  BookOpen,
  AudioLines,
  MessageCircle,
  ArrowUpRight,
  Network,
  Upload,
} from "lucide-react";
import type { DiagramMap, Published, TermSurfaces } from "../shared/schema";
import { partNumber } from "../shared/domain";

export function Status({ state }: { state: string }) {
  const info: Record<string, [string, typeof Check]> = {
    teacher_approved: ["Teacher approved", Check],
    validated: ["Validated · review next", Circle],
    ai_proposed: ["Proposed", Circle],
    needs_review: ["Needs review", AlertTriangle],
    rejected: ["Rejected", X],
    published: ["Published", Check],
    question_queued: ["Waiting for teacher", Circle],
    question_seen: ["Teacher saw this", Check],
    question_answered: ["Teacher answered", Check],
    question_dismissed: ["Dismissed", X],
  };
  const [label, Icon] = info[state] || [state, Circle];
  return (
    <span className={`status ${state}`}>
      <Icon size={14} aria-hidden="true" />
      {label}
    </span>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty">
      <BookOpen aria-hidden="true" size={32} />
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}
/**
 * A file field in the app's own hand. The browser's own control is a grey box
 * reading "Choose File / No file chosen", in the operating system's font: it is
 * the one thing on these pages that does not belong to them. The real input is
 * still here, laid over the strip, so clicking, tabbing and dropping all work
 * exactly as before - only the paint is ours, and the chosen file is named.
 */
export function FileField({
  label,
  hint = "No file chosen yet",
  className,
  onChange,
  ...rest
}: { label: ReactNode; hint?: string; className?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const [chosen, setChosen] = useState("");
  const handle = (event: ChangeEvent<HTMLInputElement>) => {
    setChosen(event.target.files?.[0]?.name ?? "");
    onChange?.(event);
  };
  return (
    <label className={className ? `file-field ${className}` : "file-field"}>
      <span className="file-field-label">{label}</span>
      <span className="file-drop">
        <input type="file" onChange={handle} {...rest} />
        {/* Paint only: the input itself already announces that it takes a file
            and which one is chosen, so these must not join its name. */}
        <span className="file-drop-button" aria-hidden="true">
          <Upload size={16} />
          Choose a file
        </span>
        <span className={chosen ? "file-drop-name is-chosen" : "file-drop-name"} aria-hidden="true">
          {chosen || hint}
        </span>
      </span>
    </label>
  );
}
export function Diagram({
  map,
  selected,
  onSelect,
  image,
  imageSrc,
  showSpots = false,
}: {
  map: DiagramMap;
  selected?: string;
  onSelect?: (id: string) => void;
  image?: string | null;
  /** A local picture (e.g. a learner's upload) instead of a stored lesson image. */
  imageSrc?: string;
  /** Always show numbered markers (they otherwise appear on hover/focus). */
  showSpots?: boolean;
}) {
  const [imageError, setImageError] = useState(false);
  useEffect(() => setImageError(false), [image, imageSrc]);
  const src = imageSrc ?? (image ? `/api/images/${image}` : null);
  return (
    <div className={`diagram ${src ? "original" : ""} ${showSpots ? "show-spots" : ""}`}>
      {src ? (
        imageError ? (
          <div className="empty" role="alert">
            <p>
              The original image could not be displayed. Use the structured text
              or retry loading it.
            </p>
            <button onClick={() => setImageError(false)}>Retry image</button>
          </div>
        ) : (
          <img
            onError={() => setImageError(true)}
            src={src}
            alt="Original teacher-uploaded diagram. Its reviewed text equivalent is alongside."
          />
        )
      ) : (
        <svg
          viewBox="0 0 440 500"
          role="img"
          aria-label="Simplified source schematic. Read the concepts in the adjacent text view."
        >
          <defs>
            <pattern
              id="paper-grid"
              width="22"
              height="22"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M22 0H0V22"
                fill="none"
                stroke="#dce5ed"
                strokeWidth=".8"
              />
            </pattern>
            <marker
              id="arrow"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
            >
              <path d="M0 0L8 4L0 8" fill="#467a8b" />
            </marker>
          </defs>
          <rect width="440" height="500" fill="url(#paper-grid)" />
          {map.relations
            .filter((r) => r.state !== "rejected")
            .map((r) => {
              const a = map.labels.find(
                (l) => l.id === map.parts.find((p) => p.id === r.from)?.labelId,
              );
              const b = map.labels.find(
                (l) => l.id === map.parts.find((p) => p.id === r.to)?.labelId,
              );
              return a && b ? (
                <path
                  key={r.id}
                  // The flow is a flow: the dashes travel along it, so the
                  // picture shows the direction rather than only pointing.
                  className="flow-line"
                  d={`M${a.x * 440} ${a.y * 500 + 23}L${b.x * 440} ${b.y * 500 - 25}`}
                  stroke="#467a8b"
                  strokeWidth="2"
                  markerEnd="url(#arrow)"
                />
              ) : null;
            })}
          {map.parts.map((p, index) => {
            const l = map.labels.find((l) => l.id === p.labelId);
            return l ? (
              <g key={p.id}>
                <rect
                  x={l.x * 440 - 115}
                  y={l.y * 500 - 23}
                  width="230"
                  height="46"
                  rx="6"
                  fill={selected === p.id ? "#163b69" : "#fff"}
                  stroke="#678299"
                />
                <text
                  x={l.x * 440}
                  y={l.y * 500 + 6}
                  textAnchor="middle"
                  fill={selected === p.id ? "#fff" : "#163b69"}
                  fontSize="16"
                  fontFamily="Arial"
                >
                  {partNumber(map, p, index)}. {p.name}
                </text>
              </g>
            ) : null;
          })}
        </svg>
      )}
      {onSelect &&
        map.parts.map((p, index) => {
          const l = map.labels.find((l) => l.id === p.labelId);
          return l ? (
            <button
              key={p.id}
              className={`hotspot ${selected === p.id ? "selected" : ""}`}
              style={
                // Visible markers sit just left of the label so its text stays readable.
                // Labels at the far left get the marker on their right instead.
                showSpots && l.boundingBox
                  ? l.boundingBox.left > 0.08
                    ? { left: `${l.boundingBox.left * 100}%`, top: `${l.y * 100}%`, transform: "translate(-115%, -50%)" }
                    : { left: `${(l.boundingBox.left + l.boundingBox.width) * 100}%`, top: `${l.y * 100}%`, transform: "translate(15%, -50%)" }
                  : { left: `${l.x * 100}%`, top: `${l.y * 100}%` }
              }
              aria-label={`Locate ${p.name}`}
              aria-pressed={showSpots ? selected === p.id : undefined}
              onClick={() => onSelect(p.id)}
            >
              {partNumber(map, p, index)}
            </button>
          ) : null;
        })}
    </div>
  );
}
export function Pathways({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`pathways ${compact ? "compact" : ""}`}
      role="img"
      aria-label="One lesson connects exploration, captions and communication through shared vocabulary"
    >
      <svg className="path-lines" viewBox="0 0 600 440" aria-hidden="true">
        <path
          d="M300 210Q170 200 105 90M300 210Q450 160 500 95M300 210Q340 340 480 365"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        <circle
          cx="300"
          cy="210"
          r="150"
          fill="none"
          stroke="currentColor"
          strokeDasharray="3 9"
        />
      </svg>
      <div className="path-core">
        <BookOpen size={32} aria-hidden="true" />
        <strong>One lesson</strong>
        <span>Teacher approved</span>
        <div className="core-pages" aria-hidden="true" />
      </div>
      <div className="path-node path-explore">
        <Network aria-hidden="true" />
        <span>See & explore</span>
        <small>Concept by concept</small>
      </div>
      <div className="path-node path-caption">
        <AudioLines aria-hidden="true" />
        <span>Hear & read</span>
        <small>Follow every term</small>
      </div>
      <div className="path-node path-speak">
        <MessageCircle aria-hidden="true" />
        <span>Communicate</span>
        <small>A question that connects</small>
      </div>
      <span className="path-vocabulary">
        <Check size={14} aria-hidden="true" /> One shared vocabulary
      </span>
    </div>
  );
}
export function SurfaceList({
  term,
  published,
  surfaces,
}: {
  term: string;
  published: boolean;
  surfaces?: TermSurfaces;
}) {
  const rows: [string, typeof Check, string][] = [
    [
      "Explorer & glossary",
      surfaces ? (surfaces.explorer && surfaces.glossary ? Check : Circle) : Check,
      surfaces
        ? surfaces.explorer && surfaces.glossary
          ? "Available"
          : "Missing from this version"
        : published
          ? "Available"
          : "Ready on publish",
    ],
    [
      "Caption highlighter",
      surfaces ? (surfaces.captions ? Check : Circle) : Check,
      surfaces
        ? surfaces.captions
          ? "Found in this transcript"
          : "No transcript yet"
        : published
          ? "Available"
          : "Ready on publish",
    ],
    [
      "Question anchor",
      surfaces
        ? surfaces.communicationAnchor
          ? Check
          : Circle
        : Check,
      surfaces
        ? surfaces.communicationAnchor
          ? "Available"
          : "Not available"
        : published
          ? "Available"
          : "Ready on publish",
    ],
    [
      "Audio description",
      surfaces ? (surfaces.audio ? AudioLines : Circle) : AudioLines,
      surfaces ? (surfaces.audio ? "Text / browser speech" : "No description") : "Text / browser speech",
    ],
  ];
  return (
    <div className="surfaces">
      <p className="small">“{term}” connects across your lesson</p>
      <ul>
        {rows.map(([label, Icon, status]) => (
          <li key={label}>
            <Icon aria-hidden="true" />
            {label} <span>{status}</span>
          </li>
        ))}
        <li>
          <Circle aria-hidden="true" />
          Recognition vocabulary <span>AWS deferred</span>
        </li>
      </ul>
    </div>
  );
}
export function Speak({ text }: { text: string }) {
  const [message, setMessage] = useState("");
  const [speaking, setSpeaking] = useState(false);
  useEffect(
    () => () => {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    },
    [text],
  );
  return (
    <div>
      <button
        className="secondary"
        onClick={() => {
          if (!("speechSynthesis" in window)) {
            setMessage(
              "Browser speech is unavailable. The full description is available as text.",
            );
            return;
          }
          window.speechSynthesis.cancel();
          if (speaking) {
            setSpeaking(false);
            return;
          }
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.lang = "en-IN";
          utterance.onend = () => setSpeaking(false);
          utterance.onerror = () => {
            setSpeaking(false);
            setMessage(
              "Speech could not play. Read the text description below.",
            );
          };
          setSpeaking(true);
          window.speechSynthesis.speak(utterance);
        }}
      >
        <AudioLines size={18} aria-hidden="true" />
        {speaking ? "Stop reading" : "Read aloud"}
      </button>
      <small className="speech-note">
        Browser speech · voice availability varies
      </small>
      <span role="status">{message}</span>
    </div>
  );
}

export function ConceptTree({
  lesson,
  selected,
  onSelect,
}: {
  lesson: Pick<Published, "title"> & {
    map: { parts: { id: string; name: string; labelId?: string }[]; labels?: DiagramMap["labels"] };
  };
  selected: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [focus, setFocus] = useState("root");
  const refs = useRef<Record<string, HTMLLIElement | null>>({});
  const parts = lesson.map.parts;
  const visible = ["root", ...(open ? parts.map((p) => p.id) : [])];
  function key(event: React.KeyboardEvent, node: string) {
    const index = visible.indexOf(node);
    let next = node;
    if (event.key === "ArrowDown")
      next = visible[Math.min(index + 1, visible.length - 1)];
    else if (event.key === "ArrowUp") next = visible[Math.max(0, index - 1)];
    else if (event.key === "ArrowRight" && node === "root") {
      if (!open) setOpen(true);
      else next = parts[0]?.id || "root";
    } else if (event.key === "ArrowLeft") {
      if (node === "root") setOpen(false);
      else next = "root";
    } else if (event.key === "Home") next = "root";
    else if (event.key === "End") next = visible.at(-1)!;
    else if (event.key === "Enter" || event.key === " ") {
      if (node === "root") setOpen((v) => !v);
      else onSelect(node);
    } else if (
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey
    ) {
      const match = parts.find((p) =>
        p.name.toLowerCase().startsWith(event.key.toLowerCase()),
      );
      if (match && open) next = match.id;
      else return;
    } else return;
    event.preventDefault();
    event.stopPropagation();
    setFocus(next);
    refs.current[next]?.focus();
  }
  return (
    <>
      <p className="small" id="tree-help">
        Arrow keys move through the tree. Enter selects a concept. Right/Left
        expand or collapse.
      </p>
      <ul
        className="concept-tree"
        role="tree"
        aria-label="Lesson concepts"
        aria-describedby="tree-help"
      >
        <li
          role="treeitem"
          aria-expanded={open}
          tabIndex={focus === "root" ? 0 : -1}
          ref={(el) => {
            refs.current.root = el;
          }}
          onFocus={(e) => {
            if (e.target === e.currentTarget) setFocus("root");
          }}
          onKeyDown={(e) => {
            if (e.target === e.currentTarget) key(e, "root");
          }}
        >
          <span
            className="tree-root"
            onClick={() => {
              setFocus("root");
              setOpen((v) => !v);
              refs.current.root?.focus();
            }}
          >
            {open ? "−" : "+"} {lesson.title}
          </span>
          {open && (
            <ul role="group">
              {parts.map((p, i) => (
                <li
                  key={p.id}
                  role="treeitem"
                  aria-selected={selected === p.id}
                  aria-posinset={i + 1}
                  aria-setsize={parts.length}
                  tabIndex={focus === p.id ? 0 : -1}
                  ref={(el) => {
                    refs.current[p.id] = el;
                  }}
                  onFocus={() => setFocus(p.id)}
                  onKeyDown={(e) => key(e, p.id)}
                  onClick={(e) => {
                    e.stopPropagation();
                    setFocus(p.id);
                    onSelect(p.id);
                    refs.current[p.id]?.focus();
                  }}
                >
                  <span className="node-number">
                    {lesson.map.labels && p.labelId ? partNumber({ labels: lesson.map.labels }, { labelId: p.labelId }, i) : i + 1}
                  </span>
                  {p.name}
                  <ArrowUpRight size={16} aria-hidden="true" />
                </li>
              ))}
            </ul>
          )}
        </li>
      </ul>
      <label className="alternative">
        Or choose a concept
        <select value={selected} onChange={(e) => onSelect(e.target.value)}>
          {parts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
