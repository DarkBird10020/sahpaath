import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, writeFile } from "node:fs/promises";
import type { Lesson } from "../../shared/schema";

async function scan(page: Page, name: string) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  await mkdir("docs/reports", { recursive: true });
  await writeFile(
    `docs/reports/axe-${name}.json`,
    JSON.stringify(
      {
        url: page.url(),
        timestamp: new Date().toISOString(),
        violations: result.violations,
        passes: result.passes.map((p) => p.id),
        incomplete: result.incomplete.map((i) => ({
          id: i.id,
          impact: i.impact,
          description: i.description,
        })),
      },
      null,
      2,
    ),
  );
  expect(result.violations, name).toEqual([]);
}
async function teacherLogin(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open classroom", exact: true })
    .click();
  await page.getByLabel("Local teacher password").fill("e2e-teacher");
  await page.getByRole("button", { name: "Enter classroom" }).click();
  await expect(
    page.getByRole("heading", { name: "Make the lesson open to everyone." }),
  ).toBeVisible();
}
async function createPublished(page: Page) {
  const response = await page.request.post("/api/lessons", {
    data: { fixtureId: "heart" },
  });
  let lesson = (await response.json()) as Lesson;
  const map = lesson.map;
  map.relations[1].evidence = ["label-1", "label-2"];
  lesson = (await (
    await page.request.put(`/api/lessons/${lesson.id}/map`, {
      data: { revision: lesson.revision, map },
    })
  ).json()) as Lesson;
  for (const item of [...map.parts, ...map.relations, ...map.flows]) {
    lesson = (await (
      await page.request.post(`/api/lessons/${lesson.id}/decision`, {
        data: {
          revision: lesson.revision,
          itemId: item.id,
          decision: "approve",
          note: "Verified fixture for automated integration test.",
        },
      })
    ).json()) as Lesson;
  }
  expect(
    (
      await page.request.post(`/api/lessons/${lesson.id}/publish`, {
        data: { revision: lesson.revision },
      })
    ).ok(),
  ).toBe(true);
  return lesson.id;
}
test("scroll story supports chapter navigation, reduced motion and narrow screens", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Previous chapter", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Next chapter", exact: true }).click();
  await expect(page.getByRole("button", { name: "02 Structure", exact: true })).toHaveAttribute("aria-current", "step");
  await page.getByRole("button", { name: "Previous chapter", exact: true }).click();
  await expect(page.getByRole("button", { name: "01 One lesson", exact: true })).toHaveAttribute("aria-current", "step");
  await page.getByRole("button", { name: "07 Shared vocabulary" }).click();
  await expect(
    page.getByRole("heading", { name: "One word. Every way in." }),
  ).toBeVisible();
  await scan(page, "story-vocabulary");
  await page.screenshot({ path: "docs/reports/story-depth.png" });
  await page.getByRole("button", { name: "Turn off depth & scroll" }).click();
  await page.getByRole("button", { name: "03 Teacher review" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "AI proposes. A teacher decides." }),
  ).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Enable depth & scroll" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "06 Ask" }).click();
  await expect(
    page.getByRole("heading", { name: "Ask without speaking." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next chapter", exact: true }).click();
  await expect(page.getByRole("button", { name: "Next chapter", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Previous chapter", exact: true }).click();
  await scan(page, "story-mobile");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "docs/reports/story-mobile.png",
    fullPage: true,
  });
});

test("landing, login and narrow layout accessibility", async ({ page }) => {
  await page.goto("/");
  await scan(page, "landing");
  await page.screenshot({
    path: "docs/reports/landing-desktop.png",
    fullPage: true,
  });
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to main content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
  await page
    .getByRole("button", { name: "Open classroom", exact: true })
    .click();
  await scan(page, "login");
  await page.setViewportSize({ width: 320, height: 740 });
  await scan(page, "login-mobile");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: "SahPaath home" }).click();
  await page.screenshot({
    path: "docs/reports/landing-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("teacher repairs, approves, publishes, explores and sends a contextual question", async ({
  page,
}) => {
  await teacherLogin(page);
  await page.getByRole("button", { name: "Use sample diagram" }).click();
  await expect(
    page.getByRole("button", { name: "Publish lesson", exact: true }),
  ).toBeDisabled();
  await scan(page, "teacher-review");
  await page.screenshot({
    path: "docs/reports/teacher-review.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Attach endpoint labels" }).click();
  const approve = page.getByRole("button", { name: "Approve", exact: true });
  for (let i = 0; i < 10; i++) {
    const next = approve.filter({ visible: true }).all();
    const buttons = await next;
    const enabled = [];
    for (const b of buttons) if (await b.isEnabled()) enabled.push(b);
    if (!enabled.length) break;
    await enabled[0].click();
    await expect(
      page.getByText("Teacher approved", { exact: true }).first(),
    ).toBeVisible();
    await expect(approve.locator("..").first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Use sample diagram" }),
    ).toBeEnabled();
  }
  await expect(
    page.getByRole("button", { name: "Publish lesson", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Publish lesson", exact: true })
    .click();
  await expect(
    page.getByText("This version is published and cannot be edited."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Processing details" }).click();
  await scan(page, "pipeline");
  await page.getByRole("button", { name: "Review the map" }).click();
  await page.getByRole("button", { name: "Open student lesson" }).click();
  await scan(page, "explorer");
  const root = page
    .getByRole("treeitem", { name: /A journey through the heart/ })
    .first();
  await root.focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("treeitem", { name: "1 Right ventricle" }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Pulmonary artery", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(root).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(root).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("ArrowRight");
  await expect(root).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "Captions", exact: true }).click();
  await page
    .getByRole("button", { name: "Load heart sample transcript" })
    .click();
  await expect(page.locator(".transcript-content .term").first()).toBeVisible();
  await page
    .locator(".transcript-content .term")
    .filter({ hasText: "Pulmonary artery" })
    .first()
    .click();
  await scan(page, "captions");
  await page.getByRole("button", { name: "Ask about this" }).click();
  await expect(page.getByLabel("Approved concept")).toHaveValue("part-1");
  await scan(page, "communication");
  await page
    .getByRole("button", { name: "I don’t understand what this does" })
    .click();
  await expect(page.locator(".sent-message")).toContainText("Sent:");
  await page
    .getByRole("button", { name: "Teacher workspace", exact: true })
    .click();
  await page.getByRole("button", { name: "Questions & activity" }).click();
  await expect(page.locator(".inbox")).toContainText(
    "Ask about Pulmonary artery",
  );
  await scan(page, "inbox");
  await page.getByRole("button", { name: "Evidence & limitations" }).click();
  await scan(page, "evaluation");
});
test("API roles, forged approval, races and malicious uploads", async ({
  page,
  playwright,
}) => {
  await teacherLogin(page);
  const id = await createPublished(page);
  const student = await playwright.request.newContext({
    baseURL: "http://127.0.0.1:5174",
  });
  expect(
    (await student.post("/api/session", { data: { role: "student" } })).ok(),
  ).toBe(true);
  expect((await student.get("/api/lessons")).status()).toBe(403);
  expect(
    (
      await student.post(`/api/lessons/${id}/publish`, {
        data: { revision: 0 },
      })
    ).status(),
  ).toBe(403);
  const pub = await (await student.get(`/api/published/${id}`)).json();
  expect(
    pub.map.parts.every(
      (p: { state: string }) => p.state === "teacher_approved",
    ),
  ).toBe(true);
  const draftResponse = await page.request.post("/api/lessons", {
    data: { fixtureId: "pump" },
  });
  const draft = (await draftResponse.json()) as Lesson;
  expect((await student.get(`/api/published/${draft.id}`)).status()).toBe(409);
  draft.map.parts.forEach((p) => {
    p.state = "teacher_approved";
  });
  const edited = (await (
    await page.request.put(`/api/lessons/${draft.id}/map`, {
      data: { revision: 0, map: draft.map },
    })
  ).json()) as Lesson;
  expect(edited.map.parts.some((p) => p.state === "teacher_approved")).toBe(
    false,
  );
  expect(
    (
      await page.request.post(`/api/lessons/${draft.id}/publish`, {
        data: { revision: edited.revision },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await page.request.put(`/api/lessons/${draft.id}/map`, {
        data: { revision: 0, map: draft.map },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await page.request.post("/api/upload", {
        data: {
          title: "Bad file",
          mime: "image/png",
          base64: Buffer.from("<svg><script>alert(1)</script></svg>").toString(
            "base64",
          ),
        },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await page.request.post("/api/lessons", {
        headers: { Origin: "https://example.com" },
        data: { fixtureId: "heart" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await student.post("/api/questions", {
        data: {
          lessonId: id,
          version: 1,
          conceptId: "invented",
          text: "Question",
        },
      })
    ).status(),
  ).toBe(400);
  await student.dispose();
});
test("keyboard-only phrase, mobile explorer, high contrast and no WebGL fallback", async ({
  page,
}) => {
  await teacherLogin(page);
  await createPublished(page);
  await page.reload();
  await page.getByRole("button", { name: "Explore", exact: true }).click();
  await page.setViewportSize({ width: 320, height: 800 });
  await scan(page, "explorer-mobile");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Accessibility settings" }).click();
  await page.getByLabel("High contrast", { exact: true }).check();
  await page.getByLabel("Larger text", { exact: true }).check();
  await page
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  await scan(page, "explorer-contrast-large");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Communicate", exact: true }).click();
  await page
    .getByRole("button", { name: "Please repeat", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".sent-message")).toContainText("Please repeat");
  await page.getByRole("button", { name: "Explore", exact: true }).click();
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...args: unknown[]
    ) {
      return type.startsWith("webgl")
        ? null
        : Reflect.apply(original, this, [type, ...args]);
    } as typeof original;
  });
  await page.getByRole("button", { name: "Accessibility settings" }).click();
  await page.getByLabel("Enable optional 3D concept graph").check();
  await expect(
    page.getByText(
      "3D is unavailable. Use the concept tree and diagram above.",
    ),
  ).toBeVisible();
});

test("manual upload fallback can be reviewed and published without an OCR service", async ({
  page,
}) => {
  await teacherLogin(page);
  await page.getByText("Upload your diagram", { exact: true }).click();
  await page
    .getByLabel("Lesson title", { exact: true })
    .fill("Manual water lesson");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jAfcAAAAASUVORK5CYII=",
    "base64",
  );
  await page
    .locator("input[type=file]")
    .setInputFiles({ name: "source.png", mimeType: "image/png", buffer: png });
  await expect(
    page.getByRole("heading", { name: "Manual water lesson", exact: true }),
  ).toBeVisible();
  if (
    !(await page
      .getByRole("heading", { name: "Manual map editor" })
      .isVisible())
  )
    await page.getByRole("button", { name: "Edit map", exact: true }).click();
  await page.getByRole("button", { name: "Add concept", exact: true }).click();
  const group = page.getByRole("group", { name: "Concept 1", exact: true });
  await group.getByLabel("Name", { exact: true }).fill("Pump");
  await group.getByLabel("Visible source label").fill("Pump");
  await group
    .getByRole("textbox", { name: "Description", exact: true })
    .fill("Moves water through a pipe.");
  await scan(page, "manual-editor");
  await page.getByRole("button", { name: "Save map & revalidate" }).click();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "review note" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Review note for Pump", exact: true })
    .fill("Manual label and description checked for this test fixture.");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await page
    .getByRole("button", { name: "Publish lesson", exact: true })
    .click();
  await expect(
    page.getByText("This version is published and cannot be edited."),
  ).toBeVisible();
});

test("caption correction uses the published glossary and retains original text; local storage is private", async ({
  page,
}) => {
  await teacherLogin(page);
  const lessonId = await createPublished(page);
  const caption = await (
    await page.request.post(`/api/lessons/${lessonId}/captions`, {
      data: {
        text: "The pulmonary art tree carries blood.",
        source: "loaded_transcript",
      },
    })
  ).json();
  const corrected = await (
    await page.request.post(`/api/captions/${caption.id}/correct`, {
      data: { heard: "pulmonary art tree", termId: "part-1" },
    })
  ).json();
  expect(corrected.text).toBe("The Pulmonary artery carries blood.");
  expect(corrected.originalText).toBe(caption.text);
  expect(corrected.corrections).toHaveLength(1);
  expect((await page.request.get("/.data/sahpaath.sqlite")).status()).toBe(403);
  expect((await page.request.get("/.data/e2e/sahpaath.sqlite")).status()).toBe(
    403,
  );
  expect((await page.request.get("/shared/fixtures.ts")).status()).toBe(403);
  await page.request.post("/api/session", { data: { role: "student" } });
  expect(
    (
      await page.request.post(`/api/captions/${caption.id}/correct`, {
        data: { heard: "blood", termId: "part-1" },
      })
    ).status(),
  ).toBe(403);
});

test("landing playground links a caption term to the diagram and a question by keyboard", async ({
  page,
}) => {
  await page.goto("/");
  const explore = page.getByRole("tab", { name: "Explore" });
  await explore.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Captions" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "Captions" })).toBeFocused();
  await page.getByRole("button", { name: "Lungs", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Lungs", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Explore this" }).click();
  await expect(page.getByRole("tab", { name: "Explore" })).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("tabpanel").getByRole("button", { name: "Lungs", exact: true }),
  ).toHaveAttribute("aria-current", "step");
  await expect(page.getByText("Lungs. Step 3 of 5", { exact: false })).toBeVisible();
  await scan(page, "landing-playground");
  await page.getByRole("tab", { name: "Captions" }).click();
  await page.getByRole("button", { name: "Pulmonary veins" }).click();
  await page.getByRole("button", { name: "Ask about this" }).click();
  await expect(page.getByLabel("Ask about")).toHaveValue("3");
  await page.getByRole("button", { name: "Send to teacher" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Demo only" })).toContainText(
    "Ask about Pulmonary veins",
  );
});
