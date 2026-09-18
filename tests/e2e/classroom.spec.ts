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
  // Depth and scroll are always on: there is no switch to turn them off.
  await expect(page.getByRole("button", { name: /depth & scroll/ })).toHaveCount(0);
  await expect(page.locator(".diagram-story")).not.toHaveClass(/story-flat/);
  await page.getByRole("button", { name: "03 Teacher review" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "AI proposes. A teacher decides." }),
  ).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");
  // Reduced motion and phones get the simple step-by-step layout.
  await expect(page.locator(".diagram-story")).toHaveClass(/story-flat/);
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
  await page
    .getByLabel("License (required)", { exact: true })
    .fill("CC0 self-made for tests");
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
  const vocabulary = await (
    await page.request.get(`/api/published/${lessonId}/vocabulary`)
  ).json();
  expect(vocabulary.map((t: { name: string }) => t.name)).toContain(
    "Pulmonary artery",
  );
  const surfaces = await (
    await page.request.get(
      `/api/published/${lessonId}/vocabulary/part-1/surfaces`,
    )
  ).json();
  expect(surfaces).toEqual({
    explorer: true,
    glossary: true,
    audio: true,
    captions: true,
    communicationAnchor: true,
  });
  expect(
    (
      await page.request.get(
        `/api/published/${lessonId}/vocabulary/unknown-term/surfaces`,
      )
    ).status(),
  ).toBe(404);
  expect((await page.request.get("/.data/sahpaath.sqlite")).status()).toBe(403);
  expect((await page.request.get("/.data/e2e/sahpaath.sqlite")).status()).toBe(
    403,
  );
  expect((await page.request.get("/shared/fixtures.ts")).status()).toBe(403);
  await page.request.post("/api/session", { data: { role: "student" } });
  const explorer = await (
    await page.request.get(`/api/published/${lessonId}/explorer`)
  ).json();
  expect(explorer.audioEngine).toBe("browser_speech");
  const artery = await (
    await page.request.get(`/api/published/${lessonId}/explorer/parts/part-1`)
  ).json();
  expect(artery).toMatchObject({
    name: "Pulmonary artery",
    flow: { position: 2, previous: "part-0", next: "part-2" },
    audio: null,
  });
  expect(
    (await page.request.get(`/api/published/${lessonId}/explorer/parts/nope`)).status(),
  ).toBe(404);
  // Polly is not configured in e2e: no audio is served and text remains the path.
  expect(
    (await page.request.get(`/api/published/${lessonId}/audio/part-1`)).status(),
  ).toBe(404);
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

test("trust pipeline exposes each stage with an accessible inspector", async ({ page }) => {
  await page.goto("/");
  const validation = page.getByRole("button", { name: /Code validates/ });
  await validation.click();
  await expect(validation).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("complementary", { name: "Selected pipeline stage" })).toContainText(
    "Stage 2 · Validated",
  );
  await page.getByRole("button", { name: /Students use it/ }).click();
  await expect(page.getByRole("complementary", { name: "Selected pipeline stage" })).toContainText(
    "Stage 4 · Published",
  );
});

test("calm motion setting stops scroll animation and pins nothing", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveClass(/motion-on/);
  await page.getByRole("button", { name: "Accessibility settings" }).click();
  await page.getByLabel("Calm motion (stop scroll animations)").check();
  await expect(page.locator("html")).not.toHaveClass(/motion-on/);
  await expect(page.locator(".diagram-story")).toHaveClass(/story-flat/);
  // Calm motion also turns off the scroll-stepped sections: nothing is pinned or hidden.
  await expect(page.locator(".scroll-pin.is-pinned")).toHaveCount(0);
  await expect(page.locator(".trust-steps li.is-pending")).toHaveCount(0);
  await expect(page.locator(".wl.is-lit")).toHaveCount(8);
  await expect(page.getByRole("heading", { name: "Same lesson. Your way in." })).toBeVisible();
  await scan(page, "landing-calm");
});

