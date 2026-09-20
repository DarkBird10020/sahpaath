import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { Lesson } from "../../shared/schema";

async function teacherLogin(page: Page) {
  await page.goto("/");
  await page.request.post("/api/session", { data: { role: "teacher", password: "e2e-teacher" } });
  await page.goto("about:blank");
  await page.goto("/#/teacher");
  await expect(page.getByRole("heading", { name: "Make the lesson open to everyone." })).toBeVisible();
}

async function publishHeart(page: Page) {
  let lesson = (await (await page.request.post("/api/lessons", { data: { fixtureId: "heart" } })).json()) as Lesson;
  const map = lesson.map;
  map.relations[1].evidence = ["label-1", "label-2"];
  lesson = (await (await page.request.put(`/api/lessons/${lesson.id}/map`, { data: { revision: lesson.revision, map } })).json()) as Lesson;
  for (const item of [...map.parts, ...map.relations, ...map.flows])
    lesson = (await (
      await page.request.post(`/api/lessons/${lesson.id}/decision`, {
        data: { revision: lesson.revision, itemId: item.id, decision: "approve", note: "Verified fixture for automated polling test." },
      })
    ).json()) as Lesson;
  expect((await page.request.post(`/api/lessons/${lesson.id}/publish`, { data: { revision: lesson.revision } })).ok()).toBe(true);
  return lesson;
}

test("live captions read one session per tick, not the list and the session every time", async ({ page }) => {
  await teacherLogin(page);
  const lesson = await publishHeart(page);
  await page.request.post("/api/caption-sessions", { data: { lessonId: lesson.id, source: "typed" } });
  let lists = 0;
  let details = 0;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/caption-sessions") lists++;
    else if (/^\/api\/caption-sessions\/[\w-]+$/.test(url.pathname)) details++;
  });
  await page.reload();
  await page.getByRole("button", { name: "Captions", exact: true }).click();
  await expect(page.getByRole("region", { name: "Live captions" })).toBeVisible();
  lists = 0;
  details = 0;
  await page.waitForTimeout(14_000);
  // 14 s at 1.5 s is about 9 ticks. Before the fix every tick made a list AND a detail request.
  expect(details).toBeGreaterThanOrEqual(6);
  expect(lists).toBeLessThanOrEqual(3);
});

test("a tab whose role was changed by another tab notices, recovers and stops asking", async ({ page }) => {
  await teacherLogin(page);
  let demoCalls = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/demo/state") demoCalls++;
  });
  await expect(page.getByRole("heading", { name: "Make the lesson open to everyone." })).toBeVisible();
  // Another tab of the same browser picks "student": the shared cookie now belongs to a student.
  await page.request.post("/api/session", { data: { role: "student" } });
  await expect(page.getByRole("heading", { name: "Make the lesson open to everyone." })).toBeHidden({ timeout: 15_000 });
  const settled = demoCalls;
  await page.waitForTimeout(12_000);
  // It used to keep polling the teacher-only endpoint every 3 s (301 forbidden answers in one evening).
  expect(demoCalls - settled).toBeLessThanOrEqual(1);
});

test("a first visit while signed out leaves the console and network clean", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("response", (r) => {
    if (r.status() >= 400) problems.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });
  await page.goto("/");
  await expect(page.getByRole("link", { name: "SahPaath home" })).toBeVisible();
  await page.waitForTimeout(3000);
  expect(problems).toEqual([]);
});

