import type { Store } from "./store";
import type { AudioService } from "./audio";
import { createLesson } from "./providers";
import { items, validateMap } from "../shared/domain";
import { getTermSurfaces } from "../shared/vocabulary";
import type { Caption, DemoState, Question } from "../shared/schema";

const TERM = "Pulmonary artery";
export const DEMO_TITLE = "Demo · A journey through the heart";

/** Starts (or resumes) the guided demo on a fresh heart lesson. The lesson is
 * an ordinary lesson: the real validator, review, publish and vocabulary code
 * run on it. Only OCR and model proposals are authored fixtures. */
export async function startDemo(store: Store) {
  const current = store.demo();
  if (current && store.list().some((l) => l.id === current.lessonId)) return current;
  const lesson = await createLesson("heart", DEMO_TITLE);
  store.add(lesson);
  const value = { lessonId: lesson.id, initialFindings: validateMap(lesson.map).length };
  store.setDemo(value);
  store.audit(lesson.id, "demo_started", `Guided demo started with ${value.initialFindings} real validation finding(s).`);
  return value;
}

export function resetDemo(store: Store) {
  const current = store.demo();
  store.setDemo(null);
  // Published versions are immutable, so the old demo lesson is kept, not deleted.
  if (current) store.audit(current.lessonId, "demo_reset", "Guided demo reset; this lesson and its versions are retained.");
}

type Step = DemoState["steps"][number];
export function demoState(store: Store, audio: AudioService): DemoState {
  const current = store.demo();
  const lesson = current ? store.list().find((l) => l.id === current.lessonId) : undefined;
  if (!current || !lesson)
    return { lessonId: null, steps: [], next: "Start the guided demo to create the heart lesson." };
  const artery = lesson.map.parts.find((p) => p.name === TERM);
  const published = lesson.publishedVersion ? store.published(lesson.id) : null;
  const flagged = lesson.map.relations.find((r) => r.id === "relation-1");
  const decided = items(lesson.map).every((i) => ["teacher_approved", "rejected"].includes(i.state));
  const questions = store.records<Question>("questions", lesson.id).filter((q) => artery && q.conceptId === artery.id);
  const captionsMatch =
    !!published &&
    !!artery &&
    published.vocabulary.some((t) => t.id === artery.id) &&
    getTermSurfaces(artery.id, published, [
      ...store.records<Caption>("captions", lesson.id).filter((c) => c.version === published.version),
      ...store.lessonSegments(lesson.id, published.version),
    ]).captions;
  const step = (id: string, label: string, status: Step["status"], detail: string): Step => ({ id, label, status, detail });
  const done = (ok: boolean) => (ok ? "done" : "waiting") as Step["status"];
  const steps: Step[] = [
    step("upload", "Teacher adds the heart diagram", "done", "Self-created schematic stored locally. S3 upload is used only when AWS is configured."),
    step("ocr", "Labels are read from the diagram", "simulated", "Demo simulation: authored labels. Textract was not called."),
    step("proposal", "Parts, relationships and flow are proposed", "simulated", "Demo simulation: authored proposal. Bedrock was not called."),
    step("validate", "The validator flags an unsupported relationship", done(current.initialFindings > 0), `${current.initialFindings} deterministic finding(s) when the lesson was created.`),
    step("fix", "Teacher attaches evidence to the flagged relationship", done(!!flagged && flagged.evidence.length > 0), "Use “Attach endpoint labels” on Pulmonary artery → Lungs."),
    step("approve", "Teacher decides every item", done(decided || !!published), "Approve each concept, relationship and reading order."),
    step("publish", "Teacher publishes an immutable version", done(!!published), published ? `Version ${published.version} is live for students.` : "Publish becomes available after every decision."),
    step("vocabulary", `“${TERM}” becomes the canonical term`, done(!!published && published.vocabulary.some((t) => t.name === TERM)), "The same term now drives the explorer, glossary, captions and questions."),
    audio.enabled
      ? step("audio", "Approved descriptions get cached audio", done(!!published && !!artery && audio.has(published, artery.id)), "Polly audio is generated once per published version.")
      : step("audio", "Approved descriptions can be heard", "fallback", "Polly is not configured: the browser reads the approved text aloud."),
    step("explore", "Students can follow the blood flow in the explorer", done(!!published), "Explore → Next in flow. Student progress is not tracked."),
    step("captions", `“${TERM}” is recognised in captions`, done(captionsMatch), "Captions → start a session and play the sample lecture (it includes a misheard “artary”)."),
    step("ask", `A student asks about ${TERM}`, done(questions.length > 0), "Communicate → “I don’t understand what this does”."),
    step("inbox", "Teacher sees the question in the queue", done(questions.some((q) => q.status !== "queued")), "Questions & activity → Mark seen."),
  ];
  const pending = steps.find((s) => s.status === "waiting");
  return { lessonId: lesson.id, steps, next: pending ? pending.detail : "Every step of the story is complete." };
}
