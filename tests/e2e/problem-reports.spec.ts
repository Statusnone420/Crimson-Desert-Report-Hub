import { expect, test, type Page } from "@playwright/test";
import { collectConsoleProblems, expectHealthyPage, signInAsAdmin } from "./helpers";

const fixture = `http://127.0.0.1:${process.env.PLAYWRIGHT_SUPABASE_PORT ?? 18765}`;
const installCaptcha = async (page: Page) => {
  await page.route("https://challenges.cloudflare.com/**", async (route) => {
    if (!route.request().url().includes("/api.js")) { await route.abort(); return; }
    await route.fulfill({ contentType: "application/javascript", body: `window.turnstile = {
      render(element, options) { const id = crypto.randomUUID(); const input = document.createElement('input'); input.type='hidden'; input.dataset.widget=id; element.append(input); options.callback?.('stub-problem-'+id); return id; },
      remove(id) { document.querySelector('[data-widget="'+id+'"]')?.remove(); }
    };` });
  });
};
test.beforeAll(async ({ request }) => {
  test.setTimeout(180_000);
  // Compile the protected boundaries without writes before timed UI assertions.
  // The shared development server builds new route handlers on first request.
  expect((await request.get("/api/problem-reports")).status()).toBe(405);
  expect((await request.get("/api/admin/problem-reports")).status()).toBe(401);
  expect((await request.get("/api/admin/problem-reports/10000000-0000-4000-8000-000000000001")).status()).toBe(401);
  await request.get("/admin/problem-reports");
  await request.get("/operator?view=problem-reports");
});
test.beforeEach(async ({ request }) => { expect((await request.post(`${fixture}/__test__/reset-problem-reports`)).ok()).toBe(true); });
test.afterEach(async ({ request }) => { expect((await request.post(`${fixture}/__test__/reset-problem-reports`)).ok()).toBe(true); });

