import { expect, test, type Locator, type Page } from "@playwright/test";

const TURNSTILE_STUB = String.raw`
(() => {
  const state = window.__checkinTurnstile = { renders: [], widgets: new Map() };
  window.turnstile = {
    render(element, options) {
      const id = 'checkin-widget-' + (state.renders.length + 1);
      const input = document.createElement('input');
      input.type = 'hidden'; input.name = 'cf-turnstile-response'; input.value = 'stub-token-' + id; input.dataset.stubWidget = id;
      element.append(input); state.renders.push({ id, options }); state.widgets.set(id, input); options.callback?.(input.value);
      return id;
    },
    remove(id) { state.widgets.get(id)?.remove(); state.widgets.delete(id); },
  };
  state.expireLatest = () => state.renders.at(-1)?.options['expired-callback']?.();
  state.errorLatest = () => state.renders.at(-1)?.options['error-callback']?.();
})();`;

async function installTurnstile(page: Page) {
  await page.addInitScript(TURNSTILE_STUB);
  await page.route("https://challenges.cloudflare.com/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/turnstile/v0/api.js") await route.fulfill({ contentType: "application/javascript", body: "" });
    else await route.abort();
  });
}

async function checkInCard(page: Page, title = "FPS regression since 1.13") {
  await page.goto("/issues");
  const card = page.getByRole("article").filter({ hasText: title });
  await expect(card).toHaveCount(1);
  return card;
}

async function choosePlatform(card: Locator, kind: RegExp | string) {
  await card.getByRole("button", { name: kind }).click();
  await card.getByRole("button", { name: "PC (Steam)", exact: true }).click();
  await expect(card.locator('.turnstile-widget input[name="cf-turnstile-response"]')).toHaveCount(1);
  await expect(card.getByRole("button", { name: "Save check-in", exact: true })).toBeEnabled();
}

test("check-in choices keep visible borders and 44px targets", async ({ page }) => {
  const card = await checkInCard(page);
  const choices = card.locator(".confirmation-checkin__row .tap-btn");
  await expect(choices).not.toHaveCount(0);
  await expect(card.getByRole("button", { name: /Not happening for me/ })).toBeVisible();
  for (const choice of await choices.all()) {
    expect(await choice.evaluate((button) => Number.parseFloat(getComputedStyle(button).borderTopWidth))).toBeGreaterThanOrEqual(1);
    expect((await choice.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }
});

test("check-in picker focuses the platform and cancel or Escape does not post", async ({ page }) => {
  await installTurnstile(page);
  let posts = 0;
  await page.route("**/api/confirmations", async (route) => { posts += 1; await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true }) }); });
  const card = await checkInCard(page);
  const choice = card.getByRole("button", { name: /Not happening for me/ });
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
  const choice = card.getByRole("button", { name: /Not happening for me/ });
  const count = choice.locator(".tap-btn__count");
  const before = await count.textContent();
  await choosePlatform(card, "Not happening for me");
  await card.getByRole("button", { name: "Save check-in", exact: true }).click();
  await expect(card.getByText("Recording your answer…", { exact: true })).toBeVisible();
  for (const button of await card.locator(".confirmation-checkin button").all()) await expect(button).toBeDisabled();
  expect(posts).toBe(1);
  expect(payload).toMatchObject({ patch_version: "1.13.01", platform: "pc_steam", kind: "not_happening", turnstile_token: expect.stringMatching(/^stub-token-/) });
  release();
  await expect(card.getByText(/Saved for patch 1\.13\.01\. One answer per network and issue/)).toBeVisible();
  await expect(count).toHaveText(before ?? ""); expect(posts).toBe(1);
});

test("bot expiry and errors prevent a write until a new challenge response arrives", async ({ page }) => {
  await installTurnstile(page);
  let posts = 0;
  await page.route("**/api/confirmations", async (route) => { posts += 1; await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true }) }); });
  const card = await checkInCard(page);
  await choosePlatform(card, "Happening to me");
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
  await choosePlatform(card, "Happening to me"); await card.getByRole("button", { name: "Save check-in", exact: true }).click();
  await expect(card.getByText("This preview is read-only. Check-ins work on the production site.")).toBeVisible();
  await expect(card.getByRole("button", { name: "PC (Steam)", exact: true })).toBeEnabled(); expect(posts).toBe(1);
});

test("an in-flight check-in cannot update a remounted board flow", async ({ page }) => {
  await installTurnstile(page);
  let release!: () => void;
  const heldResponse = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/confirmations", async (route) => { await heldResponse; await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true }) }); });
  const card = await checkInCard(page);
  const response = page.waitForResponse((candidate) => candidate.url().endsWith("/api/confirmations") && candidate.request().method() === "POST");
  await choosePlatform(card, "Happening to me"); await card.getByRole("button", { name: "Save check-in", exact: true }).click();
  await expect(card.getByText("Recording your answer…", { exact: true })).toBeVisible();
  const boardViews = page.getByRole("group", { name: "Choose board view" });
  await boardViews.getByRole("button", { name: /Watchlist/ }).click(); await expect(card).toHaveCount(0); release(); await response;
  await boardViews.getByRole("button", { name: /Published issues/ }).click();
  const replacement = page.getByRole("article").filter({ hasText: "FPS regression since 1.13" });
  await expect(replacement).toHaveCount(1); await expect(replacement.getByText(/Saved for patch 1\.13\.01/)).toHaveCount(0);
  await expect(replacement.getByText("Recording your answer…", { exact: true })).toHaveCount(0);
  await expect(replacement.getByRole("button", { name: /Happening to me/ })).toHaveAttribute("aria-pressed", "false");
});
