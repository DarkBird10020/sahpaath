import { useEffect, useState } from "react";
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
          <ol className="demo-steps">
            {state.steps.map((s) => {
              const [label, Icon] = marks[s.status];
              return (
                <li key={s.id} data-status={s.status}>
                  <span className={`status demo-${s.status}`}>
                    <Icon size={13} aria-hidden="true" />
                    {label}
                  </span>
                  <strong>{s.label}</strong>
                  <small>{s.detail}</small>
                </li>
              );
            })}
          </ol>
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
