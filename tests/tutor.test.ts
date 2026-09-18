import { describe, it, expect } from "vitest";
import { answerFromLesson, explainDiagram, explainWord, transcribeMedia } from "../server/tutor";
import { createLesson } from "../server/providers";
import { fixtureMap } from "../shared/fixtures";
import { decide, items, publishSnapshot } from "../shared/domain";

// No network: every Gemini reply below is canned.
const config = { apiKey: "k", model: "gemini-test" };
const reply = (text: string) =>
  new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }] }), { status: 200 });
function fakeFetch(...texts: string[]) {
  const prompts: string[] = [];
  const impl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    prompts.push(body.contents[0].parts.at(-1).text);
    const next = texts.shift();
    if (next === undefined) throw new Error("unexpected extra call");
    return reply(next);
  }) as typeof fetch;
  return { impl, prompts };
}
async function heart() {
  const lesson = await createLesson("heart");
  let map = fixtureMap("heart", false);
  for (const i of items(map)) map = decide(map, i.id, "approve", "Checked.");
  lesson.map = map;
  return publishSnapshot(lesson, "2026-09-18T00:00:00Z");
}
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

describe("Explain a diagram", () => {
  const answer = {
    title: "Blood flow",
    summary: "Blood moves from the heart to the lungs.",
    parts: [
      { name: "Lungs", explanation: "Where blood gets oxygen." },
      { name: "Aorta", explanation: "The main artery." },
    ],
    steps: ["Blood leaves the heart."],
    hardWords: [{ word: "Atrium", meaning: "An upper heart chamber." }],
    answer: null,
  };
  it("checks each part name against the labels OCR actually read", async () => {
    const { impl, prompts } = fakeFetch(JSON.stringify(answer));
    const ocr = async () => [{ text: "Lungs", confidence: 95, box: { x: 0, y: 0, width: 0.1, height: 0.1 } }];
    const result = await explainDiagram(config, { bytes: PNG, mime: "image/png" }, ocr, null, impl);
    expect(result.parts.map((p) => [p.name, p.onImage])).toEqual([["Lungs", true], ["Aorta", false]]);
    expect(result.labels).toEqual(["Lungs"]);
    expect(prompts[0]).toContain('["Lungs"]');
  });
  it("still explains when OCR fails, and passes the learner's question", async () => {
    const { impl, prompts } = fakeFetch(JSON.stringify({ ...answer, answer: "To get oxygen." }));
    const result = await explainDiagram(config, { bytes: PNG, mime: "image/png" }, async () => { throw new Error("ocr down"); }, "Why lungs?", impl);
    expect(result.labels).toEqual([]);
    expect(result.answer).toBe("To get oxygen.");
    expect(prompts[0]).toContain('"Why lungs?"');
  });
  it("rejects malformed model output", async () => {
    await expect(explainDiagram(config, { bytes: PNG, mime: "image/png" }, async () => [], null, fakeFetch("{").impl)).rejects.toThrow();
  });
});

describe("AI tutor answers from the lesson", () => {
  it("sends the approved lesson as context and drops unknown concept ids", async () => {
    const published = await heart();
    const { impl, prompts } = fakeFetch(JSON.stringify({ answer: "It carries blood to the lungs.", conceptIds: ["part-1", "invented"], outsideLesson: false }));
    const result = await answerFromLesson(config, published, "Where does it go?", "part-1", impl);
    expect(result).toEqual({ answer: "It carries blood to the lungs.", conceptIds: ["part-1"], outsideLesson: false });
    expect(prompts[0]).toContain("Pulmonary artery");
    expect(prompts[0]).toContain("The student is looking at: Pulmonary artery.");
    expect(prompts[0]).toContain('"Where does it go?"');
  });
});

describe("Explain a word", () => {
  it("uses the teacher-approved definition for lesson terms and aliases without calling the AI", async () => {
    const published = await heart();
    const { impl } = fakeFetch();
    const result = await explainWord(config, "pulmonary TRUNK", null, published, impl);
    expect(result).toMatchObject({ source: "teacher_approved", termId: "part-1", meaning: "Carries blood from the right ventricle toward the lungs." });
  });
  it("asks the AI for other words and labels the answer as AI", async () => {
    const { impl, prompts } = fakeFetch(JSON.stringify({ meaning: "Swapping oxygen and carbon dioxide.", example: null }));
    const result = await explainWord(config, "gas exchange", "In the lungs, gas exchange happens.", null, impl);
    expect(result).toEqual({ word: "gas exchange", meaning: "Swapping oxygen and carbon dioxide.", example: null, source: "ai", termId: null });
    expect(prompts[0]).toContain("In the lungs, gas exchange happens.");
  });
  it("fails clearly when the AI is not configured", async () => {
    await expect(explainWord(null, "osmosis", null, null)).rejects.toThrow("not configured");
  });
});

describe("Captions for media", () => {
  it("converts seconds to ms, sorts lines and drops empty ones", async () => {
    const { impl } = fakeFetch(JSON.stringify({
      segments: [
        { start: 3.4, end: 7.4, text: "It travels to the lungs." },
        { start: 0, end: 2.9, text: "Blood leaves the heart." },
        { start: 8, end: 7, text: "  " },
      ],
      hardWords: [{ word: "pulmonary artery", meaning: "Carries blood to the lungs." }],
    }));
    const result = await transcribeMedia(config, { bytes: Buffer.from("audio"), mime: "audio/wav" }, impl);
    expect(result.segments).toEqual([
      { startMs: 0, endMs: 2900, text: "Blood leaves the heart." },
      { startMs: 3400, endMs: 7400, text: "It travels to the lungs." },
    ]);
    expect(result.hardWords).toHaveLength(1);
  });
});
