import { expect, test, type Page } from "@playwright/test";
import { collectConsoleProblems, expectHealthyPage } from "./helpers";

type StubState = {
  renders: { id: string; sitekey: string; theme: string; size: string }[];
  removed: string[];
  activeIds: string[];
};

// This models the render/remove contract and response field, not Cloudflare verification.
const STUB_SCRIPT = String.raw`
(() => {
  const state = window.__turnstileStub = { renders: [], removed: [], activeIds: [] };
  const widgets = new Map();
  window.turnstile = {
    render(element, options) {
      if (!(element instanceof HTMLElement)) throw new Error('Turnstile needs its mounted container');
      const id = 'stub-widget-' + (state.renders.length + 1);
      const token = 'stub-token-' + id;
      const widget = document.createElement('div');
      widget.dataset.stubWidget = id;
      widget.dataset.theme = options.theme;
      widget.style.cssText = 'width:150px;height:140px;max-width:100%';
      widget.textContent = 'Local challenge stub';
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'cf-turnstile-response';
      input.value = token;
      widget.append(input);
      element.append(widget);
      widgets.set(id, widget);
      state.renders.push({ id, sitekey: options.sitekey, theme: options.theme, size: options.size });
      state.activeIds.push(id);
      if (options.callback) options.callback(token);
      return id;
    },
    remove(id) {
      if (!widgets.has(id)) throw new Error('Removed unknown Turnstile widget: ' + id);
      widgets.get(id).remove();
      widgets.delete(id);
      state.removed.push(id);
      state.activeIds = state.activeIds.filter(active => active !== id);
    }
  };
})();`;

async function installStub(page: Page, theme: "light" | "dark" | null, delayed = false) {
  await page.addInitScript((savedTheme) => {
    if (savedTheme === null) localStorage.removeItem("newspaper-theme");
    else localStorage.setItem("newspaper-theme", savedTheme);
  }, theme);
  const externalRequests: string[] = [];
  const reportWrites: string[] = [];
  let releaseScript!: () => void;
  let scriptRequested!: () => void;
  const gate = new Promise<void>((resolve) => { releaseScript = resolve; });
  const requested = new Promise<void>((resolve) => { scriptRequested = resolve; });
  if (!delayed) releaseScript();
  await page.route("https://challenges.cloudflare.com/**", async (route) => {
    const url = new URL(route.request().url());
    externalRequests.push(url.pathname + url.search);
    if (url.pathname !== "/turnstile/v0/api.js") {
      await route.abort();
      return;
    }
    scriptRequested();
    await gate;
    await route.fulfill({ contentType: "application/javascript", body: STUB_SCRIPT });
  });
  await page.route("**/api/reports", async (route) => {
    reportWrites.push(route.request().method());
    await route.abort();
  });
  return { requested, releaseScript, externalRequests, reportWrites };
}

async function stubState(page: Page) {
  return page.evaluate(() => (window as unknown as { __turnstileStub: StubState }).__turnstileStub);
}

async function expectCurrentWidget(page: Page, theme: "light" | "dark") {
  const responses = page.locator('.turnstile-widget input[name="cf-turnstile-response"]');
  await expect(responses).toHaveCount(1);
  await expect(page.locator(".turnstile-widget [data-stub-widget]")).toHaveAttribute("data-theme", theme);
  const state = await stubState(page);
  const latest = state.renders.at(-1)!;
  expect(latest).toMatchObject({ theme, sitekey: "1x00000000000000000000AA", size: "compact" });
  expect(state.activeIds).toEqual([latest.id]);
  const expectedToken = "stub-token-" + latest.id;
  await expect(responses).toHaveValue(expectedToken);
  const tokens = await page.locator("#report-form form").evaluate((form) =>
    new FormData(form as HTMLFormElement).getAll("cf-turnstile-response"));
  expect(tokens, "The report must contain only the newest widget response").toEqual([expectedToken]);
  return latest.id;
}

test.describe("Turnstile theme integration with a local vendor stub", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-07-20T00:10:00.000Z"));
  });

  for (const theme of ["light", "dark"] as const) {
    test(`initial report widget follows ${theme} theme`, async ({ page }) => {
      const problems = collectConsoleProblems(page);
      const stub = await installStub(page, theme === "light" ? null : theme);
      await page.goto("/report");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expectCurrentWidget(page, theme);
      expect(stub.externalRequests).toEqual(["/turnstile/v0/api.js?render=explicit"]);
      expect(stub.reportWrites).toEqual([]);
      await expectHealthyPage(page, problems);
    });
  }

  test("a theme change before script readiness uses the latest theme", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    const stub = await installStub(page, "light", true);
    await page.goto("/report", { waitUntil: "domcontentloaded" });
    await stub.requested;
    await expect(page.locator(".turnstile-widget [data-stub-widget]")).toHaveCount(0);
    await page.getByRole("button", { name: "Switch to dark mode" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    stub.releaseScript();
    await expectCurrentWidget(page, "dark");
    const state = await stubState(page);
    expect(state.renders.map(({ theme }) => theme)).toEqual(["dark"]);
    expect(stub.externalRequests).toEqual(["/turnstile/v0/api.js?render=explicit"]);
    expect(stub.reportWrites).toEqual([]);
    await expectHealthyPage(page, problems);
  });

  test("theme changes replace the token, preserve the draft, and remount with the cached script", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    const stub = await installStub(page, "light");
    await page.goto("/report");
    const firstId = await expectCurrentWidget(page, "light");
    await page.getByLabel("A short, specific summary").fill("Map frame rate regression");
    await page.getByLabel("Describe the problem").fill("The frame rate falls when I open the map after a battle.");
    await page.getByLabel("Platform").selectOption("pc_steam");
    await page.getByRole("button", { name: "Switch to dark mode" }).click();
    const darkId = await expectCurrentWidget(page, "dark");
    expect(darkId).not.toBe(firstId);
    expect((await stubState(page)).removed).toContain(firstId);
    await expect(page.getByLabel("A short, specific summary")).toHaveValue("Map frame rate regression");
    await expect(page.getByLabel("Describe the problem")).toHaveValue("The frame rate falls when I open the map after a battle.");
    await expect(page.getByLabel("Platform")).toHaveValue("pc_steam");
    await page.getByRole("button", { name: "Switch to light mode" }).click();
    const lightId = await expectCurrentWidget(page, "light");
    expect(lightId).not.toBe(darkId);
    expect((await stubState(page)).removed).toContain(darkId);
    await expectHealthyPage(page, problems);

    await page.getByRole("contentinfo").getByRole("link", { name: "About", exact: true }).click();
    await expect(page).toHaveURL(/\/about$/);
    await expect(page.locator(".turnstile-widget")).toHaveCount(0);
    await expect.poll(async () => (await stubState(page)).activeIds).toEqual([]);
    expect((await stubState(page)).removed).toContain(lightId);
    await page.getByRole("button", { name: "Switch to dark mode" }).click();
    await page.getByRole("contentinfo").getByRole("link", { name: "File a report →" }).click();
    await expect(page).toHaveURL(/\/report$/);
    const remountedId = await expectCurrentWidget(page, "dark");
    expect(remountedId).not.toBe(lightId);
    expect((await stubState(page)).removed).toContain(lightId);
    expect(stub.externalRequests, "Client navigation should reuse the loaded vendor script").toEqual(["/turnstile/v0/api.js?render=explicit"]);
    expect(stub.reportWrites).toEqual([]);
    await expectHealthyPage(page, problems);
  });
});
