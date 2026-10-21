import { expect, test, type Page } from "@playwright/test";
import { collectConsoleProblems, expectHealthyPage, waitForHydration } from "./helpers";

type StubState = {
  renders: { id: string; sitekey: string; theme: string; size: string; appearance?: string }[];
  removed: string[];
  activeIds: string[];
};

// This models the render/remove contract and response callback, not Cloudflare verification.
const STUB_SCRIPT = String.raw`
(() => {
  const state = window.__turnstileStub = { renders: [], removed: [], activeIds: [] };
  const widgets = new Map();
  window.turnstile = {
    render(element, options) {
      if (!(element instanceof HTMLElement)) throw new Error('Turnstile needs its mounted container');
      const id = 'stub-widget-' + (state.renders.length + 1);
      const token = 'stub-token-' + id;
      const input = document.createElement('input');
      input.type = 'hidden'; input.name = 'cf-turnstile-response'; input.value = token; input.dataset.stubWidget = id; input.dataset.theme = options.theme;
      element.append(input); widgets.set(id, input);
      state.renders.push({ id, sitekey: options.sitekey, theme: options.theme, size: options.size, appearance: options.appearance }); state.activeIds.push(id);
      options.callback?.(token);
      return id;
    },
    remove(id) {
      if (!widgets.has(id)) throw new Error('Removed unknown Turnstile widget: ' + id);
      widgets.get(id).remove(); widgets.delete(id); state.removed.push(id); state.activeIds = state.activeIds.filter(active => active !== id);
    }
  };
})();`;

async function installStub(page: Page, theme: "light" | "dark" | null, delayed = false) {
  await page.addInitScript((savedTheme) => {
    if (savedTheme === null) localStorage.removeItem("newspaper-theme");
    else localStorage.setItem("newspaper-theme", savedTheme);
  }, theme);
  const externalRequests: string[] = [];
  const checkinWrites: string[] = [];
  let releaseScript!: () => void;
  let scriptRequested!: () => void;
  const gate = new Promise<void>((resolve) => { releaseScript = resolve; });
  const requested = new Promise<void>((resolve) => { scriptRequested = resolve; });
  if (!delayed) releaseScript();
  await page.route("https://challenges.cloudflare.com/**", async (route) => {
    const url = new URL(route.request().url());
    externalRequests.push(url.pathname + url.search);
    if (url.pathname !== "/turnstile/v0/api.js") { await route.abort(); return; }
    scriptRequested(); await gate; await route.fulfill({ contentType: "application/javascript", body: STUB_SCRIPT });
  });
  await page.route("**/api/confirmations", async (route) => { checkinWrites.push(route.request().method()); await route.abort(); });
  return { requested, releaseScript, externalRequests, checkinWrites };
}

// Check-ins answer an official fix claim. This suite has its own mock server,
// so it confirms the fixture's waiting map claim once and leaves it confirmed.
const MOCK_SUPABASE_ORIGIN = `http://127.0.0.1:${process.env.PLAYWRIGHT_TURNSTILE_SUPABASE_PORT ?? 18767}`;
const CLAIM_CARD = "Map-open crash persists after fix";

