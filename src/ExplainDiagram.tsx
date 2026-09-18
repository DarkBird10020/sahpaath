import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, MessageCircle, Sparkles, Upload } from "lucide-react";
import { api, fileBase64 } from "./api";
import { ConceptTree, Diagram, Speak } from "./components";
import WordExplainer from "./WordExplainer";
import { mapSchema, type DiagramMap } from "../shared/schema";
import { normalize } from "../shared/domain";

const explanationSchema = z.object({
  title: z.string(),
  summary: z.string(),
  parts: z.array(z.object({ name: z.string(), explanation: z.string(), onImage: z.boolean() })),
  steps: z.array(z.string()),
  hardWords: z.array(z.object({ word: z.string(), meaning: z.string() })),
  answer: z.string().nullable(),
  labels: z.array(z.string()),
  model: z.string(),
  map: mapSchema.nullable(),
  mapFindings: z.number().nullable(),
});
type Explanation = z.infer<typeof explanationSchema>;
type Node = { id: string; name: string; text: string; onImage: boolean };

/** Builds explorer nodes, flow and connections from the grounded map when it
 * exists, otherwise from the explanation's own part list. */
function buildExplorer(result: Explanation) {
  const explained = new Map(result.parts.map((p) => [normalize(p.name), p]));
  const map: DiagramMap =
    result.map && result.map.parts.length
      ? { ...result.map, relations: result.map.relations.filter((r) => r.state !== "rejected") }
      : {
          labels: [],
          parts: result.parts.map((p, i) => ({
            id: `part-${i}`, name: p.name, labelId: `none-${i}`, description: p.explanation,
            aliases: [], modelConfidence: null, state: "ai_proposed" as const, reviewNote: "",
          })),
          relations: [],
          flows: [],
        };
  const labelIds = new Set(map.labels.map((l) => l.id));
  const nodes: Node[] = map.parts.map((p) => {
    const e = explained.get(normalize(p.name));
    return { id: p.id, name: p.name, text: e?.explanation ?? p.description, onImage: labelIds.has(p.labelId) || !!e?.onImage };
  });
  const flow = map.flows[0]?.steps.filter((s) => nodes.some((n) => n.id === s)) ?? [];
  // Parts outside the flow follow it, so every part keeps one number everywhere.
  const order = [...flow, ...nodes.map((n) => n.id).filter((id) => !flow.includes(id))];
  const byId = new Map(map.parts.map((p) => [p.id, p]));
  return { map: { ...map, parts: order.map((id) => byId.get(id)!) }, nodes, order, hasFlow: flow.length > 1 };
}

