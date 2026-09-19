import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createPrivateKey, sign } from "node:crypto";
import { join } from "node:path";
import { RUN_DIR } from "../../playwright.config";

test("a standard Supabase JWT creates a real classroom session and profile", async ({ request }) => {
  const key = createPrivateKey(await readFile(join(RUN_DIR, "test-signing-key.pem")));
  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: "e2e-key", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    sub: "e2e-member", email: "member@example.com", role: "authenticated",
    iss: "https://e2e-project.supabase.co/auth/v1", aud: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString("base64url");
  const signed = `${header}.${payload}`;
  const signature = sign("sha256", Buffer.from(signed), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  const headers = { Authorization: `Bearer ${signed}.${signature}` };
  const response = await request.post("/api/session", { headers, data: {} });
  expect(response.ok(), await response.text()).toBe(true);
  expect(await response.json()).toMatchObject({ role: "student", user: { role: "USER", supabaseUserId: "e2e-member" } });
  expect(await (await request.get("/api/session")).json()).toMatchObject({ needsRoleSelection: true });
  expect(await (await request.post("/api/session", { headers, data: { role: "teacher" } })).json()).toMatchObject({ role: "teacher", needsRoleSelection: false });
  expect(await (await request.get("/api/session")).json()).toMatchObject({ role: "teacher", needsRoleSelection: false });
  expect(await (await request.get("/api/v1/me", { headers })).json()).toMatchObject({ user: { role: "TEACHER" } });
  expect((await request.post("/api/session", { headers, data: { role: "ADMIN" } })).status()).toBe(400);
  expect(await (await request.post("/api/session", { headers, data: { role: "student" } })).json()).toMatchObject({ role: "student", needsRoleSelection: false });
  expect(await (await request.get("/api/v1/me", { headers })).json()).toMatchObject({ kind: "app", user: { role: "USER" } });
  expect((await request.delete("/api/session")).ok()).toBe(true);
  expect((await request.get("/api/session")).status()).toBe(401);
  expect((await request.post("/api/session", { headers: { Authorization: "Bearer invalid" }, data: {} })).status()).toBe(401);
});

const user = {
  id: "11111111-1111-4111-8111-111111111111", aud: "authenticated", role: "authenticated",
  email: "learner@example.com", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString(),
};

test("restored landing keeps authentication accessible through the menu", async ({ page }) => {
  await page.route("**/auth/v1/settings", (route) => route.fulfill({ json: { external: { google: false } } }));
  await page.goto("/");
  await expect(page.locator(".hero-auth")).toHaveCount(0);
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("button", { name: /Sign in \/ Sign up/ }).click();
  await expect(page.getByRole("form", { name: "Sign in", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.locator(".google-signin").getByRole("alert")).toContainText("Please use email sign-in");
  await page.getByRole("button", { name: "New here? Create an account" }).click();
  await expect(page.getByRole("form", { name: "Sign up", exact: true })).toBeVisible();
});
test("Google button requests OAuth with an application callback", async ({ page }) => {
  await page.route("**/auth/v1/settings", (route) => route.fulfill({ json: { external: { google: true } } }));
  await page.route("**/auth/v1/authorize?**", (route) => route.fulfill({ contentType: "text/html", body: "<h1>Google authorization</h1>" }));
  await page.goto("/#/account");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page).toHaveURL(/provider=google/);
  expect(new URL(page.url()).searchParams.get("redirect_to")).toBe("http://127.0.0.1:5174/?auth=callback");
});

async function mockIdentity(page: Page, confirmEmail = false, failBridge = false) {
  let signedIn = false;
  const session = { role: "student", code: "ABC123", needsRoleSelection: true };
  await page.route("**/test-auth/auth/v1/**", async (route) => {
    const signup = route.request().url().includes("/signup");
    await route.fulfill({ json: signup && confirmEmail ? { user, session: null } : {
      access_token: "test-token", refresh_token: "test-refresh", token_type: "bearer",
      expires_in: 3600, user,
    } });
  });
  await page.route("**/api/session", async (route) => {
    const method = route.request().method();
    if (method === "POST") {
      expect(route.request().headers().authorization).toBe("Bearer test-token");
      const choice = route.request().postDataJSON();
      session.role = choice.role ?? "student";
      session.needsRoleSelection = !choice.role;
      if (failBridge) {
        await route.fulfill({ status: 503, json: { error: "Classroom temporarily unavailable." } });
        return;
      }
      signedIn = true;
    }
    if (method === "DELETE") signedIn = false;
    await route.fulfill({ status: signedIn ? 200 : 401, json: signedIn ? session : { error: "Sign in first." } });
  });
  await page.route("**/api/published", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/lessons", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/v1/me", (route) => route.fulfill({ json: {
    kind: "app", supabaseConfigured: true, user: {
      id: "member-1", supabaseUserId: user.id, email: user.email, name: "Learner",
      role: session.role === "teacher" ? "TEACHER" : "USER", createdAt: user.created_at, updatedAt: user.created_at,
    },
  } }));
}

async function fillAccount(page: Page) {
  await page.goto("/#/account");
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill("test-password");
}

test("email sign-in opens the dashboard, preserves navigation and shows the correct role", async ({ page }) => {
  await mockIdentity(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("button", { name: /Sign in \/ Sign up/ }).click();
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/#\/choose-role$/);
  await expect(page.getByRole("button", { name: "Continue to dashboard" })).toBeDisabled();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Choose your role" })).toBeVisible();
  await page.getByRole("radio", { name: /I'm a student/ }).check();
  await page.getByRole("button", { name: "Continue to dashboard" }).click();
  await expect(page).toHaveURL(/#\/explore$/);
  await expect(page.locator(".workspace")).toBeVisible();
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await expect(page.locator(".local-note")).toContainText("as user");
  await expect(page.locator(".local-note")).not.toContainText("as teacher");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Learner", exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/#\/explore$/);
  await expect(page.locator(".workspace")).toBeVisible();
  await page.goto("/?auth=callback");
  await expect(page.getByRole("heading", { name: "Choose your role" })).toBeVisible();
  await page.getByRole("radio", { name: /I'm a student/ }).check();
  await page.getByRole("button", { name: "Continue to dashboard" }).click();
  await expect(page).toHaveURL("http://127.0.0.1:5174/#/explore");
});

test("sign-up with an immediate session opens the classroom", async ({ page }) => {
  await mockIdentity(page);
  await fillAccount(page);
  await page.getByRole("button", { name: "New here? Create an account" }).click();
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Choose your role" })).toBeVisible();
  await page.getByRole("radio", { name: /I'm a teacher/ }).check();
  await page.getByRole("button", { name: "Continue to dashboard" }).click();
  await expect(page).toHaveURL(/#\/teacher$/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Make the lesson open to everyone." })).toBeVisible();
});

test("sign-up requiring confirmation stays on the form with email instructions", async ({ page }) => {
  await mockIdentity(page, true);
  await fillAccount(page);
  await page.getByRole("button", { name: "New here? Create an account" }).click();
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByText("Account created. Check your email to confirm, then sign in.")).toBeVisible();
  await expect(page).toHaveURL(/#\/account$/);
});

test("classroom errors after authentication stay recoverable on the sign-in form", async ({ page }) => {
  await mockIdentity(page, false, true);
  await fillAccount(page);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("#account-auth-error")).toHaveText("Classroom temporarily unavailable.");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
});

test("dashboard and navbar animate, and unpinning after a mouse click hides the bar", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Pin the navigation bar" }).click();
  await page.evaluate(() => scrollTo(0, 900));
  await page.getByRole("button", { name: "Unpin the navigation bar" }).click();
  await expect(page.locator(".site-header")).toHaveClass(/is-hidden/);
  await page.evaluate(() => scrollTo(0, 0));
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await expect(page.locator(".nav-menu")).toHaveCSS("animation-name", "menu-in");
  await page.getByRole("button", { name: /Open classroom/ }).click();
  await page.request.post("/api/session", { data: { role: "teacher", password: "e2e-teacher" } });
  await page.goto("about:blank");
  await page.goto("/#/teacher");
  await expect(page.locator(".workspace > .page-heading")).toHaveCSS("animation-name", "mo-enter");
  await expect(page).toHaveURL(/#\/teacher$/);
  await page.reload();
  await expect(page.locator(".workspace > .page-heading")).toBeVisible();
  await expect(page.locator(".site-header")).toHaveClass(/is-plain/);
});
