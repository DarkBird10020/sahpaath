import { useState } from "react";
import { Plus, RotateCcw } from "lucide-react";
import type { DiagramMap, Lesson } from "../shared/schema";

export default function MapEditor({
  lesson,
  busy,
  onSave,
}: {
  lesson: Lesson;
  busy: boolean;
  onSave: (map: DiagramMap) => Promise<void>;
}) {
  const [map, setMap] = useState(() => structuredClone(lesson.map));
  const update = (fn: (m: DiagramMap) => void) =>
    setMap((previous) => {
      const next = structuredClone(previous);
      fn(next);
      return next;
    });
  return (
    <form
      className="map-editor"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(map);
      }}
    >
      <h3>Manual map editor</h3>
      <p>
        Saving resets every decision in this draft. IDs keep the map connected;
        source labels preserve where each concept came from.
      </p>
      {map.parts.map((p, i) => (
        <fieldset key={p.id}>
          <legend>Concept {i + 1}</legend>
          <div className="editor-grid">
            <label>
              Name
              <input
                required
                maxLength={120}
                value={p.name}
                onChange={(e) =>
                  update((m) => {
                    m.parts[i].name = e.target.value;
                  })
                }
              />
            </label>
            <label>
              Visible source label
              <input
                required
                maxLength={120}
                value={map.labels.find((l) => l.id === p.labelId)?.text || ""}
                onChange={(e) =>
                  update((m) => {
                    const label = m.labels.find((l) => l.id === p.labelId);
                    if (label) {
                      label.text = e.target.value;
                      label.source = "teacher_entered";
                      label.confidence = null;
                    }
                  })
                }
              />
            </label>
            <label>
              Description
              <textarea
                required
                maxLength={2000}
                value={p.description}
                onChange={(e) =>
                  update((m) => {
                    m.parts[i].description = e.target.value;
                  })
                }
              />
            </label>
            <div className="editor-grid">
              {(["x", "y"] as const).map((axis) => (
                <label key={axis}>
                  Label {axis} position (0–100%)
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={Math.round(
                      (map.labels.find((l) => l.id === p.labelId)?.[axis] ||
                        0) * 100,
                    )}
                    onChange={(e) =>
                      update((m) => {
                        const label = m.labels.find((l) => l.id === p.labelId);
                        if (label) label[axis] = Number(e.target.value) / 100;
                      })
                    }
                  />
                </label>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={() =>
              update((m) => {
                m.parts.splice(i, 1);
                m.labels = m.labels.filter((l) => l.id !== p.labelId);
                m.relations = m.relations.filter(
                  (r) => r.from !== p.id && r.to !== p.id,
                );
                m.flows = m.flows
                  .map((f) => ({
                    ...f,
                    steps: f.steps.filter((s) => s !== p.id),
                  }))
                  .filter((f) => f.steps.length);
              })
            }
          >
            Remove concept and its references
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        onClick={() =>
          update((m) => {
            const id = crypto.randomUUID();
            m.labels.push({
              id: `l-${id}`,
              text: "New label",
              x: 0.5,
              y: 0.5,
              source: "teacher_entered",
              confidence: null,
            });
            m.parts.push({
              id: `p-${id}`,
              labelId: `l-${id}`,
              name: "New label",
              description: "Describe this part.",
              state: "needs_review",
              reviewNote: "",
            });
          })
        }
      >
        <Plus size={16} aria-hidden="true" />
        Add concept
      </button>
      <h4>Relationships</h4>
      {map.relations.map((r, i) => (
        <fieldset key={r.id}>
          <legend>Relationship {i + 1}</legend>
          <div className="editor-grid">
            {(["from", "to"] as const).map((end) => (
              <label key={end}>
                {end === "from" ? "From concept" : "To concept"}
                <select
                  value={r[end]}
                  onChange={(e) =>
                    update((m) => {
                      m.relations[i][end] = e.target.value;
                    })
                  }
                >
                  {map.parts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <label>
              Relationship type
              <select
                value={r.kind}
                onChange={(e) =>
                  update((m) => {
                    m.relations[i].kind = e.target.value as typeof r.kind;
                  })
                }
              >
                <option value="flows_to">Flows to</option>
                <option value="connects_to">Connects to</option>
                <option value="supports">Supports</option>
              </select>
            </label>
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={r.evidence.length > 0}
              onChange={(e) =>
                update((m) => {
                  m.relations[i].evidence = e.target.checked
                    ? m.parts
                        .filter((p) => p.id === r.from || p.id === r.to)
                        .map((p) => p.labelId)
                    : [];
                })
              }
            />
            Attach both endpoint labels as evidence
          </label>
          <button
            type="button"
            onClick={() =>
              update((m) => {
                m.relations.splice(i, 1);
              })
            }
          >
            Remove relationship
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        disabled={map.parts.length < 2}
        onClick={() =>
          update((m) =>
            m.relations.push({
              id: `r-${crypto.randomUUID()}`,
              from: m.parts[0].id,
              to: m.parts[1].id,
              kind: "flows_to",
              evidence: [],
              state: "needs_review",
              reviewNote: "",
            }),
          )
        }
      >
        Add relationship
      </button>
      <h4>Reading order</h4>
      {map.flows.map((f, i) => (
        <fieldset key={f.id}>
          <legend>Process flow {i + 1}</legend>
          <label>
            Flow name
            <input
              required
              maxLength={120}
              value={f.name}
              onChange={(e) =>
                update((m) => {
                  m.flows[i].name = e.target.value;
                })
              }
            />
          </label>
          {f.steps.map((step, n) => (
            <div className="button-row" key={`${step}-${n}`}>
              <label>
                Step {n + 1}
                <select
                  value={step}
                  onChange={(e) =>
                    update((m) => {
                      m.flows[i].steps[n] = e.target.value;
                    })
                  }
                >
                  {map.parts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={f.steps.length === 1}
                onClick={() =>
                  update((m) => {
                    m.flows[i].steps.splice(n, 1);
                  })
                }
              >
                Remove step {n + 1}
              </button>
            </div>
          ))}
          <div className="button-row">
            <button
              type="button"
              disabled={!map.parts.some((p) => !f.steps.includes(p.id))}
              onClick={() =>
                update((m) => {
                  const next = m.parts.find((p) => !f.steps.includes(p.id));
                  if (next) m.flows[i].steps.push(next.id);
                })
              }
            >
              Add next step
            </button>
            <button
              type="button"
              onClick={() =>
                update((m) => {
                  m.flows.splice(i, 1);
                })
              }
            >
              Remove flow
            </button>
          </div>
        </fieldset>
      ))}
      <button
        type="button"
        disabled={!map.parts.length}
        onClick={() =>
          update((m) =>
            m.flows.push({
              id: `f-${crypto.randomUUID()}`,
              name: "Reading order",
              steps: m.parts.map((p) => p.id),
              state: "needs_review",
              reviewNote: "",
            }),
          )
        }
      >
        Add reading flow
      </button>
      <div className="editor-footer">
        <button
          type="button"
          onClick={() => setMap(structuredClone(lesson.map))}
        >
          <RotateCcw size={16} aria-hidden="true" />
          Reset unsaved edits
        </button>
        <button className="primary" disabled={busy}>
          Save map & revalidate
        </button>
      </div>
    </form>
  );
}
