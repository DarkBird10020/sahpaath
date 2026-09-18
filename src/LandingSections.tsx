import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Check,
  Hand,
  Lock,
  MessageCircle,
  Network,
  ScanText,
  Send,
  ShieldCheck,
  Square,
  Volume2,
} from "lucide-react";
import { Anatomy, DiagramDefs, parts } from "./heartDiagram";
import "./landing.css";

const transcript =
  "Today we are following blood from the Right ventricle to the Pulmonary artery. The Pulmonary artery carries blood toward the Lungs. After gas exchange, blood returns through the Pulmonary veins to the Left atrium.";
const phrases = [
  "I have a question",
  "Please repeat",
  "I don't understand this step",
  "I need more time",
  "Can I answer?",
];
const tabs = [
  { id: "explore", label: "Explore", icon: Network },
  { id: "captions", label: "Captions", icon: MessageCircle },
  { id: "ask", label: "Ask", icon: Hand },
] as const;
type Tab = (typeof tabs)[number]["id"];

function announcementFor(i: number) {
  const from = i > 0 ? ` Receives from ${parts[i - 1].name}.` : "";
  const to = i < parts.length - 1 ? ` Leads to ${parts[i + 1].name}.` : "";
  return `${parts[i].name}. Step ${i + 1} of ${parts.length}, Blood through the pulmonary circuit. ${parts[i].text}${from}${to}`;
}

export default function LandingSections({
  onExplore,
  onTeacher,
}: {
  onExplore: () => void;
  onTeacher: () => void;
}) {
  return (
    <>
      <Playground />
      <TrustPipeline />
      <section className="finale" aria-labelledby="finale-heading">
        <p className="finale-kicker">SahPaath</p>
        <h2 id="finale-heading">
          One lesson.
          <br />
          Multiple ways in.
        </h2>
        <p className="finale-line">No student left outside the lesson.</p>
        <div className="finale-actions">
          <button className="finale-primary" onClick={onExplore}>
            Explore a lesson <ArrowRight size={18} aria-hidden="true" />
          </button>
          <button className="finale-secondary" onClick={onTeacher}>
            Try the teacher workspace <ArrowRight size={18} aria-hidden="true" />
          </button>
        </div>
      </section>
    </>
  );
}

