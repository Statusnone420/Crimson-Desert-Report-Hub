import { expect, test, type Page } from "@playwright/test";
import { collectConsoleProblems, expectHealthyPage } from "./helpers";

const E2E_NOW = new Date("2026-07-20T00:10:00.000Z");
const PRIVATE_MARKERS = [
  "Possible mount input lockup",
  "Private mapped candidate used to prove public question rendering",
  "forum.example.com",
  "mount-input-rumor",
];

async function expectAccessibleLandmarks(page: Page) {
  const result = await page.evaluate(() => ({
    mainCount: document.querySelectorAll("main, [role=main]").length,
    hiddenFocusable: document.querySelectorAll('[aria-hidden="true"] a, [aria-hidden="true"] button, [aria-hidden="true"] input').length,
  }));
  expect(result).toEqual({ mainCount: 1, hiddenFocusable: 0 });
}

async function expectNewspaperContrast(page: Page) {
  const failures = await page.evaluate(() => {
    function rgb(value: string) {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) return null;
      return match[1].split(",").slice(0, 3).map((part) => Number.parseFloat(part.trim()));
    }
    function luminance(values: number[]) {
      const channels = values.map((channel) => {
        const value = channel / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    }
    const root = document.querySelector(".newspaper");
    if (!root) return ["newspaper root missing"];
    const background = rgb(getComputedStyle(root).backgroundColor);
    if (!background) return ["newspaper background unreadable"];
    return [".kicker", ".np-footer a"].flatMap((selector) => [...root.querySelectorAll(selector)].flatMap((element) => {
      const foreground = rgb(getComputedStyle(element).color);
      if (!foreground) return [selector + " foreground unreadable"];
      const ratio = (Math.max(luminance(foreground), luminance(background)) + 0.05) /
        (Math.min(luminance(foreground), luminance(background)) + 0.05);
      return ratio >= 4.5 ? [] : [selector + " contrast " + ratio.toFixed(2) + " is below 4.5"];
    }));
  });
  expect(failures).toEqual([]);
}

async function expectLoginControlContrast(page: Page, theme: "light" | "dark") {
  const failures = await page.locator(".np-login").evaluate((form) => {
    function rgb(value: string) {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) return null;
      const parts = match[1].split(",").map((part) => Number.parseFloat(part.trim()));
      return { channels: parts.slice(0, 3), alpha: parts[3] ?? 1 };
    }
    function luminance(values: number[]) {
      const channels = values.map((channel) => {
        const value = channel / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    }
    return ["input", "button"].flatMap((selector) => {
      const element = form.querySelector(selector);
      if (!element) return [`${selector} missing`];
      const style = getComputedStyle(element);
      const foreground = rgb(style.color);
      const background = rgb(style.backgroundColor);
      if (!foreground || !background) return [`${selector} colors unreadable`];
      if (background.alpha < 1) return [`${selector} background is transparent`];
      const ratio = (Math.max(luminance(foreground.channels), luminance(background.channels)) + 0.05) /
        (Math.min(luminance(foreground.channels), luminance(background.channels)) + 0.05);
      return ratio >= 4.5 ? [] : [`${selector} contrast ${ratio.toFixed(2)} is below 4.5`];
    });
  });
  expect(failures, `${theme} admin sign-in controls must remain readable`).toEqual([]);
}

async function expectNoPrivateMarkers(page: Page) {
  const markup = await page.content();
  for (const marker of PRIVATE_MARKERS) expect(markup).not.toContain(marker);
}

async function fillValidReport(page: Page) {
  await page.getByLabel("Platform").selectOption("pc_steam");
  await page.getByRole("radio", { name: "Performance" }).check({ force: true });
  await page.getByRole("radio", { name: "Serious" }).check({ force: true });
  await page.getByRole("radio", { name: "Often" }).check({ force: true });
  await page.getByLabel("A short, specific summary").fill("Frame rate falls while opening the map");
  await page.getByLabel("Describe the problem").fill("The frame rate drops when opening the world map after a battle near the camp.");
}

test.describe("integrated newspaper public UI", () => {
  test.beforeEach(async ({ page }) => {
    // Freeze fixture dates while leaving navigation and animation timers native.
    await page.clock.setFixedTime(E2E_NOW);
  });

  test("home keeps patch records, player counts, and private scanner material separate", async ({ page }, testInfo) => {
    const problems = collectConsoleProblems(page);
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav.getByRole("link", { name: "News" })).toHaveAttribute("href", "/");
    await expect(nav.getByRole("link", { name: "Patches" })).toHaveAttribute("href", "/patches");
    await expect(nav.getByRole("link", { name: "Player reports" })).toHaveAttribute("href", "/issues");
    await expect(nav.getByRole("link", { name: "Expansion" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Watch", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "More from the news desk →" })).toHaveAttribute("href", "/news");
    await expect(nav.getByRole("link", { name: "Observatory" })).toHaveAttribute("href", "/observatory");
    await expect(page.getByRole("contentinfo").getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    await expect(page.getByRole("contentinfo").getByText("No ads · No trackers")).toBeVisible();
    await expect(page.getByRole("contentinfo").getByRole("link", { name: "Open source" })).toHaveAttribute(
      "href",
      "https://github.com/Statusnone420/Crimson-Desert-Report-Hub",
    );
    if (testInfo.project.name === "mobile-chromium") {
      await expect(page.getByRole("contentinfo").getByRole("link", { name: /File a report/ })).toHaveAttribute("href", "/report");
    } else {
      await expect(page.getByRole("contentinfo").getByRole("link", { name: /File a report/ })).toHaveAttribute("href", "/report");
    }
    await expect(page.getByRole("link", { name: /Patch 1\.13\.01: the official fixes and player record/ })).toHaveAttribute("href", "/patches");
    await expect(page.getByText(/Individual reports stay on the issue board/)).toBeVisible();
    await expect(page.getByRole("link", { name: /All \d+ published issues/ })).toHaveAttribute("href", "/issues");
    await expect(page.getByRole("heading", { name: "FPS regression since 1.13" })).toHaveCount(0);
    await expect(page.getByText("The game in numbers")).toBeVisible();
    const storyImages = page.locator(".stories .story-image img");
    await expect(storyImages).toHaveCount(2);
    for (const image of await storyImages.all()) {
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate((element) => {
        const image = element as HTMLImageElement;
        if (!image.complete || !image.naturalWidth) return false;
        const width = Number(new URL(image.currentSrc).searchParams.get("w"));
        const frame = image.getBoundingClientRect();
        const sourceRatio = Number(image.getAttribute("width")) / Number(image.getAttribute("height"));
        return width >= Math.max(frame.width, frame.height * sourceRatio) * window.devicePixelRatio;
      })).toBe(true);
    }
    await expectNoPrivateMarkers(page);
    await expectAccessibleLandmarks(page);
    await expectHealthyPage(page, problems);
  });

  test("patch desk preserves official sources and safe empty-register language", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.goto("/patches");
    await expect(page.getByRole("heading", { name: /Patch 1\.13\.01/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Read Pearl Abyss’s complete notes ↗" })).toHaveAttribute("href", /^https:\/\//);
    const claims = page.locator("#claims");
    await expect(claims.getByRole("heading", { name: "What changed in your corner of Pywel?" })).toBeVisible();
    await expect(claims.getByText(/Showing \d+ of \d+ stored official fix claims/)).toBeVisible();
    await expect(page.getByText("These are different records. An official fix claim does not establish that a player’s issue is resolved.")).toBeVisible();
    await expect(claims.getByText("This is not a report of zero claimed fixes.")).toHaveCount(0);
    const unsafeSourceUrls = await claims.locator("a[target=_blank]").evaluateAll((anchors) =>
      anchors.map((anchor) => anchor.getAttribute("href") ?? "").filter((href) => !href.startsWith("https://")),
    );
    expect(unsafeSourceUrls).toEqual([]);
    await expectNoPrivateMarkers(page);
    await expectHealthyPage(page, problems);
  });

  test("observatory is public at both routes and never turns context into player evidence", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.goto("/observatory");
    await expect(page.getByRole("heading", { name: "The game, in context." })).toBeVisible();
    const sections = page.getByRole("navigation", { name: "Observatory sections" });
    await expect(sections.getByRole("link", { name: "The review record ↓" })).toHaveAttribute("href", "#review-record");
    await expect(sections.getByRole("link", { name: "Platform activity ↓" })).toHaveAttribute("href", "#platform-activity");
    await expect(sections.getByRole("link", { name: "The source radar ↓" })).toHaveAttribute("href", "#scanner-radar");
    await expect(page.getByText(/Steam reviews and Twitch captures are recorded aggregates/)).toBeVisible();
    await expect(page.getByText(/Scanner leads are context with a source, never player reports/)).toBeVisible();
    await expect(page.locator("#review-record .obs-chart-readout").getByText(/recorded readings/)).toBeVisible();
    await expectNoPrivateMarkers(page);
    await expectAccessibleLandmarks(page);
    await expectHealthyPage(page, problems);

    await page.goto("/scanner");
    await expect(page.getByRole("heading", { name: "The game, in context." })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Observatory" })).toHaveAttribute("aria-current", "page");
    await expectNoPrivateMarkers(page);
  });

  test("issue board filters public records and preserves confirmation revision scopes", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.addInitScript(() => {
      window.localStorage.setItem("cd-confirm-00000000-0000-4000-8000-000000000002-1.13", "fixed_for_me");
    });
    await page.goto("/issues");
    await expect(page.getByRole("heading", { name: "The player record." })).toBeVisible();
    const board = page.locator("#board");
    await expect(board.getByRole("group", { name: "Choose board view" })).toBeVisible();
    await expect(board.getByLabel("Find an issue")).toBeVisible();
    await expect(board.getByLabel("Category")).toBeVisible();
    const card = page.getByRole("article").filter({ hasText: "Map-open crash persists after fix" });
    await expect(card).toHaveCount(1);
    await expect(card.getByRole("button", { name: /Fixed for me/ })).toHaveAttribute("aria-pressed", "false");
    await card.getByRole("button", { name: /Fixed for me/ }).click();
    await card.getByRole("button", { name: "PC (Steam)" }).click();
    await expect(card.getByText(/Recorded once per network per patch/)).toBeVisible();
    await card.getByRole("button", { name: /Still happening/ }).click();
    await expect(card.getByRole("button", { name: /Still happening/ })).toHaveAttribute("aria-pressed", "true");
    await card.getByRole("button", { name: "Base PS5", exact: true }).click();
    await expect(card.getByRole("button", { name: /Still happening/ })).toHaveAttribute("aria-pressed", "true");
    await expectNoPrivateMarkers(page);
    await expectHealthyPage(page, problems);
  });

  test("preview confirmation refusal keeps the issue board read-only", async ({ page }) => {
    await page.route("**/api/confirmations", async (route) => {
      await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "preview_writes_disabled" }) });
    });
    await page.goto("/issues");
    const card = page.getByRole("article").filter({ hasText: "Map-open crash persists after fix" });
    await expect(card).toHaveCount(1);
    await card.getByRole("button", { name: /Fixed for me/ }).click();
    await card.getByRole("button", { name: "PC (Steam)" }).click();
    await expect(card.getByText("This preview is read-only. Confirmations work on the production site.")).toBeVisible();
  });

  test("privacy page resolves from the footer and keeps the unofficial disclaimer", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.goto("/");
    await page.getByRole("contentinfo").getByRole("link", { name: "Privacy" }).click();
    // CI compiles this client navigation on demand while other specs share the
    // mock server; wait past the default expect timeout before asserting.
    await page.waitForURL(/\/privacy$/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Privacy" })).toBeVisible();
    await expect(page.getByText("There is no player sign-in and nothing to register.")).toBeVisible();
    await expect(page.getByText("The database does not store your IP address.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Full privacy policy" })).toHaveAttribute(
      "href",
      "https://github.com/Statusnone420/Crimson-Desert-Report-Hub/blob/main/docs/PRIVACY.md",
    );
    await expect(page.getByText(/Unofficial fan site/)).toBeVisible();
    await expectNoPrivateMarkers(page);
    await expectAccessibleLandmarks(page);
    await expectHealthyPage(page, problems);
  });

  test("newspaper stays accessible and within the narrowest public viewport", async ({ page }, testInfo) => {
    const problems = collectConsoleProblems(page);
    if (testInfo.project.name === "mobile-chromium") await page.setViewportSize({ width: 320, height: 844 });
    await page.goto("/");
    await expect(page.getByRole("link", { name: /Crimson Desert Report Hub/ })).toBeVisible();
    await expectNewspaperContrast(page);
    await expectAccessibleLandmarks(page);
    await expectHealthyPage(page, problems);
  });

  test("report writes only after review, then submits and resets", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.goto("/report");
    await expect(page.getByRole("heading", { name: "Tell us what happened." })).toBeVisible();
    await fillValidReport(page);
    await page.getByRole("button", { name: "Review report" }).click();
    await expect(page.getByRole("heading", { name: "Frame rate falls while opening the map" })).toBeVisible();
    await expect(page.getByText("Nothing has been sent until you choose Send report.")).toBeVisible();
    await page.getByRole("button", { name: /Send report/ }).click();
    await expect(page.getByRole("heading", { name: "Filed." })).toBeVisible();
    await page.getByRole("button", { name: "File another report" }).click();
    await expect(page.getByLabel("Platform")).toHaveValue("");
    await expectHealthyPage(page, problems);
  });

  test("report network retry and preview refusal preserve the reviewed draft", async ({ page }) => {
    await page.goto("/report");
    await fillValidReport(page);
    await page.getByRole("button", { name: "Review report" }).click();
    await page.route("**/api/reports", (route) => route.abort("failed"));
    await page.getByRole("button", { name: /Send report/ }).click();
    await expect(page.locator("#report-form").getByRole("alert")).toContainText("Could not send your report");
    await expect(page.getByRole("button", { name: /Send report/ })).toBeEnabled();
    await expect(page.getByRole("heading", { name: "Frame rate falls while opening the map" })).toBeVisible();
    await page.unroute("**/api/reports");
    await page.route("**/api/reports", async (route) => {
      await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "preview_writes_disabled" }) });
    });
    await page.getByRole("button", { name: /Send report/ }).click();
    await expect(page.locator("#report-form").getByRole("alert")).toContainText("This preview cannot accept reports. Your draft is still here");
    await expect(page.getByRole("heading", { name: "Frame rate falls while opening the map" })).toBeVisible();
  });

  test("admin sign-in recovers from a network failure without losing the password", async ({ page }) => {
    await page.route("**/api/admin/login", (route) => route.abort("failed"));
    await page.goto("/admin/login");
    const password = page.getByLabel("Password");
    await password.fill("not-a-real-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.locator(".np-login").getByRole("alert")).toHaveText("Could not connect. Try again.");
    await expect(password).toHaveValue("not-a-real-password");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  test("operator routes keep sign-in, export recovery, and compile controls reachable", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.goto("/");
    const footer = page.getByRole("contentinfo");
    await expect(footer.getByRole("button", { name: "Admin", exact: true })).toHaveCount(0);
    await expect(footer.getByRole("link", { name: "Admin", exact: true })).toHaveCount(0);

    await page.goto("/admin/login?from=%2Fadmin");
    await expect(page.getByRole("heading", { level: 1, name: "Admin sign-in" })).toBeVisible();
    await page.getByLabel("Password").fill("admin-password");
    for (const theme of ["light", "dark"] as const) {
      if (await page.locator("html").getAttribute("data-theme") !== theme) {
        await page.getByRole("button", { name: `Switch to ${theme} mode` }).click();
      }
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expectLoginControlContrast(page, theme);
    }
    await page.getByRole("button", { name: "Sign in" }).click();
    // CI compiles this client navigation on demand; wait for its document
    // transition before asserting the authenticated page and its controls.
    await page.waitForURL(/\/admin$/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Report review" })).toBeVisible();
    const operator = page.getByRole("navigation", { name: "Operator" });
    await expect(operator.getByRole("link", { name: "Overview" })).toHaveAttribute("href", "/operator");
    await expect(operator.getByRole("link", { name: "Report review" })).toHaveAttribute("aria-current", "page");
    await expect(operator.getByRole("link", { name: "Videos" })).toHaveAttribute("href", "/admin/videos");
    await expect(operator.getByRole("link", { name: "Scanner monitor" })).toHaveAttribute("href", "/scanner");
    await page.getByRole("button", { name: /Export CSV/ }).click();
    await expect(page.getByText("Export all report-review rows?")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("Export all report-review rows?")).toHaveCount(0);
    await page.goto("/admin/compile");
    await expect(page.getByRole("heading", { name: "Compile Pearl Abyss dossier" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Compile now" })).toBeVisible();
    await expectHealthyPage(page, problems);
  });

  test("manifest keeps newspaper navigation inside the standalone app scope", async ({ page }) => {
    await page.goto("/issues");
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
    const response = await page.request.get("/manifest.webmanifest");
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ display: "standalone", id: "/", scope: "/", start_url: "/" });
  });
});
