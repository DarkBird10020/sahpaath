import { useState } from "react";
import { api } from "./api";
import { captionSchema, type Caption, type Published } from "../shared/schema";

export default function CaptionCorrection({
  caption,
  lesson,
  onCorrect,
}: {
  caption: Caption;
  lesson: Published;
  onCorrect: (c: Caption) => void;
}) {
  const [heard, setHeard] = useState("");
  const [term, setTerm] = useState(lesson.vocabulary[0].id);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <details className="caption-correction">
      <summary>Correct a technical term</summary>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const corrected = await api(
              `/captions/${caption.id}/correct`,
              captionSchema,
              "POST",
              { heard, termId: term },
            );
            onCorrect(corrected);
            setHeard("");
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="small">
          Teacher-confirmed replacement only. The original transcript is
          retained.
        </p>
        <label>
          Phrase in this passage
          <input
            required
            maxLength={120}
            value={heard}
            onChange={(e) => setHeard(e.target.value)}
          />
        </label>
        <label>
          Replace with approved term
          <select value={term} onChange={(e) => setTerm(e.target.value)}>
            {lesson.vocabulary.map((t) => (
              <option value={t.id} key={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <button disabled={busy || !heard.trim()}>Confirm correction</button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>
    </details>
  );
}