export default function ExplainDiagram({ report }: { report: (m: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Explanation | null>(null);
  const [selected, setSelected] = useState("");
  const [ask, setAsk] = useState("");
  const [asking, setAsking] = useState(false);
  const [reply, setReply] = useState<{ part: string; question: string; answer: string } | null>(null);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);
  const explorer = useMemo(() => (result ? buildExplorer(result) : null), [result]);
  const node = explorer?.nodes.find((n) => n.id === selected) ?? explorer?.nodes[0];

  async function explain() {
    if (!file) return;
    setBusy(true);
    setError("");
    setResult(null);
    setReply(null);
    try {
      const value = await api("/ai/explain-diagram", explanationSchema, "POST", {
        mime: file.type,
        base64: await fileBase64(file),
        question: question.trim() || null,
      });
      setResult(value);
      const first = buildExplorer(value);
      setSelected(first.order[0] ?? "");
      report(`${value.title} is open in the diagram explorer. ${first.nodes.length} parts. Use the tree or Next in flow.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function askAboutPart() {
    if (!result || !node || !ask.trim()) return;
    setAsking(true);
    setError("");
    try {
      const value = await api("/ai/ask-diagram", z.object({ answer: z.string(), model: z.string() }), "POST", {
        context: {
          title: result.title,
          summary: result.summary,
          parts: explorer!.nodes.map((n) => ({ name: n.name, explanation: n.text })),
          steps: result.steps,
        },
        question: ask.trim(),
        focus: node.name,
      });
      setReply({ part: node.name, question: ask.trim(), answer: value.answer });
      setAsk("");
      report("Answer ready.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAsking(false);
    }
  }

  const position = explorer && node ? explorer.order.indexOf(node.id) : -1;
  const previous = explorer && position > 0 ? explorer.order[position - 1] : null;
  const next = explorer && position >= 0 && position < explorer.order.length - 1 ? explorer.order[position + 1] : null;
  const nameOf = (id: string | null) => explorer?.nodes.find((n) => n.id === id)?.name ?? "";
  const connections = explorer && node
    ? explorer.map.relations
        .filter((r) => r.from === node.id || r.to === node.id)
        .map((r) => ({ id: r.from === node.id ? r.to : r.from, outgoing: r.from === node.id, kind: r.kind }))
    : [];
  const announcement =
    explorer && node
      ? `${node.name}. ${explorer.hasFlow ? "Step" : "Part"} ${position + 1} of ${explorer.order.length}. ${node.text}${
          connections.length ? ` Connected to ${connections.map((c) => nameOf(c.id)).join(", ")}.` : ""
        }`
      : "";

  return (
    <div className="workspace ai-page">
      <span className="section-kicker">AI helper</span>
      <h1>Explain any diagram.</h1>
      <p className="ai-intro">
        Stuck on a diagram in a book, e-book or worksheet? Upload a picture of it. It opens in the diagram explorer: move
        through its parts with the keyboard, follow the flow, hear each part read aloud and ask about anything. No teacher
        needed.
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
          {busy ? "Opening…" : "Open in diagram explorer"}
        </button>
      </form>
      {busy && (
        <p role="status" className="ai-progress">
          Reading the labels, finding the parts and arrows, and explaining… about 5–10 seconds.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {result && explorer && node && (
        <div className="ai-result">
          <div className="ai-note">
            <Sparkles size={16} aria-hidden="true" />
            AI explanation ({result.model}), not checked by a teacher. It can make mistakes.
          </div>
          <div className="ai-overview">
            <h2>{result.title}</h2>
            <p className="ai-summary">{result.summary}</p>
            <Speak text={`${result.title}. ${result.summary}${result.steps.length ? ` ${result.steps.join(" ")}` : ""}`} />
            {result.answer && (
              <div className="ai-answer">
                <h3>Your question</h3>
                <p>{result.answer}</p>
              </div>
            )}
          </div>
          <div className="explorer-layout ai-explorer">
            <aside className="tree-panel">
              <h2>Explore the parts</h2>
              <ConceptTree
                key={result.title + explorer.nodes.length}
                lesson={{ title: result.title, map: { parts: explorer.order.map((id) => explorer.nodes.find((n) => n.id === id)!) } }}
                selected={node.id}
                onSelect={setSelected}
              />
            </aside>
            <section className="concept-panel" aria-label="Selected part">
              <span className="section-kicker">
                {explorer.hasFlow ? "Step" : "Part"} {position + 1} of {explorer.order.length}
              </span>
              <h2>{node.name}</h2>
              <p className="concept-description">{node.text}</p>
              <span className={`found ${node.onImage ? "ok" : "warn"}`}>
                {node.onImage ? <Check size={13} aria-hidden="true" /> : <AlertTriangle size={13} aria-hidden="true" />}
                {node.onImage ? "Label read from the image" : "Not found on the image, check it"}
              </span>
              <Speak text={announcement} />
              <div className="sr-only" role="status" aria-live="polite">
                {announcement}
              </div>
              <div className="button-row flow-nav">
                <button disabled={!previous} onClick={() => previous && setSelected(previous)}>
                  <ArrowLeft size={16} aria-hidden="true" />
                  {previous ? `Previous${explorer.hasFlow ? " in flow" : ""}: ${nameOf(previous)}` : "Start"}
                </button>
                <button className="primary" disabled={!next} onClick={() => next && setSelected(next)}>
                  {next ? `Next${explorer.hasFlow ? " in flow" : ""}: ${nameOf(next)}` : "End"}
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
              </div>
              {connections.length > 0 && (
                <div className="connections">
                  <h3>Connected parts</h3>
                  {connections.map((c, i) => (
                    <button key={i} onClick={() => setSelected(c.id)}>
                      <span>{c.outgoing ? c.kind.replaceAll("_", " ") : "Connected from"}</span>
                      {nameOf(c.id)}
                      <ArrowRight size={16} aria-hidden="true" />
                    </button>
                  ))}
                </div>
              )}
              <form
                className="ask-part"
                onSubmit={(e) => {
                  e.preventDefault();
                  void askAboutPart();
                }}
              >
                <label>
                  Ask about {node.name}
                  <input
                    value={ask}
                    maxLength={300}
                    onChange={(e) => setAsk(e.target.value)}
                    placeholder="e.g. What happens if this is blocked?"
                  />
                </label>
                <button className="primary" disabled={asking || !ask.trim()}>
                  <MessageCircle size={16} aria-hidden="true" />
                  {asking ? "Thinking…" : "Ask AI"}
                </button>
              </form>
              {reply && (
                <div className="ai-answer" role="status">
                  <span className="ai-badge">AI answer about {reply.part}</span>
                  <p className="small">You asked: {reply.question}</p>
                  <p>{reply.answer}</p>
                  <Speak text={reply.answer} />
                </div>
              )}
            </section>
            <aside className="student-diagram">
              <Diagram map={explorer.map} selected={node.id} onSelect={setSelected} imageSrc={preview} showSpots />
              <p className="small">
                {explorer.map.labels.length
                  ? "Numbers mark the parts where their labels were read. Select one to explore it."
                  : "No label positions were found; use the list of parts."}
              </p>
            </aside>
          </div>
          {result.steps.length > 0 && (
            <section className="ai-overview">
              <h3>Step by step</h3>
              <ol className="ai-steps">
                {result.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </section>
          )}
          {result.hardWords.length > 0 && (
            <section className="ai-overview">
              <h3>Hard words</h3>
              <dl className="ai-words">
                {result.hardWords.map((w) => (
                  <div key={w.word}>
                    <dt>{w.word}</dt>
                    <dd>{w.meaning}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
          <WordExplainer context={result.summary} />
        </div>
      )}
    </div>
  );
}
