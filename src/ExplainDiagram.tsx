import { useEffect, useState } from "react";
import { z } from "zod";
import { AlertTriangle, Check, Sparkles, Upload } from "lucide-react";
import { api, fileBase64 } from "./api";
import { Speak } from "./components";
import WordExplainer from "./WordExplainer";

const explanationSchema = z.object({
  title: z.string(),
  summary: z.string(),
  parts: z.array(z.object({ name: z.string(), explanation: z.string(), onImage: z.boolean() })),
  steps: z.array(z.string()),
  hardWords: z.array(z.object({ word: z.string(), meaning: z.string() })),
  answer: z.string().nullable(),
  labels: z.array(z.string()),
  model: z.string(),
});
type Explanation = z.infer<typeof explanationSchema>;

/** Upload any diagram (a book page, e-book screenshot, worksheet) and get an
 * explanation a screen reader can walk through, without a teacher. */
export default function ExplainDiagram({ report }: { report: (m: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Explanation | null>(null);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  async function explain() {
    if (!file) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const value = await api("/ai/explain-diagram", explanationSchema, "POST", {
        mime: file.type,
        base64: await fileBase64(file),
        question: question.trim() || null,
      });
      setResult(value);
      report(`Explanation ready: ${value.title}. ${value.parts.length} parts.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const spoken = result
    ? [
        result.title + ".",
        result.summary,
        result.answer ? `Your question: ${result.answer}` : "",
        result.steps.length ? `Steps: ${result.steps.join(" ")}` : "",
        ...result.parts.map((p) => `${p.name}: ${p.explanation}`),
      ]
        .filter(Boolean)
        .join(" ")
    : "";
  return (
    <div className="workspace ai-page">
      <span className="section-kicker">AI helper</span>
      <h1>Explain any diagram.</h1>
      <p className="ai-intro">
        Stuck on a diagram in a book, e-book or worksheet? Upload a picture of it. The AI reads its labels and explains
        it step by step, out loud if you like. No teacher needed.
      </p>
      <form
        className="ai-upload"
        onSubmit={(e) => {
          e.preventDefault();
          void explain();
        }}
      >
        <label>
          Diagram image (PNG or JPEG, up to 5 MB)
          <input
            type="file"
            accept="image/png,image/jpeg"
            onChange={(e) => {
              const chosen = e.target.files?.[0] ?? null;
              setResult(null);
              setError("");
              if (chosen && chosen.size > 5_000_000) {
                setError("Choose an image smaller than 5 MB.");
                return;
              }
              setFile(chosen);
              setPreview(chosen ? URL.createObjectURL(chosen) : "");
            }}
          />
        </label>
        <label>
          Your question (optional)
          <input
            value={question}
            maxLength={300}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. Why does blood go to the lungs?"
          />
        </label>
        <button className="primary" disabled={!file || busy}>
          <Upload size={17} aria-hidden="true" />
          {busy ? "Explaining…" : "Explain this diagram"}
        </button>
      </form>
      {busy && (
        <p role="status" className="ai-progress">
          Reading the labels and explaining the diagram… this usually takes about 5 seconds.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div className="ai-result">
          <div className="ai-note">
            <Sparkles size={16} aria-hidden="true" />
            AI explanation ({result.model}), not checked by a teacher. It can make mistakes.
          </div>
          <div className="ai-grid">
            <figure>
              <img src={preview} alt={`Your diagram. ${result.summary}`} />
              <figcaption className="small">
                {result.labels.length
                  ? `${result.labels.length} labels read from the image.`
                  : "No labels could be read; the explanation comes from the picture alone."}
              </figcaption>
            </figure>
            <section aria-label="Explanation">
              <h2>{result.title}</h2>
              <p className="ai-summary">{result.summary}</p>
              <Speak text={spoken} />
              {result.answer && (
                <div className="ai-answer">
                  <h3>Your question</h3>
                  <p>{result.answer}</p>
                </div>
              )}
              {result.steps.length > 0 && (
                <>
                  <h3>Step by step</h3>
                  <ol className="ai-steps">
                    {result.steps.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                </>
              )}
              <h3>The parts</h3>
              <ol className="ai-parts">
                {result.parts.map((p, i) => (
                  <li key={i}>
                    <h4>{p.name}</h4>
                    <p>{p.explanation}</p>
                    <span className={`found ${p.onImage ? "ok" : "warn"}`}>
                      {p.onImage ? <Check size={13} aria-hidden="true" /> : <AlertTriangle size={13} aria-hidden="true" />}
                      {p.onImage ? "Label read from the image" : "Not found on the image, check it"}
                    </span>
                  </li>
                ))}
              </ol>
              {result.hardWords.length > 0 && (
                <>
                  <h3>Hard words</h3>
                  <dl className="ai-words">
                    {result.hardWords.map((w) => (
                      <div key={w.word}>
                        <dt>{w.word}</dt>
                        <dd>{w.meaning}</dd>
                      </div>
                    ))}
                  </dl>
                </>
              )}
            </section>
          </div>
          <WordExplainer context={result.summary} />
        </div>
      )}
    </div>
  );
}
