import { expect, test, type Page } from "@playwright/test";
import { choosePlatform, installTurnstile } from "./checkin-helpers";
import { refreshFixtureReads, waitForHydration } from "./helpers";

const MOCK_SUPABASE_ORIGIN = `http://127.0.0.1:${process.env.PLAYWRIGHT_SUPABASE_PORT ?? 18765}`;
const MAP_PAIRING_ID = "00000000-0000-4000-8000-000000000201";

// Check-ins are answers to an official fix claim. The fixture's map claim
// waits for review, so these tests confirm it first and restore it after.
async function checkInCard(page: Page, title = "Map-open crash persists after fix") {
  const card = page.getByRole("article").filter({ hasText: title });
  await expect(async () => {
    await page.goto("/issues");
    await waitForHydration(page);
    await expect(card.getByRole("button", { name: /^Still happening/ })).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  await expect(card).toHaveCount(1);
  return card;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }, testInfo) => {
  const page = await browser.newPage({ baseURL: testInfo.project.use.baseURL });
  try {
    const confirmed = await page.request.post(`${MOCK_SUPABASE_ORIGIN}/rest/v1/rpc/mutate_claim_review_pairing`, {
      data: { p_pairing_id: MAP_PAIRING_ID, p_revision: 1, p_action: "confirm", p_cluster_lifecycle_revision: 1, p_actor: "check-in fixture" },
    });
    expect(confirmed.ok(), "map claim confirmation failed").toBe(true);
    await refreshFixtureReads(page, ["/issues"]);
  } finally {
    await page.close();
  }
});

test.afterAll(async ({ browser }, testInfo) => {
  const page = await browser.newPage({ baseURL: testInfo.project.use.baseURL });
  try {
    expect((await page.request.post(`${MOCK_SUPABASE_ORIGIN}/__test__/reset`)).ok(), "fixture reset failed").toBe(true);
    await refreshFixtureReads(page);
  } finally {
    await page.close();
  }
});

test("check-in choices keep visible borders and 44px targets", async ({ page }) => {
  const card = await checkInCard(page);
  const choices = card.locator(".confirmation-checkin__row .tap-btn");
  await expect(choices).not.toHaveCount(0);
  await expect(card.getByRole("button", { name: /^Still happening/ })).toBeVisible();
  for (const choice of await choices.all()) {
    expect(await choice.evaluate((button) => Number.parseFloat(getComputedStyle(button).borderTopWidth))).toBeGreaterThanOrEqual(1);
    expect((await choice.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }
});

test("the check-in block ends at its buttons, with no empty band below them", async ({ page }) => {
  const card = await checkInCard(page);
  const band = await card.locator(".confirmation-checkin").evaluate((checkin) => {
    const buttons = checkin.querySelectorAll(".confirmation-checkin__row .tap-btn");
    return checkin.getBoundingClientRect().bottom - buttons[buttons.length - 1].getBoundingClientRect().bottom;
  });
  expect(Math.abs(band)).toBeLessThan(1);
});

test("check-in picker focuses the platform and cancel or Escape does not post", async ({ page }) => {
  await installTurnstile(page);
  let posts = 0;
  await page.route("**/api/confirmations", async (route) => { posts += 1; await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true }) }); });
  const card = await checkInCard(page);
  const choice = card.getByRole("button", { name: /^Still happening/ });
  const platform = card.getByRole("button", { name: "PC (Steam)", exact: true });
  await choice.click(); await expect(platform).toBeFocused();
  await card.getByRole("button", { name: "Cancel", exact: true }).click(); await expect(choice).toBeFocused(); expect(posts).toBe(0);
  await choice.focus(); await page.keyboard.press("Enter"); await expect(platform).toBeFocused();
  await page.keyboard.press("Escape"); await expect(choice).toBeFocused(); await expect(platform).toHaveCount(0); expect(posts).toBe(0);
});

