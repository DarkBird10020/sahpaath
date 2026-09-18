import { useState } from "react";
import { z } from "zod";
import { BookOpen, Sparkles } from "lucide-react";
import { api } from "./api";
import { Speak } from "./components";

const meaningSchema = z.object({
  word: z.string(),
  meaning: z.string(),
  example: z.string().nullable(),
  source: z.enum(["teacher_approved", "ai"]),
  termId: z.string().nullable(),
});
type Meaning = z.infer<typeof meaningSchema>;

/**
 * Explain any word: type it, or select text on the page and press the button.
 * An approved lesson term returns the teacher's definition; anything else is
 * explained by the AI and labelled as such.
 */
export default function WordExplainer({
  lessonId = null,
  context = null,
  initialWord = "",
}: {
  lessonId?: string | null;
  context?: string | null;
  initialWord?: string;
}) {
  const [word, setWord] = useState(initialWord);
  const [result, setResult] = useState<Meaning | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function explain(value: string) {
    const clean = value.trim().slice(0, 80);
    if (!clean) return;
    setWord(clean);
    setBusy(true);
    setError("");
    try {
      setResult(await api("/ai/explain-word", meaningSchema, "POST", { word: clean, context, lessonId }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="word-explainer" aria-label="Explain a word">
      <h3>
        <Sparkles size={18} aria-hidden="true" /> Explain a hard word
      </h3>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void explain(word);
        }}
      >
        <label>
          Word or phrase
          <input value={word} maxLength={80} onChange={(e) => setWord(e.target.value)} placeholder="e.g. gas exchange" />
        </label>
        <div className="button-row">
          <button className="primary" disabled={busy || !word.trim()}>
            Explain
          </button>
          <button
            type="button"
            disabled={busy}
            // Keep the page selection alive while the button is pressed.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const selected = window.getSelection()?.toString() ?? "";
              if (selected.trim()) void explain(selected);
              else setError("Select a word on the page first, or type it above.");
            }}
          >
            Explain selected text
          </button>
        </div>
      </form>
      {busy && <p role="status" className="small">Looking it up…</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {result && !busy && (
        <div className="word-card" role="status">
          <span className={result.source === "ai" ? "ai-badge" : "status teacher_approved"}>
            {result.source === "ai" ? (
              <>
                <Sparkles size={13} aria-hidden="true" /> AI explanation, not checked by your teacher
              </>
            ) : (
              <>
                <BookOpen size={13} aria-hidden="true" /> Teacher-approved meaning
              </>
            )}
          </span>
          <h4>{result.word}</h4>
          <p>{result.meaning}</p>
          {result.example && <p className="small">Example: {result.example}</p>}
          <Speak text={`${result.word}. ${result.meaning}${result.example ? ` For example: ${result.example}` : ""}`} />
        </div>
      )}
    </section>
  );
}
