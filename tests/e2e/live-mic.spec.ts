import { expect, test } from "@playwright/test";
import type { Lesson } from "../../shared/schema";

// Top level on purpose: a fake microphone needs its own browser launch.
test.use({
  permissions: ["microphone"],
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
});

test("recording the microphone turns spoken audio into caption lines", async ({ page }) => {
  let uploads = 0;
  await page.route("**/api/ai/transcribe", async (route) => {
    const sent = route.request().postDataJSON() as { mime: string; base64: string };
    expect(sent.mime).toBe("audio/wav");
    expect(Buffer.from(sent.base64, "base64").subarray(0, 4).toString()).toBe("RIFF");
    uploads++;
    await route.fulfill({ json: { segments: [{ startMs: 0, endMs: 1500, text: "blood reaches the lungs" }], hardWords: [], model: "test" } });
  });

  await page.goto("/");
  await page.request.post("/api/session", { data: { role: "teacher", password: "e2e-teacher" } });
  let lesson = (await (await page.request.post("/api/lessons", { data: { fixtureId: "heart" } })).json()) as Lesson;
  const map = lesson.map;
  map.relations[1].evidence = ["label-1", "label-2"];
  lesson = (await (await page.request.put(`/api/lessons/${lesson.id}/map`, { data: { revision: lesson.revision, map } })).json()) as Lesson;
  for (const item of [...map.parts, ...map.relations, ...map.flows])
    lesson = (await (
      await page.request.post(`/api/lessons/${lesson.id}/decision`, {
        data: { revision: lesson.revision, itemId: item.id, decision: "approve", note: "Verified fixture for automated integration test." },
      })
    ).json()) as Lesson;
  expect((await page.request.post(`/api/lessons/${lesson.id}/publish`, { data: { revision: lesson.revision } })).ok()).toBe(true);

  await page.goto("about:blank");
  await page.goto("/#/captions");
  await page.getByRole("button", { name: "Start with microphone" }).click();
  await expect(page.getByRole("button", { name: "Stop microphone" })).toBeVisible();
  await expect(page.getByRole("log", { name: "Caption lines" }).getByText("blood reaches the lungs").first()).toBeVisible({ timeout: 20000 });
  expect(uploads).toBeGreaterThan(0);
});