/** Hands-on demo of the three pathways around one shared term. Runs entirely in the browser. */
function Playground() {
  const [tab, setTab] = useState<Tab>("explore");
  const [step, setStep] = useState(1);
  const [term, setTerm] = useState<number | null>(null);
  const [anchor, setAnchor] = useState(1);
  const [phrase, setPhrase] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [canSpeak, setCanSpeak] = useState(false);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    setCanSpeak(typeof window !== "undefined" && "speechSynthesis" in window);
    return () => {
      if ("speechSynthesis" in window) speechSynthesis.cancel();
    };
  }, []);

  function onTabKey(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const keys: Record<string, number> = {
      ArrowRight: (index + 1) % tabs.length,
      ArrowLeft: (index + tabs.length - 1) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    };
    if (!(e.key in keys)) return;
    e.preventDefault();
    const next = keys[e.key];
    setTab(tabs[next].id);
    tabRefs.current[next]?.focus();
  }

  function speak(text: string) {
    if (!canSpeak) return;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    speechSynthesis.speak(utterance);
  }

  function goTo(i: number) {
    setStep(i);
    if (speaking) speechSynthesis.cancel();
    setSpeaking(false);
  }

  const termPieces = transcript.split(new RegExp(`(${parts.map((p) => p.name).join("|")})`, "g"));

  return (
    <section id="try-it" className="playground" aria-labelledby="try-heading">
      <div className="play-intro">
        <p className="land-kicker">Hands on · runs in your browser</p>
        <h2 id="try-heading">Try the three ways in.</h2>
        <p>
          One illustrative heart lesson, three pathways. Open a word in the captions and follow it into
          the diagram or a question. That link is the shared vocabulary.
        </p>
        <div className="play-tabs" role="tablist" aria-label="Pathways">
          {tabs.map(({ id, label, icon: Icon }, i) => (
            <button
              key={id}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              role="tab"
              id={`tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`panel-${id}`}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
              onKeyDown={(e) => onTabKey(e, i)}
            >
              <Icon size={18} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="play-stage">
        {tab === "explore" && (
          <div role="tabpanel" id="panel-explore" aria-labelledby="tab-explore" className="play-panel explore-panel">
            <svg viewBox="80 50 480 440" className="play-diagram" aria-hidden="true">
              <defs>
                <DiagramDefs prefix="pg" />
              </defs>
              <Anatomy living focus={step} prefix="pg" />
            </svg>
            <div className="explore-controls">
              <h3>Blood through the pulmonary circuit</h3>
              <ol className="part-list">
                {parts.map((part, i) => (
                  <li key={part.name}>
                    <button aria-current={step === i ? "step" : undefined} onClick={() => goTo(i)}>
                      <span aria-hidden="true">{i + 1}</span>
                      {part.name}
                    </button>
                  </li>
                ))}
              </ol>
              <p className="explore-voice" aria-live="polite">
                {announcementFor(step)}
              </p>
              <div className="explore-actions">
                <button onClick={() => goTo(Math.max(0, step - 1))} disabled={step === 0}>
                  <ArrowLeft size={16} aria-hidden="true" /> Previous part
                </button>
                <button onClick={() => goTo(Math.min(parts.length - 1, step + 1))} disabled={step === parts.length - 1}>
                  Next part <ArrowRight size={16} aria-hidden="true" />
                </button>
                {canSpeak && (
                  <button
                    className="speak"
                    aria-pressed={speaking}
                    onClick={() => (speaking ? (speechSynthesis.cancel(), setSpeaking(false)) : speak(announcementFor(step)))}
                  >
                    {speaking ? <Square size={16} aria-hidden="true" /> : <Volume2 size={16} aria-hidden="true" />}
                    {speaking ? "Stop" : "Read aloud"}
                  </button>
                )}
              </div>
              {canSpeak && <small>Read aloud uses your device's built-in voice.</small>}
            </div>
          </div>
        )}

        {tab === "captions" && (
          <div role="tabpanel" id="panel-captions" aria-labelledby="tab-captions" className="play-panel captions-panel">
            <div className="transcript">
              <span className="transcript-label">
                <AudioLines size={15} aria-hidden="true" /> Loaded transcript · illustrative
              </span>
              <p>
                {termPieces.map((piece, i) => {
                  const index = parts.findIndex((p) => p.name === piece);
                  return index < 0 ? (
                    <span key={i}>{piece}</span>
                  ) : (
                    <button
                      key={i}
                      className="term"
                      aria-expanded={term === index}
                      aria-controls="term-card"
                      onClick={() => setTerm(term === index ? null : index)}
                    >
                      {piece}
                    </button>
                  );
                })}
              </p>
            </div>
            <div id="term-card" className="term-card" aria-live="polite">
              {term === null ? (
                <p className="term-empty">Select a highlighted word to see what it means.</p>
              ) : (
                <>
                  <span className="term-badge">
                    <Check size={13} aria-hidden="true" /> Approved term · illustrative
                  </span>
                  <h3>{parts[term].name}</h3>
                  <p>{parts[term].text}</p>
                  <div className="term-actions">
                    <button
                      onClick={() => {
                        setStep(term);
                        setTab("explore");
                      }}
                    >
                      <Network size={16} aria-hidden="true" /> Explore this
                    </button>
                    <button
                      onClick={() => {
                        setAnchor(term);
                        setTab("ask");
                      }}
                    >
                      <Hand size={16} aria-hidden="true" /> Ask about this
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {tab === "ask" && (
          <div role="tabpanel" id="panel-ask" aria-labelledby="tab-ask" className="play-panel ask-panel">
            <h3>Say it in one tap</h3>
            <div className="quick-phrases">
              {phrases.map((p) => (
                <button key={p} aria-pressed={phrase === p} onClick={() => setPhrase(p)}>
                  {p}
                </button>
              ))}
            </div>
            <div className="anchored-ask">
              <label htmlFor="anchor-term">Ask about</label>
              <select id="anchor-term" value={anchor} onChange={(e) => setAnchor(Number(e.target.value))}>
                {parts.map((p, i) => (
                  <option key={p.name} value={i}>
                    {p.name}
                  </option>
                ))}
              </select>
              <p>I don't understand what this does.</p>
            </div>
            <button
              className="send"
              onClick={() =>
                setSent(`${phrase ? `${phrase}. ` : ""}Ask about ${parts[anchor].name}: I don't understand what this does.`)
              }
            >
              <Send size={16} aria-hidden="true" /> Send to teacher
            </button>
            <p className="send-status" role="status">
              {sent && (
                <>
                  <Check size={15} aria-hidden="true" /> Ready for the teacher: “{sent}” Demo only, nothing
                  leaves this page.
                </>
              )}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

const pipeline = [
  {
    icon: ScanText,
    chip: "AI proposed",
    cls: "chip-proposed",
    title: "AI proposes",
    text: "OCR reads the labels on the teacher's diagram. A model proposes parts, links and a reading order.",
  },
  {
    icon: ShieldCheck,
    chip: "Validated",
    cls: "chip-validated",
    title: "Code validates",
    text: "Deterministic checks: every part maps to a real label, every link to real parts. Anything uncertain is flagged.",
  },
  {
    icon: Check,
    chip: "Teacher approved",
    cls: "chip-approved",
    title: "A teacher approves",
    text: "Every item needs an explicit decision. Publishing stays locked until each one has it.",
  },
  {
    icon: Lock,
    chip: "Published",
    cls: "chip-published",
    title: "Students use it",
    text: "Only approved content is served. Published versions never change; an edit creates a new version.",
  },
];

function TrustPipeline() {
  return (
    <section id="how-it-works" className="trust-pipeline" aria-labelledby="pipeline-heading">
      <p className="land-kicker">How it works</p>
      <h2 id="pipeline-heading">
        Nothing reaches a student
        <br />
        until a teacher says so.
      </h2>
      <ol className="trust-steps">
        {pipeline.map(({ icon: Icon, chip, cls, title, text }, i) => (
          <li key={title}>
            <span className="step-index" aria-hidden="true">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className={`pipe-chip ${cls}`}>
              <Icon size={14} aria-hidden="true" /> {chip}
            </span>
            <h3>{title}</h3>
            <p>{text}</p>
          </li>
        ))}
      </ol>
      <p className="trust-note">
        In this local edition, the OCR and AI stages run as a labelled demo simulation. Validation, review,
        publishing and the shared vocabulary run for real. AWS is not connected yet.
      </p>
    </section>
  );
}
