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