async function checkInCard(page: Page) {
  const card = page.getByRole("article").filter({ hasText: CLAIM_CARD });
  await expect(async () => {
    await page.goto("/issues", { waitUntil: "domcontentloaded" });
    await waitForHydration(page);
    await expect(card.getByRole("button", { name: /^Fixed for me/ })).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  await expect(card).toHaveCount(1);
  return card;
}

async function openWidget(page: Page) {
  const card = await checkInCard(page);
  await card.getByRole("button", { name: /^Fixed for me/ }).click();
  await card.getByRole("button", { name: "PC (Steam)", exact: true }).click();
  return card;
}

test.beforeAll(async ({ browser }, testInfo) => {
  const page = await browser.newPage({ baseURL: testInfo.project.use.baseURL });
  try {
    const confirmed = await page.request.post(`${MOCK_SUPABASE_ORIGIN}/rest/v1/rpc/mutate_claim_review_pairing`, {
      data: { p_pairing_id: "00000000-0000-4000-8000-000000000201", p_revision: 1, p_action: "confirm", p_cluster_lifecycle_revision: 1, p_actor: "turnstile fixture" },
    });
    // The second project finds the claim already confirmed.
    if (!confirmed.ok()) expect(await confirmed.text()).toContain("claim_review_pairing_stale");
    const board = await page.request.get("/issues", { headers: { "cache-control": "no-cache" } });
    expect(board.ok()).toBe(true);
  } finally {
    await page.close();
  }
});

async function stubState(page: Page) {
  return page.evaluate(() => (window as unknown as { __turnstileStub: StubState }).__turnstileStub);
}

async function expectCurrentWidget(page: Page, theme: "light" | "dark") {
  const responses = page.locator('.turnstile-widget input[name="cf-turnstile-response"]');
  await expect(responses).toHaveCount(1);
  await expect(responses).toHaveAttribute("data-theme", theme);
  const state = await stubState(page);
  const latest = state.renders.at(-1)!;
  expect(latest).toMatchObject({ theme, sitekey: "1x00000000000000000000AA", size: "compact" });
  expect(state.activeIds).toEqual([latest.id]);
  await expect(responses).toHaveValue("stub-token-" + latest.id);
  return latest.id;
}

test.describe("Turnstile theme integration with a local vendor stub", () => {
  test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(new Date("2026-07-20T00:10:00.000Z")); });

  for (const theme of ["light", "dark"] as const) {
    test(`initial check-in widget follows ${theme} theme`, async ({ page }) => {
      const problems = collectConsoleProblems(page);
      const stub = await installStub(page, theme === "light" ? null : theme);
      await openWidget(page);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expectCurrentWidget(page, theme);
      expect(stub.externalRequests).toEqual(["/turnstile/v0/api.js?render=explicit"]);
      expect(stub.checkinWrites).toEqual([]);
      await expectHealthyPage(page, problems);
    });
  }

  test("a theme change before script readiness uses the latest theme", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    const stub = await installStub(page, "light", true);
    const card = await checkInCard(page);
    await card.getByRole("button", { name: /^Fixed for me/ }).click();
    await card.getByRole("button", { name: "PC (Steam)", exact: true }).click();
    await stub.requested;
    await expect(page.locator(".turnstile-widget [data-stub-widget]")).toHaveCount(0);
    await page.getByRole("button", { name: "Switch to dark mode" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    stub.releaseScript();
    await expectCurrentWidget(page, "dark");
    expect((await stubState(page)).renders.map(({ theme }) => theme)).toEqual(["dark"]);
    expect(stub.externalRequests).toEqual(["/turnstile/v0/api.js?render=explicit"]);
    expect(stub.checkinWrites).toEqual([]);
    await expectHealthyPage(page, problems);
  });

  test("a thumb's bot check uses the current theme and stays out of sight unless needed", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    const stub = await installStub(page, "dark");
    const thumbWrites: string[] = [];
    await page.route("**/api/thumbs", async (route) => {
      thumbWrites.push((route.request().postDataJSON() as { direction: string }).direction);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, direction: "up", patch_version: "1.13.01" }) });
    });
    await page.goto("/issues");
    await waitForHydration(page);
    const card = page.getByRole("article").filter({ hasText: "FPS regression since 1.13" });
    const up = card.getByRole("button", { name: "Happening to me", exact: true });
    await up.click();
    // The vendor script loads on the first tap, so the stub may not exist yet.
    await expect.poll(() => page.evaluate(() => (window as unknown as { __turnstileStub?: StubState }).__turnstileStub?.renders.length ?? 0)).toBe(1);
    expect((await stubState(page)).renders[0]).toMatchObject({ theme: "dark", sitekey: "1x00000000000000000000AA", size: "compact", appearance: "interaction-only" });
    // The stub answers at once, the thumb saves, and the check goes away.
    await expect(up).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => (await stubState(page)).activeIds).toEqual([]);
    expect(thumbWrites).toEqual(["up"]);
    expect(stub.checkinWrites).toEqual([]);
    await expectHealthyPage(page, problems);
  });

  test("theme changes replace the token and preserve the selected check-in", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    const stub = await installStub(page, "light");
    const card = await openWidget(page);
    const firstId = await expectCurrentWidget(page, "light");
    await page.getByRole("button", { name: "Switch to dark mode" }).click();
    const darkId = await expectCurrentWidget(page, "dark");
    expect(darkId).not.toBe(firstId); expect((await stubState(page)).removed).toContain(firstId);
    await expect(card.getByText("PC (Steam) · Fixed for me")).toBeVisible();
    await expect(card.getByRole("button", { name: "Save check-in", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Switch to light mode" }).click();
    const lightId = await expectCurrentWidget(page, "light");
    expect(lightId).not.toBe(darkId); expect((await stubState(page)).removed).toContain(darkId);
    await expectHealthyPage(page, problems);

    await page.getByRole("contentinfo").getByRole("link", { name: "About", exact: true }).click();
    await expect(page).toHaveURL(/\/about$/); await expect(page.locator(".turnstile-widget")).toHaveCount(0);
    await expect.poll(async () => (await stubState(page)).activeIds).toEqual([]);
    expect((await stubState(page)).removed).toContain(lightId);
    await page.getByRole("button", { name: "Switch to dark mode" }).click();
    await page.getByRole("contentinfo").getByRole("link", { name: "Add a check-in", exact: true }).click();
    await expect(page).toHaveURL(/\/issues$/);
    const remountedCard = page.getByRole("article").filter({ hasText: CLAIM_CARD });
    await remountedCard.getByRole("button", { name: /^Fixed for me/ }).click();
    await remountedCard.getByRole("button", { name: "PC (Steam)", exact: true }).click();
    const remountedId = await expectCurrentWidget(page, "dark");
    expect(remountedId).not.toBe(lightId); expect((await stubState(page)).removed).toContain(lightId);
    expect(stub.externalRequests, "Client navigation should reuse the loaded vendor script").toEqual(["/turnstile/v0/api.js?render=explicit"]);
    expect(stub.checkinWrites).toEqual([]);
    await expectHealthyPage(page, problems);
  });
});