test("check-in posts once after an explicit save, carries exact patch/token, and does not invent a count", async ({ page }) => {
  await installTurnstile(page);
  let posts = 0;
  let payload: Record<string, unknown> | null = null;
  let release!: () => void;
  const heldResponse = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/confirmations", async (route) => {
    posts += 1; payload = route.request().postDataJSON() as Record<string, unknown>; await heldResponse;
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  const card = await checkInCard(page);
  const choice = card.getByRole("button", { name: /^Still happening/ });
  const count = choice.locator(".tap-btn__count");
  const before = await count.textContent();
  await choosePlatform(card, /^Still happening/);
  await card.getByRole("button", { name: "Save check-in", exact: true }).click();
  await expect(card.getByText("Recording your answer…", { exact: true })).toBeVisible();
  for (const button of await card.locator(".confirmation-checkin button").all()) await expect(button).toBeDisabled();
  expect(posts).toBe(1);
  expect(payload).toMatchObject({ patch_version: "1.13.01", platform: "pc_steam", kind: "still_happening", turnstile_token: expect.stringMatching(/^stub-token-/) });
  release();
  await expect(card.getByText(/Saved for patch 1\.13\.01\. One answer per network and issue/)).toBeVisible();
  await expect(count).toHaveText(before ?? ""); expect(posts).toBe(1);
});

test("saved totals are visible while the route refresh is stalled, then yield to fresh server data", async ({ page }) => {
  await installTurnstile(page);
  const card = await checkInCard(page);
  const count = card.getByRole("button", { name: /^Fixed for me/ }).locator(".tap-btn__count");
  const verdictFixed = card.locator(".verdict-labels__fixed strong");
  const initialCount = await count.textContent();
  let release!: () => void;
  let refreshStarted!: () => void;
  const heldRefresh = new Promise<void>((resolve) => { release = resolve; });
  const refreshing = new Promise<void>((resolve) => { refreshStarted = resolve; });
  await page.route("**/issues?*", async (route) => {
    if (route.request().headers().rsc === "1") { refreshStarted(); await heldRefresh; }
    await route.continue();
  });
  await page.route("**/api/confirmations", (route) => route.fulfill({
    status: 201, contentType: "application/json",
    body: JSON.stringify({ ok: true, counts: { totalCount: 45, fixed_for_me: 42, still_happening: 3 } }),
  }));
  try {
    await choosePlatform(card, /^Fixed for me/);
    await card.getByRole("button", { name: "Save check-in", exact: true }).click();
    await refreshing;
    await expect(card.getByText(/Saved for patch 1\.13\.01/)).toBeVisible();
    await expect(count).toHaveText("42");
    await expect(verdictFixed).toHaveText("42");
    await expect(card.getByText("Platform breakdown awaits refresh.", { exact: true })).toBeVisible();
    await expect(card.locator(".dispatch-platform-record")).toHaveCount(0);
    release();
    await expect(count).toHaveText(initialCount ?? "");
    await expect(verdictFixed).not.toHaveText("42");
    await expect(card.getByText("Platform breakdown awaits refresh.", { exact: true })).toHaveCount(0);
  } finally {
    release();
  }
});

