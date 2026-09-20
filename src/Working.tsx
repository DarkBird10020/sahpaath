import { useEffect, useState } from "react";

/** Whole seconds since the component appeared, ticking once a second. */
function useElapsed() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = performance.now();
    const timer = setInterval(() => setSeconds(Math.floor((performance.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  return seconds;
}

/**
 * What waiting on a diagram looks like: the picture itself being read, with the
 * steps the analysis really goes through listed in order. Which step is lit
 * follows how long those steps usually take - the server does not report its
 * progress - so nothing is ever marked done, and the time says "usually".
 */
export function DiagramWorking({
  image,
  title,
  stages,
  typical,
}: {
  image: string | null;
  title: string;
  stages: string[];
  /** The usual range in seconds, measured on real diagrams. */
  typical: [number, number];
}) {
  const seconds = useElapsed();
  const [low, high] = typical;
  const per = (low + high) / 2 / stages.length;
  const now = Math.min(stages.length - 1, Math.floor(seconds / per));
  const [broken, setBroken] = useState(false);
  return (
    <section className="working working-diagram" aria-label={title}>
      <div className="working-figure" aria-hidden="true">
        {image && !broken ? (
          <img src={image} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
        ) : (
          <div className="working-blank" />
        )}
        <span className="working-grid" />
        <span className="working-beam" />
      </div>
      <div className="working-copy">
        <p className="working-kicker">
          <span className="working-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          Working
        </p>
        <h2>{title}</h2>
        {/* One steady announcement; the ticking clock is for eyes only. */}
        <p className="sr-only" role="status">
          {title}. This usually takes {low} to {high} seconds.
        </p>
        <ol className="working-stages" aria-hidden="true">
          {stages.map((stage, i) => (
            <li key={stage} className={i === now ? "is-now" : i < now ? "is-before" : ""}>
              {stage}
            </li>
          ))}
        </ol>
        <p className="working-time" aria-hidden="true">
          {seconds} s · usually {low}–{high} seconds
        </p>
      </div>
    </section>
  );
}

/**
 * Captions being written: a moving waveform over lines of text that are not
 * there yet. `progress` is the real part count from the upload loop.
 */
export function CaptionsWorking({ progress }: { progress: string }) {
  const seconds = useElapsed();
  return (
    <section className="working working-captions" aria-label="Writing captions">
      <div className="working-wave" aria-hidden="true">
        {Array.from({ length: 28 }, (_, i) => (
          <i key={i} style={{ animationDelay: `${(i % 7) * 0.11}s` }} />
        ))}
      </div>
      <div className="working-lines" aria-hidden="true">
        <span style={{ width: "86%" }} />
        <span style={{ width: "64%" }} />
        <span style={{ width: "74%" }} />
      </div>
      <p className="working-kicker">
        <span className="working-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        {progress}
      </p>
      <p className="sr-only" role="status">
        {progress}
      </p>
      <p className="working-time" aria-hidden="true">
        {seconds} s · captions appear below as each part finishes
      </p>
    </section>
  );
}

export type MicPhase = "starting" | "listening" | "hearing" | "transcribing" | "posting";
const micSteps = ["Listening to your voice", "Turning your speech into words", "Adding the lines to the class captions"];
const micHeading: Record<MicPhase, string> = {
  starting: "Starting the microphone",
  listening: "Listening",
  hearing: "Hearing you",
  transcribing: "Turning your speech into captions",
  posting: "Adding your words to the captions",
};
const micHint: Record<MicPhase, string> = {
  starting: "Allow the microphone if your browser asks.",
  listening: "Speak normally. Each line appears a few seconds after you pause.",
  hearing: "Keep going. Captions start a few seconds after you pause.",
  transcribing: "Usually 3 to 8 seconds. You can keep talking; the next part is already being recorded.",
  posting: "Nearly there.",
};

/**
 * Speech becoming captions. The steps follow what is really happening (recording, sending
 * for transcription, adding the lines) and the bars follow the microphone's actual level,
 * so a quiet room or a dead microphone is visible at once.
 */
export function MicWorking({ phase, level }: { phase: MicPhase; level: number }) {
  const busy = phase === "transcribing" || phase === "posting";
  const now = phase === "transcribing" ? 1 : phase === "posting" ? 2 : 0;
  const heard = Math.min(1, level * 14);
  return (
    <section className={`working working-captions working-mic${busy ? " is-busy" : ""}`} aria-label="Microphone captions">
      <div className="working-wave" aria-hidden="true">
        {Array.from({ length: 28 }, (_, i) => (
          <i
            key={i}
            style={
              busy
                ? { animationDelay: `${(i % 7) * 0.11}s` }
                : ({ "--s": phase === "starting" ? 0.12 : 0.12 + heard * (0.4 + 0.6 * Math.abs(Math.sin(i * 1.7))) } as React.CSSProperties)
            }
          />
        ))}
      </div>
      <p className="working-kicker">
        <span className="working-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        {micHeading[phase]}
      </p>
      {/* One steady announcement per change; the meter is for eyes only. */}
      <p className="sr-only" role="status">
        {micHeading[phase]}. {micHint[phase]}
      </p>
      <ol className="working-stages" aria-hidden="true">
        {micSteps.map((step, i) => (
          <li key={step} className={i === now ? "is-now" : i < now ? "is-before" : ""}>
            {step}
          </li>
        ))}
      </ol>
      <p className="working-time" aria-hidden="true">
        {micHint[phase]}
      </p>
    </section>
  );
}

/** A short wait for an answer: three dots and what is happening. */
export function Thinking({ children }: { children: string }) {
  return (
    <p className="working-thinking" role="status">
      <span className="working-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {children}
    </p>
  );
}

/** A spinner that sits inside a busy button, next to its label. */
export function Spinner() {
  return <span className="btn-spinner" aria-hidden="true" />;
}