test("scrolling the landing page never fights the reader", async ({ page }) => {
  // A laptop-sized window: this height used to sit on the pinning threshold, so the
  // sections pinned and unpinned dozens of times and the page jumped up and down.
  await page.setViewportSize({ width: 1440, height: 780 });
  await page.goto("/");
  await page.evaluate(() => {
    const w = window as unknown as { report: { pins: number; back: number } };
    w.report = { pins: 0, back: 0 };
    const seen = new Map<Element, boolean>();
    const check = () =>
      document.querySelectorAll(".scroll-pin").forEach((el) => {
        const pinned = el.classList.contains("is-pinned");
        if (seen.has(el) && seen.get(el) !== pinned) w.report.pins++;
        seen.set(el, pinned);
      });
    check();
    new MutationObserver(check).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });
    let previous = scrollY;
    let direction = 0;
    addEventListener(
      "scroll",
      () => {
        const delta = scrollY - previous;
        // Ignore the clamp at the very bottom of the page.
        if (direction > 0 && delta < -2 && scrollY < document.documentElement.scrollHeight - innerHeight - 2) w.report.back++;
        if (delta !== 0) direction = delta;
        previous = scrollY;
      },
      { passive: true },
    );
  });
  await page.mouse.move(720, 400);
  for (let i = 0; i < 60; i++) {
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(25);
  }
  const report = await page.evaluate(() => (window as unknown as { report: { pins: number; back: number } }).report);
  expect(report.pins).toBe(0);
  expect(report.back).toBe(0);
});

test("stepped sections lock in place first, then move one point at a time", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 780 });
  await page.goto("/");
  const at = async (section: string, through: number) =>
    page.evaluate(
      ({ section, through }) => {
        const el = document.querySelector(section) as HTMLElement;
        const top = el.getBoundingClientRect().top + scrollY;
        scrollTo(0, Math.round(top + (el.offsetHeight - innerHeight) * through));
      },
      { section, through },
    );
  // Both sections lock; the whole locked panel stays on screen, nothing cut off.
  for (const section of ["#try-it", "#how-it-works"]) {
    await at(section, 0.5);
    await page.waitForTimeout(200);
    await expect(page.locator(`${section}.is-pinned`)).toHaveCount(1);
    const box = await page.locator(`${section} > div`).first().boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(-2);
    expect(box!.y + box!.height).toBeLessThanOrEqual(782);
  }
  // The playground starts on part 1 when it locks and reaches part 5 at the end,
  // instead of racing through the parts while the section is still sliding in.
  const current = page.locator('.part-list button[aria-current="step"]');
  await at("#try-it", 0);
  await expect(current).toHaveText(/Right ventricle/);
  await at("#try-it", 0.5);
  await expect(current).toHaveText(/Lungs/);
  await at("#try-it", 1);
  await expect(current).toHaveText(/Left atrium/);
  // Same for the timeline: one dot at a time, the last one only at the end.
  await at("#how-it-works", 0);
  await expect(page.locator(".trust-steps li.is-reached")).toHaveCount(1);
  await at("#how-it-works", 1);
  await expect(page.locator(".trust-steps li.is-reached")).toHaveCount(4);
});

test("the scanning beam belongs to the chapter that is reading labels", async ({ page }) => {
  await page.goto("/");
  const beam = async (through: number) =>
    page.evaluate(
      (through) => {
        const el = document.querySelector(".diagram-story") as HTMLElement;
        const top = el.getBoundingClientRect().top + scrollY;
        scrollTo(0, Math.round(top + (el.offsetHeight - innerHeight) * (through / 7)));
        return new Promise<{ opacity: string; structure: boolean }>((resolve) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() =>
              resolve({
                opacity: getComputedStyle(document.querySelector(".scan-bar")!).opacity,
                structure: !!document.querySelector(".structure")?.classList.contains("is-on"),
              }),
            ),
          ),
        );
      },
      through,
    );
  // It sweeps while the labels are being read...
  const reading = await beam(1.3);
  expect(Number(reading.opacity)).toBeGreaterThan(0.5);
  expect(reading.structure).toBe(false);
  // ...and is gone once the proposed structure is on the diagram.
  const mapped = await beam(1.8);
  expect(mapped.structure).toBe(true);
  expect(Number(mapped.opacity)).toBe(0);
});