test("the reading panel stays up while the diagram is still being analysed, then the review opens", async ({ page }) => {
  await page.goto("/");
  await page.request.post("/api/session", { data: { role: "teacher", password: "e2e-teacher" } });
  const real = (await (await page.request.post("/api/lessons", { data: { fixtureId: "heart" } })).json()) as Lesson;
  let reading = true;
  // The server answers an upload at once and analyses in the background: the lesson exists,
  // its map is still empty and its Analysis stage says "waiting".
  const whileReading = (lesson: Lesson): Lesson => ({
    ...lesson,
    map: { labels: [], parts: [], relations: [], flows: [] },
    stages: lesson.stages.map((stage) => (stage.name === "Analysis" || stage.name === "OCR labels" ? { ...stage, status: "waiting" as const } : stage)),
  });
  await page.route(/\/api\/lessons$/, async (route) => {
    if (!reading || route.request().method() !== "GET") return route.continue();
    const all = (await (await route.fetch()).json()) as Lesson[];
    await route.fulfill({ json: all.map((l) => (l.id === real.id ? whileReading(l) : l)) });
  });
  await page.route(/\/api\/lessons\/[\w-]+\/processing-status$/, async (route) => {
    if (!reading) return route.continue();
    await route.fulfill({ json: whileReading(real) });
  });
  await page.goto("about:blank");
  await page.goto("/#/teacher");
  await expect(page.getByRole("heading", { name: "Reading your diagram" })).toBeVisible();
  // Not the empty lesson that used to appear the moment the upload request returned.
  await expect(page.getByText("0 concepts")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit map" })).toHaveCount(0);
  await page.waitForTimeout(6000);
  await expect(page.getByRole("heading", { name: "Reading your diagram" })).toBeVisible(); // still waiting
  reading = false; // the background analysis finished
  await expect(page.getByRole("heading", { name: "Reading your diagram" })).toBeHidden({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "A journey through the heart", exact: true }).first()).toBeVisible();
});

test("a teacher can hide a caption line from the transcript, and it is gone for everyone", async ({ page, playwright }) => {
  await teacherLogin(page);
  const lesson = await publishHeart(page);
  const session = (await (await page.request.post("/api/caption-sessions", { data: { lessonId: lesson.id, source: "typed" } })).json()) as { id: string };
  const say = async (text: string) => (await (await page.request.post(`/api/caption-sessions/${session.id}/segments`, { data: { text, isFinal: true } })).json()) as { id: string };
  await say("Blood leaves the right ventricle.");
  const unwanted = await say("A line the teacher does not want in the history.");
  await say("It travels to the lungs.");
  await page.reload();
  await page.getByRole("button", { name: "Captions", exact: true }).click();
  const log = page.getByRole("log", { name: "Caption lines" });
  await expect(log.getByText("A line the teacher does not want in the history.")).toBeVisible();
  await page.getByRole("button", { name: /Hide this line from the transcript: A line the teacher does not want/ }).click();
  await expect(log.getByText("A line the teacher does not want in the history.")).toBeHidden();
  await expect(log.getByText("Blood leaves the right ventricle.")).toBeVisible();
  // Gone from the API, search and the download, not just the screen.
  const listed = (await (await page.request.get(`/api/caption-sessions/${session.id}/segments`)).json()) as { text: string }[];
  expect(listed.map((l) => l.text)).toEqual(["Blood leaves the right ventricle.", "It travels to the lungs."]);
  const exported = await (await page.request.get(`/api/caption-sessions/${session.id}/export`)).text();
  expect(exported).not.toContain("does not want");
  // A student cannot hide lines; the teacher can put it back.
  const student = await playwright.request.newContext({ baseURL: new URL(page.url()).origin });
  await student.post("/api/session", { data: { role: "student" } });
  expect((await student.post(`/api/caption-sessions/${session.id}/segments/${unwanted.id}/hide`)).status()).toBe(403);
  await student.dispose();
  expect((await page.request.post(`/api/caption-sessions/${session.id}/segments/${unwanted.id}/restore`)).ok()).toBe(true);
  const restored = (await (await page.request.get(`/api/caption-sessions/${session.id}/segments`)).json()) as { text: string }[];
  expect(restored).toHaveLength(3);
  expect((await page.request.post(`/api/caption-sessions/${session.id}/segments/not-a-line/hide`)).status()).toBe(404);
});
