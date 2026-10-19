import { expect, test } from "@playwright/test";
import { collectConsoleProblems, expectHealthyPage, refreshFixtureReads, signInAsAdmin } from "./helpers";

const MOCK_ORIGIN = `http://127.0.0.1:${process.env.PLAYWRIGHT_SUPABASE_PORT ?? 18765}`;
const PUBLISHED = "/editorials/clear-skies-over-the-inventory-screen";
const WAITING = "/editorials/scattered-softlocks-in-the-north";

test.afterEach(async ({ page }) => {
  expect((await page.request.post(`${MOCK_ORIGIN}/__test__/reset`)).ok()).toBe(true);
  await refreshFixtureReads(page, [PUBLISHED, "/feed.xml"]);
});

test("a published edition reads cleanly on desktop and at 320px, and a waiting one stays hidden", async ({ page, request }) => {
  const problems = collectConsoleProblems(page);
  await page.goto(PUBLISHED);
  await expect(page.getByRole("heading", { level: 1, name: "Clear skies over the inventory screen" })).toBeVisible();
  await expect(page.getByText("The Hub Desk · State of the Game")).toBeVisible();
  await expect(page.getByText("By Statusnone")).toBeVisible();
  await expect(page.getByText("Edited by")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "What's actually true" })).toBeVisible();
  const schema = JSON.parse(await page.locator('script[type="application/ld+json"]').innerText());
  expect(schema).toMatchObject({ "@type": "NewsArticle", author: { "@type": "Person", name: "Statusnone" } });
  expect(schema).not.toHaveProperty("editor");
  await expectHealthyPage(page, problems);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.setViewportSize({ width: 1440, height: 1100 });

  expect((await request.get(WAITING)).status()).toBe(404);
  for (const route of ["/feed.xml", "/rss.xml", "/sitemap.xml"]) {
    const text = await (await request.get(route)).text();
    expect(text).toContain(PUBLISHED);
    expect(text).not.toContain(WAITING);
    expect(text.toLowerCase()).not.toMatch(/claude|opus|sonnet|anthropic|openrouter/);
  }
});

test("the Column card approves, vetoes and pauses without touching anything else", async ({ page, request }) => {
  await signInAsAdmin(page);
  await page.goto("/operator?view=column");
  await expect(page.getByRole("heading", { level: 1, name: "Column" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Running" })).toBeVisible();
  await expect(page.getByText("Approve-first: 3 editions left.")).toBeVisible();
  await expect(page.getByText("Skipped: Not enough news")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Schedule and writer" })).toBeVisible();
  await expect(page.getByText("Its key is missing, so each slot skips as provider unavailable and nothing is called.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Voice examples" })).toBeVisible();
  await expect(page.getByText("10 of 10 left today (UTC)", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Approve and publish" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Edition approved and published." })).toBeVisible();
  await expect(page.getByText("Approve-first: 2 editions left.")).toBeVisible();
  await refreshFixtureReads(page, [WAITING]);
  expect((await request.get(WAITING)).status()).toBe(200);

  await page.getByRole("row", { name: /Scattered softlocks in the north/ }).getByRole("button", { name: "Unpublish" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Edition vetoed." })).toBeVisible();
  // The dev server recomputes cached reads only for no-cache requests; the unit tests cover the revalidation calls.
  await refreshFixtureReads(page, ["/feed.xml"]);
  expect((await request.get(WAITING, { headers: { "cache-control": "no-cache" } })).status()).toBe(404);

  await page.getByRole("button", { name: "Pause the column" }).click();
  await expect(page.getByRole("heading", { name: "Paused" })).toBeVisible();
  const settings = await (await request.get(`${MOCK_ORIGIN}/rest/v1/automation_settings?key=eq.scanner`)).json();
  expect(settings.find((row: { key: string }) => row.key === "scanner").value).toEqual({ paused: false });
});
