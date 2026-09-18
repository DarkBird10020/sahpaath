import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Check,
  Layers3,
  MessageCircle,
  Network,
  AudioLines,
} from "lucide-react";
import "./lesson-journey.css";
import PathwayEmblem from "./PathwayEmblem";

const chapters = [
  {
    title: "Same lesson.\nYour way in.",
    copy: "SahPaath transforms one teacher-approved lesson into accessible experiences for students who read, hear, and communicate differently.",
    label: "One lesson",
  },
  {
    title: "Make the\nconnections clear.",
    copy: "A diagram becomes parts, relationships and a reading order. A teacher checks what each connection means before students use it.",
    label: "Teacher review",
  },
  {
    title: "Three ways in.\nOne conversation.",
    copy: "Explore a concept. Find it in a transcript. Ask about it. The same lesson vocabulary stays with you through every pathway.",
    label: "Access pathways",
  },
  {
    title: "A shared word.\nA shared lesson.",
    copy: "Pulmonary artery. One canonical term connects the diagram, glossary, captions and a student's question. This is what holds the lesson together.",
    label: "Shared vocabulary",
  },
];

export default function LessonJourney({
  onExplore,
}: {
  onExplore: () => void;
}) {
  const root = useRef<HTMLElement>(null);
  const [chapter, setChapter] = useState(0);
  const [flat, setFlat] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    const media = matchMedia(
      "(prefers-reduced-motion: reduce), (max-width: 700px)",
    );
    const sync = () => setFlat(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    if (flat || matchMedia("(max-width: 700px)").matches) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!root.current) return;
        const rect = root.current.getBoundingClientRect();
        const progress = Math.max(
          0,
          Math.min(1, -rect.top / Math.max(1, rect.height - innerHeight)),
        );
        root.current.style.setProperty("--journey", String(progress));
        setChapter(Math.min(3, Math.floor(progress * 4)));
      });
    };
    addEventListener("scroll", update, { passive: true });
    addEventListener("resize", update);
    update();
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener("scroll", update);
      removeEventListener("resize", update);
    };
  }, [flat]);
  function jump(index: number) {
    const target = Math.max(0, Math.min(chapters.length - 1, index));
    setAnnouncement(`Chapter ${target + 1} of ${chapters.length}: ${chapters[target].label}`);
    if (!flat && !matchMedia("(max-width: 700px)").matches && root.current) {
      const top = scrollY + root.current.getBoundingClientRect().top;
      scrollTo({
        top:
          top + (root.current.offsetHeight - innerHeight) * (target / 4 + 0.06),
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
      });
    } else setChapter(target);
  }
  return (
    <section
      ref={root}
      className={`lesson-journey ${flat ? "journey-flat" : ""}`}
      aria-label="One lesson, multiple ways in"
    >
      <div className="journey-stage">
        <div className="journey-progress" aria-hidden="true"><span style={{ width: `${(chapter + 1) * 25}%` }} /></div>
        <div className="journey-top">
          <span>
            <Layers3 size={17} aria-hidden="true" /> One lesson. Connected
            experiences.
          </span>
          <button onClick={() => setFlat(!flat)} aria-pressed={flat}>
            {flat ? "Enable depth & scroll" : "Turn off depth & scroll"}
          </button>
        </div>
        <div className="journey-copy">
          {chapter === 0 ? (
            <h1>
              SAME LESSON.
              <br />
              YOUR WAY IN.
            </h1>
          ) : (
            <>
              <h1 className="journey-brandline">Same lesson. Your way in.</h1>
              <h2>{chapters[chapter].title}</h2>
            </>
          )}
          <p>{chapters[chapter].copy}</p>
          <div className="journey-actions">
            <button className="primary" onClick={onExplore}>
              Explore a lesson <ArrowRight size={18} aria-hidden="true" />
            </button>
            <a href="#how-it-works">See how it works</a>
          </div>
          <p className="journey-note">
            Illustrative lesson · local demo available
          </p>
          <div className="journey-pager" aria-label="Story controls">
            <button onClick={() => jump(chapter - 1)} disabled={chapter === 0} aria-label="Previous chapter"><ArrowLeft size={18} aria-hidden="true" /> Previous</button>
            <span aria-hidden="true">{String(chapter + 1).padStart(2, "0")} / 04</span>
            <button onClick={() => jump(chapter + 1)} disabled={chapter === 3} aria-label="Next chapter">Next <ArrowRight size={18} aria-hidden="true" /></button>
          </div>
        </div>
        <div className={`lesson-space chapter-${chapter}`} aria-hidden="true">
          <div className="lesson-orbit orbit-one" />
          <div className="lesson-orbit orbit-two" />
          <div className="lesson-stack">
            <div className="lesson-sheet source-sheet">
              <div className="sheet-meta">SahPaath / Science lesson</div>
              <h3>A connected system.</h3>
              <p>A simplified pulmonary pathway</p>
              <svg viewBox="0 0 420 320" className="lesson-drawing">
                <defs>
                  <marker
                    id="journey-arrow"
                    markerWidth="6"
                    markerHeight="6"
                    refX="5"
                    refY="3"
                    orient="auto"
                  >
                    <path d="M0 0L6 3L0 6" fill="#315776" />
                  </marker>
                </defs>
                <path
                  d="M110 195 C35 95 110 55 165 115 C220 55 300 95 220 195 L165 250Z"
                  fill="#e5a99d"
                  stroke="#ad6558"
                  strokeWidth="2"
                />
                <path
                  d="M185 135 C285 125 245 60 320 60 L320 145"
                  fill="none"
                  stroke="#315776"
                  strokeWidth="16"
                />
                <path
                  d="M310 132 C270 130 267 210 300 225 L318 220 L318 145 M332 132 C372 130 377 210 344 225 L328 220 L328 145"
                  fill="#bad1d8"
                  stroke="#547f91"
                  strokeWidth="2"
                />
                <path
                  d="M280 242 C225 290 160 285 125 244"
                  stroke="#315776"
                  fill="none"
                  strokeWidth="2"
                  markerEnd="url(#journey-arrow)"
                />
                <text x="72" y="283">
                  Right ventricle
                </text>
                <text x="242" y="32">
                  Pulmonary artery
                </text>
                <text x="317" y="253">
                  Lungs
                </text>
              </svg>
              <div className="sheet-footer">
                <span>Source diagram</span>
                <span>01 / 01</span>
              </div>
            </div>
            <div className="lesson-sheet concept-sheet">
              <PathwayEmblem kind="explore" />
              <div className="sheet-meta">
                <Network size={15} /> Structured concepts
              </div>
              <div className="concept-flow">
                <span>Right ventricle</span>
                <i />
                <strong>Pulmonary artery</strong>
                <i />
                <span>Lungs</span>
              </div>
              <div className="review-stamp">
                <Check size={16} /> Teacher review comes first
              </div>
            </div>
            <div className="lesson-sheet caption-sheet">
              <PathwayEmblem kind="read" />
              <div className="sheet-meta">
                <AudioLines size={17} /> Read the lesson
              </div>
              <p>
                Follow the <mark>pulmonary artery</mark> in the diagram.
              </p>
              <small>Illustrative transcript excerpt</small>
            </div>
            <div className="lesson-sheet question-sheet">
              <PathwayEmblem kind="ask" />
              <div className="sheet-meta">
                <MessageCircle size={17} /> Join the lesson
              </div>
              <span>Ask about · Pulmonary artery</span>
              <p>I don't understand what this does.</p>
            </div>
            <div className="shared-term">
              <Check size={18} /> One shared vocabulary
            </div>
          </div>
        </div>
        <div className="journey-bottom">
          <nav aria-label="Lesson story chapters">
            {chapters.map((item, index) => (
              <button
                key={item.label}
                aria-current={chapter === index ? "step" : undefined}
                onClick={() => jump(index)}
              >
                <span>0{index + 1}</span>
                {item.label}
              </button>
            ))}
          </nav>
          <a href="#how-it-works" className="journey-skip">
            Skip story <ArrowDown size={16} aria-hidden="true" />
          </a>
        </div>
      </div>
      <p className="sr-only" role="status">{announcement}</p>
      <div className="sr-only">
        <h2>The same concept across three pathways</h2>
        <p>
          This illustrative science lesson connects Right ventricle, Pulmonary
          artery and Lungs. A teacher reviews the structure. Pulmonary artery
          then provides the common concept for exploration, a transcript
          highlight and the question: I don't understand what this does.
        </p>
      </div>
    </section>
  );
}
