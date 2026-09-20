import { useEffect, useRef, useState } from "react";
import { Check, Circle, PlayCircle, RotateCcw } from "lucide-react";
import { api } from "./api";
import { demoStateSchema, type DemoState } from "../shared/schema";

const marks = {
  done: ["Done", Check],
  waiting: ["To do", Circle],
  simulated: ["Demo simulation", Circle],
  fallback: ["Fallback", Circle],
} as const;

/** The 3-minute story as a live checklist. Progress is read from the real
 * lesson, captions and questions, so it only ticks when the product did it. */
export default function DemoGuide({
  onOpen,
  onChange,
  report,
}: {
  onOpen: (lessonId: string) => void;
  onChange: () => Promise<void>;
  report: (m: string) => void;
}) {
  const [state, setState] = useState<DemoState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** Whether the notes on already-finished steps are on screen. */
  const [details, setDetails] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    let active = true;
    const load = () =>
      void api("/demo/state", demoStateSchema)
        .then((s) => active && setState(s))
        .catch((e) => active && setError((e as Error).message));
    load();
    const timer = setInterval(load, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  async function call(path: "start" | "reset") {
    setBusy(true);
    setError("");
    try {
      const next = await api(`/demo/${path}`, demoStateSchema, "POST");
      setState(next);
      await onChange();
      if (next.lessonId) onOpen(next.lessonId);
      report(path === "start" ? "Guided demo lesson ready." : "Guided demo reset. Earlier lessons are kept.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const done = state?.steps.filter((s) => s.status === "done").length ?? 0;
  /** The first step still to do: the one the guide is asking for right now. */
  const upNext = state?.steps.findIndex((s) => s.status !== "done") ?? -1;
  // The list keeps its own height so the rest of the sidebar stays reachable,
  // which means the step being asked for has to be brought into its view.
  // Setting scrollTop moves only the list; scrollIntoView would move the page.
  useEffect(() => {
    const list = listRef.current;
    const step = list?.querySelector<HTMLElement>(".is-next");
    if (!list || !step) return;
    const above = step.offsetTop - list.offsetTop;
    if (above < list.scrollTop || above + step.offsetHeight > list.scrollTop + list.clientHeight)
      list.scrollTop = Math.max(0, above - 8);
  }, [upNext, details]);
  return (
    <details className="demo-guide" open={!!state?.lessonId}>
      <summary>
        <PlayCircle size={17} aria-hidden="true" />
        Guided 3-minute demo
      </summary>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!state?.lessonId ? (
        <>
          <p className="small">
            Creates a fresh heart lesson and tracks the full story: fix, approve,
            publish, explore, captions and a student question.
          </p>
          <button className="primary" disabled={busy} onClick={() => void call("start")}>
            Start guided demo
          </button>
        </>
      ) : (
        <>
          <p className="small" role="status">
            {done} of {state.steps.length} steps done. Next: {state.next}
          </p>
          {/* Thirteen steps, each four lines deep, ran to about 1300px and
              buried the lesson list under them. A step says its name; the note
              belongs to the step being asked for and to any step the demo is
              standing in for, and the toggle brings back the rest. */}
          {/* The list scrolls, and nothing inside it takes focus, so it has to
              be reachable by keyboard in its own right. */}
          <ol className="demo-steps" ref={listRef} tabIndex={0} aria-label="Guided demo steps">
            {state.steps.map((s, i) => {
              const [label, Icon] = marks[s.status];
              const caveat = s.status === "simulated" || s.status === "fallback";
              // What you need on screen is where you are, what to do next, and
              // anything the demo is standing in for. The other ten notes can
              // wait behind the toggle.
              const note = details || i === upNext || caveat;
              return (
                <li key={s.id} data-status={s.status} className={i === upNext ? "is-next" : undefined}>
                  <p className="demo-step-head">
                    <Icon size={14} aria-hidden="true" />
                    <span className="sr-only">{label}. </span>
                    <strong>{s.label}</strong>
                  </p>
                  {caveat && <span className={`status demo-${s.status}`}>{label}</span>}
                  {note && <small>{s.detail}</small>}
                </li>
              );
            })}
          </ol>
          <button className="link-button demo-detail-toggle" onClick={() => setDetails(!details)}>
            {details ? "Show only what is next" : "Show every step's note"}
          </button>
          <div className="button-row">
            <button disabled={busy} onClick={() => onOpen(state.lessonId!)}>
              Open demo lesson
            </button>
            <button disabled={busy} onClick={() => void call("reset")}>
              <RotateCcw size={16} aria-hidden="true" />
              Reset demo
            </button>
          </div>
        </>
      )}
    </details>
  );
}