test("guided demo, flow navigation and live captions with a misheard term", async ({
  page,
  playwright,
}) => {
  await teacherLogin(page);
  await page.request.post("/api/demo/reset");
  await page.reload();
  await page.getByRole("button", { name: "Teacher workspace", exact: true }).click();
  await page.getByText("Guided 3-minute demo", { exact: true }).click();
  await page.getByRole("button", { name: "Start guided demo" }).click();
  await expect(
    page.getByRole("heading", { name: "Demo · A journey through the heart", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".demo-steps li[data-status=done]")).toHaveCount(2);
  await scan(page, "demo-guide");

  // Real repair, decisions and publish on the demo lesson.
  const state = await (await page.request.get("/api/demo/state")).json();
  let lesson = (await (await page.request.get(`/api/lessons/${state.lessonId}`)).json()) as Lesson;
  lesson.map.relations[1].evidence = ["label-1", "label-2"];
  lesson = (await (
    await page.request.put(`/api/lessons/${lesson.id}/map`, { data: { revision: lesson.revision, map: lesson.map } })
  ).json()) as Lesson;
  for (const item of [...lesson.map.parts, ...lesson.map.relations, ...lesson.map.flows])
    lesson = (await (
      await page.request.post(`/api/lessons/${lesson.id}/decision`, {
        data: { revision: lesson.revision, itemId: item.id, decision: "approve", note: "Checked for the demo test." },
      })
    ).json()) as Lesson;
  expect((await page.request.post(`/api/lessons/${lesson.id}/publish`, { data: { revision: lesson.revision } })).ok()).toBe(true);
  await expect(page.locator('.demo-steps li[data-status=done]').filter({ hasText: "immutable version" })).toBeVisible({ timeout: 10000 });

  await page.reload();
  await page.getByRole("button", { name: "Teacher workspace", exact: true }).click();
  await page.locator(".lesson-links button").filter({ hasText: "Demo · A journey through the heart" }).first().click();
  await page.getByRole("button", { name: "Open student lesson" }).click();
  await page.getByRole("button", { name: "Next in flow: Pulmonary artery" }).click();
  await expect(page.getByRole("heading", { name: "Pulmonary artery", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Previous in flow: Right ventricle" })).toBeEnabled();

  await page.getByRole("button", { name: "Captions", exact: true }).click();
  await page.getByRole("button", { name: "Play sample lecture" }).click();
  await expect(page.getByText("Heard “pulmonary artary”")).toBeVisible({ timeout: 20000 });
  await expect(page.locator(".live-lines article")).toHaveCount(4, { timeout: 20000 });
  await page.locator(".live-lines .term").filter({ hasText: "pulmonary artary" }).click();
  await expect(page.locator(".glossary-panel h2")).toHaveText("Pulmonary artery");
  await scan(page, "live-captions");
  await page.getByPlaceholder("Search a word or concept").fill("oxygen");
  await expect(page.locator(".live-lines article")).toHaveCount(1);

  const sessions = await (await page.request.get(`/api/caption-sessions?lessonId=${lesson.id}`)).json();
  const sessionId = sessions.at(-1).id;
  const exported = await (await page.request.get(`/api/caption-sessions/${sessionId}/export`)).text();
  expect(exported).toContain("pulmonary artary toward the lungs");
  expect(exported).toContain("- Pulmonary artery:");
  const byTerm = await (await page.request.get(`/api/caption-sessions/${sessionId}/search?termId=part-1`)).json();
  expect(byTerm).toHaveLength(1);
  expect((await page.request.post(`/api/caption-sessions/${sessionId}/credentials`)).status()).toBe(503);

  const student = await playwright.request.newContext({ baseURL: "http://127.0.0.1:5174" });
  await student.post("/api/session", { data: { role: "student" } });
  expect((await student.get(`/api/caption-sessions/${sessionId}`)).ok()).toBe(true);
  expect(
    (await student.post(`/api/caption-sessions/${sessionId}/segments`, { data: { text: "Forged", isFinal: true } })).status(),
  ).toBe(403);
  expect((await student.post("/api/demo/start")).status()).toBe(403);
  await student.dispose();

  await page.getByRole("button", { name: "End caption session" }).click();
  await expect(page.locator(".live-captions .panel-heading")).toContainText("Ended");
  const after = await (await page.request.get("/api/demo/state")).json();
  expect(after.steps.find((s: { id: string }) => s.id === "captions").status).toBe("done");
});

test("one login and one logout cover both the classroom API and the v1 backend", async ({ playwright }) => {
  const base = { baseURL: "http://127.0.0.1:5174" };
  // Log in through the v1 backend, then use a classroom route.
  const v1 = await playwright.request.newContext(base);
  expect((await v1.post("/api/v1/session", { data: { role: "teacher", password: "e2e-teacher" } })).ok()).toBe(true);
  expect((await v1.get("/api/lessons")).ok()).toBe(true);
  expect((await v1.get("/api/v1/lessons")).ok()).toBe(true);
  expect((await v1.post("/api/v1/session", { data: { role: "teacher", password: "wrong" } })).status()).toBe(403);
  await v1.delete("/api/v1/session");
  expect((await v1.get("/api/session")).status()).toBe(401);
  expect((await v1.get("/api/v1/lessons")).status()).toBe(401);
  await v1.dispose();

  // Log in through the classroom route, then use a v1 route.
  const legacy = await playwright.request.newContext(base);
  expect((await legacy.post("/api/session", { data: { role: "teacher", password: "e2e-teacher" } })).ok()).toBe(true);
  expect((await legacy.get("/api/v1/lessons")).ok()).toBe(true);
  await legacy.delete("/api/session");
  expect((await legacy.get("/api/v1/lessons")).status()).toBe(401);
  expect((await legacy.get("/api/lessons")).status()).toBe(401);
  await legacy.dispose();

  // Students cannot use teacher-only v1 routes.
  const student = await playwright.request.newContext(base);
  await student.post("/api/session", { data: { role: "student" } });
  expect((await student.post("/api/v1/lessons", { data: { title: "Nope" } })).status()).toBe(403);
  await student.dispose();
});

test("AI helper pages work for students, explain clearly when AI is off, and load subtitles offline", async ({ page }) => {
  // A logged-out visitor picks "Explain a diagram" and is taken straight there:
  // only "Open classroom" asks who you are.
  await page.goto("/");
  await page.getByRole("button", { name: "Explain a diagram" }).click();
  await expect(page.getByRole("heading", { name: "Explain any diagram." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Enter classroom" })).toHaveCount(0);
  const picker = page.locator(".ai-upload input[type=file]");
  await expect(picker).toBeEnabled();
  await picker.setInputFiles("docs/samples/heart-flow-test.png");
  await page.getByRole("button", { name: "Open in diagram explorer" }).click();
  // Browser tests never call Gemini, so the page must say what to do.
  await expect(page.getByRole("alert")).toContainText("AI help is not configured");
  await scan(page, "explain-diagram");

  await page.getByRole("button", { name: "Watch & listen" }).click();
  await page.locator(".ai-upload input[type=file]").first().setInputFiles("docs/samples/heart-lecture-test.wav");
  const vtt = "WEBVTT\n\n00:00.000 --> 00:02.900\nBlood leaves the right ventricle.\n\n00:03.400 --> 00:07.400\nIt travels to the lungs.\n";
  await page.getByLabel("Or load subtitles (.vtt or .srt), free and instant").setInputFiles({ name: "lecture.vtt", mimeType: "text/vtt", buffer: Buffer.from(vtt) });
  await expect(page.locator(".transcript-list li")).toHaveCount(2);
  await page.locator(".transcript-list button").nth(1).click();
  await expect(page.locator(".caption-now")).toContainText("It travels to the lungs.");
  await scan(page, "watch-listen");
});

test("teacher can choose a diagram file without filling the form first", async ({ page }) => {
  await teacherLogin(page);
  const details = page.locator(".upload-panel");
  if (!(await details.getAttribute("open"))) await page.getByText("Upload your diagram", { exact: true }).click();
  await expect(page.locator(".upload-panel input[type=file]")).toBeEnabled();
  await expect(page.getByText("You can upload now. Add the license before publishing to students.")).toBeVisible();
});