test("the global problem form captures the current path, traps focus, and closes with Escape", async ({ page }, testInfo) => {
  test.slow();
  const problems = collectConsoleProblems(page);
  await installCaptcha(page);
  for (const route of ["/", "/contact", "/privacy", "/news", "/issues", "/admin/login"]) {
    await page.goto(route);
    await expect(page.getByRole("button", { name: "Report a problem", exact: true })).toBeVisible();
  }
  // At the end of a page, the fixed shortcut must leave the last footer line uncovered.
  await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
  const shortcut = await page.getByRole("button", { name: "Report a problem", exact: true }).boundingBox();
  const footerEnd = await page.locator(".np-footer").evaluate((footer) => footer.lastElementChild!.getBoundingClientRect().bottom);
  expect(footerEnd).toBeLessThanOrEqual(shortcut!.y);
  await page.goto("/news?private=hidden#secret");
  if (testInfo.project.name === "mobile-chromium") await page.setViewportSize({ width: 320, height: 844 });
  await page.getByRole("button", { name: "Report a problem", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Report a problem" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/Page: http:\/\/127.0.0.1:\d+\/news/);
  await expect(dialog).not.toContainText("private=hidden");
  await expect(dialog).not.toContainText("#secret");
  await dialog.getByLabel("Type", { exact: true }).selectOption("remove_content");
  await expect(dialog.getByLabel("Email (required for creator verification)", { exact: true })).toHaveAttribute("required", "");
  const touchTargets = await dialog.locator("button, select, input:not([type=hidden])").evaluateAll((elements) => elements.map((element) => Math.round(element.getBoundingClientRect().height)));
  expect(touchTargets.every((height) => height >= 44)).toBe(true);
  if (testInfo.project.name === "mobile-chromium") {
    await page.setViewportSize({ width: 640, height: 360 });
    await dialog.getByLabel("Email (required for creator verification)", { exact: true }).focus();
    await expect(dialog.getByRole("button", { name: "Close problem report", exact: true })).toBeInViewport();
    await expect(dialog.getByRole("button", { name: "Send private report", exact: true })).toBeInViewport();
    await expect(dialog.getByLabel("Email (required for creator verification)", { exact: true })).toBeInViewport();
    await page.setViewportSize({ width: 320, height: 844 });
  }
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await expectHealthyPage(page, problems);
  await page.screenshot({ path: `output/playwright/problem-report-${testInfo.project.name}.png` });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Report a problem", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Switch to dark mode", exact: true }).click();
  await page.getByRole("button", { name: "Report a problem", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS("background-color", "rgb(0, 0, 0)");
  await page.screenshot({ path: `output/playwright/problem-report-dark-${testInfo.project.name}.png` });
  await page.keyboard.press("Escape");
});

test("a report stays private, enters the authenticated inbox, and changes only its queue status", async ({ page }, testInfo) => {
  test.slow();
  await installCaptcha(page);
  await page.goto("/watch?email=private#fragment");
  await page.getByRole("button", { name: "Report a problem", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Report a problem" });
  await dialog.getByLabel("Type", { exact: true }).selectOption("remove_content");
  await dialog.getByLabel("What needs attention?", { exact: true }).fill("Please review my creator video. Private fixture description.");
  await dialog.getByLabel("Email (required for creator verification)", { exact: true }).fill("creator-private@example.test");
  const submitted = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/problem-reports" && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "Send private report", exact: true }).click();
  const saved = await submitted;
  expect(saved.status()).toBe(201);
  await expect(dialog.getByRole("status")).toContainText("Report saved privately for review.");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  // The fixture's Siteverify accepts reuse, as the real one did. The database
  // must still refuse the used token from other networks, sent at once.
  const baseURL = new URL(page.url()).origin;
  const network = (offset: number) => `198.51.100.${(testInfo.project.name === "mobile-chromium" ? 50 : 30) + offset}`;
  const send = (ip: string, data: Record<string, unknown>) => page.request.post("/api/problem-reports", { headers: { origin: baseURL, "x-forwarded-for": ip }, data });
  const replays = await Promise.all([1, 2, 3].map((offset) => send(network(offset), saved.request().postDataJSON())));
  for (const replay of replays) {
    expect(replay.status()).toBe(400);
    expect(await replay.json()).toEqual({ error: "captcha_failed" });
  }
  expect((await page.request.get("/api/admin/problem-reports")).status()).toBe(401);
  for (const route of ["/watch", "/news", "/issues", "/feed.xml", "/rss.xml", "/sitemap.xml"]) {
    const response = await page.request.get(route);
    expect(await response.text()).not.toMatch(/creator-private@example\.test|Private fixture description/);
  }
  await signInAsAdmin(page);
  const queue = await (await page.request.get("/api/admin/problem-reports")).json();
  expect(queue.reports).toHaveLength(1);
  const report = queue.reports[0];
  expect(report).toMatchObject({ status: "new", revision: 0, email: "creator-private@example.test" });
  expect(report.page_url).toMatch(/\/watch$/);
  expect(report).not.toHaveProperty("ip_hash");
  await page.goto("/operator?view=problem-reports");
  await expect(page.getByRole("heading", { name: "Reports inbox", exact: true })).toBeVisible();
  if (testInfo.project.name === "mobile-chromium") {
    await page.setViewportSize({ width: 320, height: 844 });
    const menu = page.getByRole("button", { name: "Workspace menu", exact: true });
    const navigation = page.getByRole("navigation", { name: "Operator", exact: true });
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expect(navigation).not.toBeVisible();
    await menu.click();
    await expect(navigation.getByRole("link", { name: "Reports inbox", exact: true })).toBeVisible();
    await navigation.getByRole("link", { name: "Overview", exact: true }).focus();
    await page.keyboard.press("Escape");
    await expect(navigation).not.toBeVisible();
    await expect(menu).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  const row = page.locator(`[data-report-id="${report.id}"]`);
  await row.locator("summary").click();
  await expect(row).toContainText("Private fixture description.");
  await row.getByLabel("Status", { exact: true }).selectOption("approved");
  await row.getByLabel("Add a private note (optional)", { exact: true }).fill("Creator control verified; content change needs separate approval.");
  const reviewed = page.waitForResponse((response) => response.url().endsWith(`/api/admin/problem-reports/${report.id}`) && response.request().method() === "PATCH");
  await row.getByRole("button", { name: "Save review", exact: true }).click();
  expect((await reviewed).status()).toBe(200);
  await expect(row.getByRole("status")).toContainText("Private review saved. No content was changed.");
  await page.screenshot({ path: `output/playwright/problem-inbox-${testInfo.project.name}.png` });
  const updated = await (await page.request.get(`/api/admin/problem-reports/${report.id}`)).json();
  expect(updated.report).toMatchObject({ status: "approved", revision: 1, private_notes: [{ text: "Creator control verified; content change needs separate approval." }] });
  const conflict = await page.request.patch(`/api/admin/problem-reports/${report.id}`, { headers: { origin: baseURL }, data: { revision: 0, status: "dismissed" } });
  expect(conflict.status()).toBe(409);
  await page.goto("/contact");
  await page.getByRole("button", { name: "Report a problem", exact: true }).click();
  await dialog.getByLabel("What needs attention?", { exact: true }).fill("A second report from the same network.");
  const limited = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/problem-reports" && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "Send private report", exact: true }).click();
  expect((await limited).status()).toBe(429);
  await expect(dialog.getByRole("alert")).toContainText("last 24 hours");
  await expect(dialog.getByRole("alert")).toBeInViewport();
  // One fresh token sent at once from several new networks saves one report.
  const burstToken = `stub-problem-burst-${testInfo.project.name}`;
  const burst = await Promise.all([4, 5, 6, 7].map((offset) => send(network(offset), { type: "other", description: "Burst fixture report.", page_url: `${baseURL}/contact`, email: "", turnstile_token: burstToken })));
  expect(burst.map((response) => response.status()).sort()).toEqual([201, 400, 400, 400]);
  expect((await (await page.request.get("/api/admin/problem-reports")).json()).reports).toHaveLength(2);
});