test("a previous refresh cannot discard the next saved receipt", async ({ page }) => {
  await installTurnstile(page);
  const card = await checkInCard(page);
  let releaseFirst!: () => void;
  let releaseSecond!: () => void;
  let releasePost!: () => void;
  let firstStarted!: () => void;
  let secondStarted!: () => void;
  const firstRefresh = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const secondRefresh = new Promise<void>((resolve) => { releaseSecond = resolve; });
  const secondPost = new Promise<void>((resolve) => { releasePost = resolve; });
  const firstRequest = new Promise<void>((resolve) => { firstStarted = resolve; });
  const secondRequest = new Promise<void>((resolve) => { secondStarted = resolve; });
  let refreshes = 0;
  let posts = 0;
  await page.route("**/issues?*", async (route) => {
    if (route.request().headers().rsc === "1") {
      if (++refreshes === 1) { firstStarted(); await firstRefresh; }
      else { secondStarted(); await secondRefresh; }
    }
    await route.continue();
  });
  await page.route("**/api/confirmations", async (route) => {
    const first = ++posts === 1;
    if (!first) await secondPost;
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, counts: {
      totalCount: 45, fixed_for_me: first ? 42 : 41, still_happening: first ? 3 : 4,
    } }) });
  });
  try {
    await choosePlatform(card, /^Fixed for me/);
    await card.getByRole("button", { name: "Save check-in", exact: true }).click();
    await firstRequest;
    await expect(card.getByRole("button", { name: /^Fixed for me/ }).locator(".tap-btn__count")).toHaveText("42");
    await choosePlatform(card, /^Still happening/);
    await card.getByRole("button", { name: "Save check-in", exact: true }).click();
    await expect(card.getByText("Recording your answer…", { exact: true })).toBeVisible();
    releaseFirst();
    await expect(card.getByRole("button", { name: /^Fixed for me/ }).locator(".tap-btn__count")).not.toHaveText("42");
    releasePost();
    await secondRequest;
    await expect(card.getByRole("button", { name: /^Still happening/ }).locator(".tap-btn__count")).toHaveText("4");
    await expect(card.locator(".verdict-labels__still strong")).toHaveText("4");
  } finally {
    releaseFirst(); releaseSecond(); releasePost();
  }
});

test("bot expiry and errors prevent a write until a new challenge response arrives", async ({ page }) => {
  await installTurnstile(page);
  let posts = 0;
  await page.route("**/api/confirmations", async (route) => { posts += 1; await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true }) }); });
  const card = await checkInCard(page);
  await choosePlatform(card, /^Fixed for me/);
  const save = card.getByRole("button", { name: "Save check-in", exact: true });
  await page.evaluate(() => (window as unknown as { __checkinTurnstile: { expireLatest: () => void } }).__checkinTurnstile.expireLatest());
  await expect(save).toBeDisabled(); expect(posts).toBe(0);
  await page.evaluate(() => (window as unknown as { __checkinTurnstile: { errorLatest: () => void } }).__checkinTurnstile.errorLatest());
  await expect(card.getByRole("alert")).toContainText("The bot check could not load"); expect(posts).toBe(0);
});

test("preview refusal keeps the selected platform flow available for retry", async ({ page }) => {
  await installTurnstile(page);
  let posts = 0;
  await page.route("**/api/confirmations", async (route) => { posts += 1; await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "preview_writes_disabled" }) }); });
  const card = await checkInCard(page);
  await choosePlatform(card, /^Fixed for me/); await card.getByRole("button", { name: "Save check-in", exact: true }).click();
  await expect(card.getByText("This preview is read-only. Check-ins work on the production site.")).toBeVisible();
  await expect(card.getByRole("button", { name: "PC (Steam)", exact: true })).toBeEnabled(); expect(posts).toBe(1);
});

test("a confirmed save after leaving the card updates the stance without restoring its flow", async ({ page }) => {
  await installTurnstile(page);
  let release!: () => void;
  const heldResponse = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/confirmations", async (route) => { await heldResponse; await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true }) }); });
  const card = await checkInCard(page);
  const response = page.waitForResponse((candidate) => candidate.url().endsWith("/api/confirmations") && candidate.request().method() === "POST");
  await choosePlatform(card, /^Fixed for me/); await card.getByRole("button", { name: "Save check-in", exact: true }).click();
  await expect(card.getByText("Recording your answer…", { exact: true })).toBeVisible();
  const boardViews = page.getByRole("group", { name: "Choose board view" });
  await boardViews.getByRole("button", { name: /Watchlist/ }).click(); await expect(card).toHaveCount(0); release(); await response;
  await boardViews.getByRole("button", { name: /Published issues/ }).click();
  const replacement = page.getByRole("article").filter({ hasText: "Map-open crash persists after fix" });
  await expect(replacement).toHaveCount(1); await expect(replacement.getByText(/Saved for patch 1\.13\.01/)).toHaveCount(0);
  await expect(replacement.getByText("Recording your answer…", { exact: true })).toHaveCount(0);
  await expect(replacement.getByRole("button", { name: /^Fixed for me/ })).toHaveAttribute("aria-pressed", "true");
});
