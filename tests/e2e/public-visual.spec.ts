import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

function collectConsoleProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      if (message.text().includes("/_next/webpack-hmr") && message.text().includes("WebSocket connection")) {
        return;
      }
      problems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    problems.push(`pageerror: ${error.message}`);
  });
  return problems;
}

async function expectHealthyPage(page: Page, problems: string[]) {
  await expect(page.locator("body")).not.toHaveText("");
  await expect(page.getByText(/Application error|Unhandled Runtime Error|Failed to compile/i)).toHaveCount(0);
  expect(problems).toEqual([]);
  // The page body must never scroll sideways — wide content scrolls in its own container.
  const layout = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const scrollWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    const offenders = [...document.querySelectorAll("body *")]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || (rect.left >= -1 && rect.right <= viewportWidth + 1)) return false;

        let parent = element.parentElement;
        while (parent && parent !== document.body) {
          const overflowX = getComputedStyle(parent).overflowX;
          if (["auto", "scroll", "hidden", "clip"].includes(overflowX)) return false;
          parent = parent.parentElement;
        }
        return true;
      })
      .slice(0, 8)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          element: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${
            element.getAttribute("class")
              ? `.${element.getAttribute("class")?.trim().replace(/\s+/g, ".")}`
              : ""
          }`,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          text: element.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) ?? "",
          width: Math.round(rect.width),
        };
      });

    return { offenders, scrollWidth, viewportWidth };
  });
  expect(
    layout.scrollWidth,
    `page has horizontal overflow:\n${JSON.stringify(layout, null, 2)}`,
  ).toBeLessThanOrEqual(layout.viewportWidth + 1);
}

async function signInAsAdmin(page: Page) {
  const response = await page.request.post("/api/admin/login", { data: { password: "admin-password" } });
  expect(response.ok()).toBe(true);
}

async function openAdminSignIn(page: Page) {
  const adminButton = page.getByRole("button", { name: "Admin" });
  const passwordInput = page.getByLabel("Admin password");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await adminButton.scrollIntoViewIfNeeded();
    await adminButton.focus();
    await page.keyboard.press("Enter");
    if (await passwordInput.isVisible({ timeout: 1_000 }).catch(() => false)) return;
  }
  await expect(passwordInput).toBeVisible();
}

async function openAdminPageFromFooter(page: Page) {
  const adminButton = page.getByRole("button", { name: "Admin" });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await adminButton.scrollIntoViewIfNeeded();
    await adminButton.focus();
    await page.keyboard.press("Enter");
    if (await page.waitForURL(/\/admin$/, { timeout: 1_000 }).then(() => true, () => false)) return;
  }
  await expect(page).toHaveURL(/\/admin$/);
}

const settingsXml = `
<EngineOptionSave>
  <EngineOptionResolution Name="_resolutionOption">
    <OptionStringVector Name="_upscaleModeSelect" _value="NVIDIA DLSS 4.0"/>
    <EnumSelectResolutionScale Name="_upscaleResolution" _select="AA"/>
  </EngineOptionResolution>
  <EngineOptionVideo Name="_videoOption">
    <OptionBool Name="_enableFrameGeneration" _value="True"/>
    <OptionStringVector Name="_enableVsync" _value="Off"/>
    <OptionBool Name="_enableHDR" _value="True"/>
  </EngineOptionVideo>
</EngineOptionSave>`;

type ContrastTarget = {
  selector: string;
  label: string;
  optional?: boolean;
};

const DASHBOARD_CONTRAST_TARGETS: ContrastTarget[] = [
  { selector: '.btn[href$="report"]', label: "submit report button" },
  { selector: ".stat-label", label: "stat labels" },
  { selector: ".panel .text-xs", label: "panel fine print" },
  { selector: ".panel-inset.interactive .text-xs", label: "watchlist item category", optional: true },
];

async function expectContrastAtLeast(page: Page, targets: ContrastTarget[], minimum = 4.5) {
  const failures = await page.evaluate(
    ({ targets, minimum }) => {
      function parseRgb(value: string): [number, number, number, number] | null {
        const match = value.match(/rgba?\(([^)]+)\)/);
        if (!match) return null;
        const parts = match[1]
          .replace(/\//g, " ")
          .split(value.includes(",") ? "," : /\s+/)
          .map((part) => part.trim())
          .filter(Boolean);
        const [r, g, b] = parts.slice(0, 3).map((part) => Number.parseFloat(part));
        const alpha = parts[3] === undefined ? 1 : Number.parseFloat(parts[3]);
        return [r, g, b, Number.isFinite(alpha) ? alpha : 1];
      }

      function relativeLuminance([r, g, b]: [number, number, number]) {
        const [sr, sg, sb] = [r, g, b].map((channel) => {
          const value = channel / 255;
          return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * sr + 0.7152 * sg + 0.0722 * sb;
      }

      function contrastRatio(foreground: [number, number, number], background: [number, number, number]) {
        const fg = relativeLuminance(foreground);
        const bg = relativeLuminance(background);
        return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
      }

      function solidBackground(element: Element): [number, number, number] {
        const layers: [number, number, number, number][] = [];
        let current: Element | null = element;
        while (current) {
          const background = parseRgb(getComputedStyle(current).backgroundColor);
          if (background && background[3] > 0) {
            layers.push(background);
            if (background[3] >= 1) break;
          }
          current = current.parentElement;
        }
        let color: [number, number, number] = [16, 17, 15];
        for (let index = layers.length - 1; index >= 0; index -= 1) {
          const [r, g, b, alpha] = layers[index];
          color = [
            r * alpha + color[0] * (1 - alpha),
            g * alpha + color[1] * (1 - alpha),
            b * alpha + color[2] * (1 - alpha),
          ];
        }
        return color;
      }

      return targets.flatMap((target) => {
        const elements = [...document.querySelectorAll(target.selector)];
        if (elements.length === 0) {
          return target.optional ? [] : [`${target.label}: selector not found (${target.selector})`];
        }
        return elements.flatMap((element, index) => {
          const color = parseRgb(getComputedStyle(element).color);
          if (!color) return [`${target.label}: foreground color could not be parsed`];
          const background = solidBackground(element);
          const ratio = contrastRatio([color[0], color[1], color[2]], background);
          const text = element.textContent?.trim().replace(/\s+/g, " ").slice(0, 48) || element.tagName.toLowerCase();
          return ratio >= minimum
            ? []
            : [`${target.label}${elements.length > 1 ? ` #${index + 1}` : ""} (${text}; fg ${color.slice(0, 3).join(",")}; bg ${background.join(",")}): ${ratio.toFixed(2)} < ${minimum}`];
        });
      });
    },
    { targets, minimum },
  );

  expect(failures).toEqual([]);
}

async function expectDesignTokenContrast(page: Page) {
  const failures = await page.evaluate(() => {
    function parseRgb(value: string): [number, number, number] {
      const hex = value.trim().replace("#", "");
      if (hex.length === 3 || hex.length === 6) {
        const expanded = hex.length === 3 ? hex.split("").map((part) => `${part}${part}`).join("") : hex;
        return [0, 2, 4].map((index) => Number.parseInt(expanded.slice(index, index + 2), 16)) as [
          number,
          number,
          number,
        ];
      }
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) throw new Error(`Could not parse ${value}`);
      const parts = match[1]
        .split(",")
        .map((part) => Number.parseFloat(part.trim()))
        .slice(0, 3);
      return [parts[0], parts[1], parts[2]];
    }

    function relativeLuminance([r, g, b]: [number, number, number]) {
      const [sr, sg, sb] = [r, g, b].map((channel) => {
        const value = channel / 255;
        return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * sr + 0.7152 * sg + 0.0722 * sb;
    }

    function contrastRatio(foreground: [number, number, number], background: [number, number, number]) {
      const fg = relativeLuminance(foreground);
      const bg = relativeLuminance(background);
      return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    }

    const styles = getComputedStyle(document.documentElement);
    const checks = [
      { label: "faint text on surface", fg: styles.getPropertyValue("--text-faint"), bg: styles.getPropertyValue("--surface") },
      { label: "faint text on inset surface", fg: styles.getPropertyValue("--text-faint"), bg: styles.getPropertyValue("--surface-inset") },
      { label: "dim text on raised surface", fg: styles.getPropertyValue("--text-dim"), bg: styles.getPropertyValue("--surface-2") },
      { label: "white primary button text", fg: "#fff", bg: styles.getPropertyValue("--crimson-action") },
    ];

    return checks.flatMap((check) => {
      const ratio = contrastRatio(parseRgb(check.fg), parseRgb(check.bg));
      return ratio >= 4.5 ? [] : [`${check.label}: ${ratio.toFixed(2)} < 4.5`];
    });
  });

  expect(failures).toEqual([]);
}

type LayoutShiftEntry = {
  value: number;
  sources: Array<{
    currentRect: LayoutShiftRect;
    node: string | null;
    previousRect: LayoutShiftRect;
  }>;
};

type LayoutShiftRect = {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
  x: number;
  y: number;
};

async function startLayoutShiftObserver(page: Page) {
  await page.addInitScript(() => {
    type ObservedLayoutShift = PerformanceEntry & {
      hadRecentInput: boolean;
      sources?: Array<{
        currentRect: DOMRectReadOnly;
        node?: Node;
        previousRect: DOMRectReadOnly;
      }>;
      value: number;
    };

    function serializeRect(rect: DOMRectReadOnly) {
      return {
        bottom: rect.bottom,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        width: rect.width,
        x: rect.x,
        y: rect.y,
      };
    }

    const testWindow = window as Window & { __layoutShifts?: LayoutShiftEntry[] };
    testWindow.__layoutShifts = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as ObservedLayoutShift[]) {
        if (entry.hadRecentInput) continue;
        testWindow.__layoutShifts?.push({
          value: entry.value,
          sources: (entry.sources ?? []).map((source) => ({
            currentRect: serializeRect(source.currentRect),
            node: source.node
              ? `${source.node.nodeName.toLowerCase()}${source.node instanceof HTMLElement && source.node.className ? `.${source.node.className.replace(/\s+/g, ".")}` : ""}`
              : null,
            previousRect: serializeRect(source.previousRect),
          })),
        });
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}

async function expectAccessibleLandmarks(page: Page) {
  const failures = await page.evaluate(() => {
    const focusableSelector =
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
    const landmarkCount = document.querySelectorAll('main, [role="main"]').length;
    const hiddenFocusable = [...document.querySelectorAll('[aria-hidden="true"]')].flatMap((node) => {
      const focusableChildren = [...node.querySelectorAll(focusableSelector)].filter((element) => {
        const style = getComputedStyle(element);
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          !element.hasAttribute("disabled") &&
          element.getAttribute("tabindex") !== "-1"
        );
      });
      return focusableChildren.map((element) => `${node.nodeName.toLowerCase()} contains ${element.nodeName.toLowerCase()}`);
    });

    return [
      ...(landmarkCount === 1 ? [] : [`expected 1 main landmark, found ${landmarkCount}`]),
      ...hiddenFocusable,
    ];
  });

  expect(failures).toEqual([]);
}

async function expectCumulativeLayoutShiftBelow(page: Page, maximum = 0.01) {
  await page.evaluate(() => document.fonts?.ready ?? Promise.resolve());
  await page.waitForLoadState("networkidle");
  const result = await page.evaluate(() => {
    const testWindow = window as Window & { __layoutShifts?: LayoutShiftEntry[] };
    const shifts = testWindow.__layoutShifts ?? [];
    return {
      cls: shifts.reduce((sum, entry) => sum + entry.value, 0),
      shifts,
    };
  });

  expect(result.cls, JSON.stringify(result.shifts, null, 2)).toBeLessThan(maximum);
}

test.describe("public surface visual regression", () => {
  test("dashboard renders moderated patch intelligence", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Primary" });

    await expect(page).toHaveTitle(/Crimson Desert Report Hub/i);
    await expect(nav.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/");
    await expect(nav.getByRole("link", { name: "Issues" })).toHaveAttribute("href", "/issues");
    await expect(nav.getByRole("link", { name: "Report", exact: true })).toHaveAttribute("href", "/report");
    await expect(nav.getByRole("link", { name: "About" })).toHaveAttribute("href", "/about");
    await expect(nav.getByRole("link", { name: "Scanner" })).toHaveAttribute("href", "/scanner");
    await expect(page.getByRole("heading", { name: "Crimson Desert Report Hub" })).toBeVisible();
    await expect(page.getByText("Right now", { exact: true })).toBeVisible();
    await expect(page.getByText(/Current issue readout —/)).toBeVisible();
    await expect(page.getByText(/Patch 1\.13\.\d{2}/).first()).toBeVisible();
    await expect(page.getByText("Player-reported issues", { exact: true })).toBeVisible();
    await expect(page.getByText("Radar leads", { exact: true })).toBeVisible();
    await expect(page.getByText("Rumors with links — not evidence", { exact: true })).toBeVisible();
    await expect(page.getByText("Source leads", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Public signals", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/latest player report (?:just now|\d+[mhd] ago)|no player reports yet/).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Official notes" }).first()).toHaveAttribute(
      "href",
      /pearlabyss\.com/,
    );
    await expect(page.getByRole("link", { name: "Pearl Abyss support" })).toHaveAttribute(
      "href",
      "https://support.pearlabyss.com/",
    );
    await expect(page.getByRole("link", { name: "Source Radar" })).toHaveAttribute("href", "/scanner");
    const hasPopulatedDashboard = (await page.getByRole("heading", { name: "Top issues this patch" }).count()) > 0;
    if (hasPopulatedDashboard) {
      await expect(page.getByRole("heading", { name: "Top issues this patch" })).toBeVisible();
      await expect(page.getByText(/\d+ reports · \d+ taps · \d+ links/).first()).toBeVisible();
      await expect(page.getByText("FPS regression since 1.13").first()).toBeVisible();
      await expect(page.getByText("Map-open crash persists after fix").first()).toBeVisible();
    } else {
      await expect(page.getByRole("heading", { name: "Nothing reported or signaled yet" })).toBeVisible();
      await expect(page.getByText(/The patch context and source radar are still available/)).toBeVisible();
    }
    await expect(page.getByRole("heading", { name: "30-day patch activity" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Official patch source" })).toBeVisible();
    await expect(page.getByText("View all 30 claims", { exact: true })).toHaveCount(0);
    await expect(page.getByText("View all 2 claims", { exact: true })).toHaveCount(0);
    // Overpromising dashboard copy must be gone.
    await expect(page.getByText("none found yet — scanner active", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Watchlist awaiting evidence", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Watchlist · awaiting first reports", { exact: true })).toHaveCount(0);
    await expect(page.getByText("What can be learned without waiting for reports")).toHaveCount(0);
    await expect(page.getByText("Useful next clicks")).toHaveCount(0);
    await expect(page.getByText("Patch web radar", { exact: false })).toHaveCount(0);
    await expect(page.getByText("Patch brief", { exact: false })).toHaveCount(0);
    await expectHealthyPage(page, problems);
    if (hasPopulatedDashboard) {
      await expect(page).toHaveScreenshot("dashboard.png", { fullPage: true });
    }
  });

  test("dashboard stays within mobile viewports with production-length readouts", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chromium", "Mobile layout regression");
    const problems = collectConsoleProblems(page);

    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/");

      const topIssues = page.locator(".panel", {
        has: page.getByRole("heading", { name: "Top issues this patch" }),
      });
      const firstIssue = topIssues.locator("a.block").first();
      await expect(firstIssue).toBeVisible();
      await firstIssue.locator(".truncate").evaluate((element) => {
        element.textContent = "FPS / performance regression since 1.13.00";
      });
      await firstIssue.locator(".badge").evaluate((element) => {
        element.textContent = "Marked fixed by maintainer";
      });

      await expectHealthyPage(page, problems);
    }
  });

  test("web app manifest keeps public navigation inside one standalone scope", async ({ page }) => {
    await page.goto("/issues");

    const manifestLink = page.locator('link[rel="manifest"]');
    await expect(manifestLink).toHaveAttribute("href", "/manifest.webmanifest");
    const response = await page.request.get("/manifest.webmanifest");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/manifest+json");
    const manifest = (await response.json()) as {
      display: string;
      icons?: Array<{ sizes?: string; src?: string; type?: string }>;
      id: string;
      scope: string;
      start_url: string;
    };
    expect(manifest).toMatchObject({
      display: "standalone",
      id: "/",
      scope: "/",
      start_url: "/",
    });
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sizes: "192x192",
          src: "/brand/warrior-app-icon-192.png",
          type: "image/png",
        }),
        expect.objectContaining({ sizes: "512x512", src: "/icon.png", type: "image/png" }),
      ]),
    );
    const installIcon = await page.request.get("/brand/warrior-app-icon-192.png");
    expect(installIcon.status()).toBe(200);
    expect(installIcon.headers()["content-type"]).toContain("image/png");
    await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveAttribute("content", "yes");
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute(
      "content",
      "CD Report Hub",
    );
    await expect(page.locator('meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveAttribute(
      "content",
      "black",
    );

    const dashboardLink = page.getByRole("navigation", { name: "Primary" }).getByRole("link", {
      name: "Dashboard",
    });
    await expect(dashboardLink).toHaveAttribute("href", "/");
    await expect(dashboardLink).not.toHaveAttribute("target", "_blank");
  });

  test("dashboard audit-critical text meets AA contrast", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Crimson Desert Report Hub" })).toBeVisible();
    await expectContrastAtLeast(page, DASHBOARD_CONTRAST_TARGETS);
    await expectDesignTokenContrast(page);
    await expectHealthyPage(page, problems);
  });

  test("dashboard keeps app landmarks accessible and avoids material layout shift", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await startLayoutShiftObserver(page);
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Crimson Desert Report Hub" })).toBeVisible();
    await expectAccessibleLandmarks(page);
    await expectCumulativeLayoutShiftBelow(page);
    await expectHealthyPage(page, problems);
  });

  test("issue clusters show approved excerpts only", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.goto("/issues");

    await expect(page.getByRole("heading", { name: "What players are reporting" })).toBeVisible();
    const publicLinks = page.getByText("Links seen in the wild");
    if ((await publicLinks.count()) > 0) {
      await expect(publicLinks.first()).toBeVisible();
      await expect(page.getByRole("link", { name: "Open source" }).first()).toBeVisible();
      // Public cards never wear confidence chrome — that authority theater is gone.
      await expect(page.getByText("High confidence")).toHaveCount(0);
    } else {
      await expect(page.getByText(/Source candidates stay private until they are corroborated/)).toBeVisible();
      await expect(page.getByRole("link", { name: "Scanner funnel" })).toHaveAttribute("href", "/scanner");
      await expect(page.getByRole("link", { name: "Submit a report" })).toHaveAttribute("href", "/report");
    }
    await expect(page.locator(".badge").filter({ hasText: /^Confirmed$/ })).toHaveCount(0);
    await expect(page.getByText("private low confidence")).toHaveCount(0);
    await expect(page.getByText("Player-reported issues first.")).toBeVisible();
    // Overpromising watchlist copy must be gone: the scanner never claims per-row
    // active discovery, and zero-evidence seeds are never framed as live hunts.
    await expect(page.getByText("scanner is hunting", { exact: false })).toHaveCount(0);
    await expect(page.getByText("A cluster earns its full section", { exact: false })).toHaveCount(0);
    await expect(page.getByText("Seeing one of these? Report it", { exact: true })).toHaveCount(0);
    // The collapsed monitored line, when watchlist seeds exist, is a single muted
    // line — never a per-seed card. It reads "Monitoring N more known problem …".
    const monitoredLine = page.getByText(/Monitoring \d+ more known problem area/);
    if ((await monitoredLine.count()) > 0) {
      await expect(monitoredLine.first()).toBeVisible();
    }
    await expectHealthyPage(page, problems);
    await expect(page).toHaveScreenshot("issues.png", { fullPage: true });
  });

  test("a player can revise a fix-poll stance while raw totals stay server-authored", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.addInitScript(() => {
      window.localStorage.setItem("cd-confirm-00000000-0000-4000-8000-000000000002-1.13", "fixed_for_me");
    });
    await page.goto("/issues");

    const card = page.getByRole("article").filter({ hasText: "Map-open crash persists after fix" });
    await expect(card.getByRole("button", { name: /Fixed for me/ })).toHaveAttribute("aria-pressed", "false");
    await expect(card.getByRole("button", { name: /Still happening/ })).toHaveAttribute("aria-pressed", "false");
    await card.getByRole("button", { name: /Fixed for me/ }).click();
    await card.getByRole("button", { name: "PC (Steam)" }).click();
    await expect(card.getByText(/Recorded once per network per patch/)).toBeVisible();

    await expect(card.getByRole("button", { name: /Still happening/ })).toBeVisible();
    await card.getByRole("button", { name: /Still happening/ }).click();
    await expect(card.getByRole("button", { name: /Fixed for me/ })).toHaveAttribute("aria-pressed", "false");
    await expect(card.getByRole("button", { name: /Still happening/ })).toHaveAttribute("aria-pressed", "true");
    await card.getByRole("button", { name: "Base PS5", exact: true }).click();
    await expect(card.getByRole("button", { name: /Still happening/ })).toHaveAttribute("aria-pressed", "true");
    await expectHealthyPage(page, problems);
  });

  test("a read-only preview explains why a confirmation was not recorded", async ({ page }) => {
    await page.route("**/api/confirmations", async (route) => {
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ error: "preview_writes_disabled" }),
      });
    });
    await page.goto("/issues");

    const card = page.getByRole("article").filter({ hasText: "Map-open crash persists after fix" });
    await card.getByRole("button", { name: /Fixed for me/ }).click();
    await card.getByRole("button", { name: "PC (Steam)" }).click();

    await expect(card.getByText("This preview is read-only. Confirmations work on the production site.")).toBeVisible();
  });

  test("about page explains privacy and public source posture", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.goto("/about");

    await expect(page.getByRole("heading", { name: "About this tracker" })).toBeVisible();
    await expect(page.getByText(/Reports are evidence/)).toBeVisible();
    await expect(page.getByText(/Confirmations are signals/)).toBeVisible();
    await expect(page.getByText(/Source links are leads/)).toBeVisible();
    await expect(page.getByText(/public signals backed by separate sources|public chatter becomes evidence/i)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Public source" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Scanner page" })).toHaveAttribute("href", "/scanner");
    await expect(page.getByRole("link", { name: "View the source on GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/Statusnone420/Crimson-Desert-Report-Hub",
    );
    await expectHealthyPage(page, problems);
    await expect(page).toHaveScreenshot("about.png", { fullPage: true });
  });

  test("public scanner shows Source Radar without admin data", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.goto("/scanner");

    await expect(page.getByRole("heading", { name: "Scanner" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Source Radar" })).toBeVisible();
    await expect(page.getByText("Reviewed", { exact: true })).toBeVisible();
    await expect(page.getByText("Filtered", { exact: true })).toBeVisible();
    await expect(page.getByText("Awaiting corroboration", { exact: true })).toBeVisible();
    await expect(page.getByText("Published issues", { exact: true })).toBeVisible();
    await expect(page.getByText("Web search (Tavily)")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Questions from the radar" })).toBeVisible();
    await expect(page.getByText("Mount and input lockups")).toBeVisible();
    await expect(page.getByRole("button", { name: /I have this too/ })).toBeVisible();
    const scannerHtml = await page.content();
    expect(scannerHtml).not.toContain("Possible mount input lockup");
    expect(scannerHtml).not.toContain("Private mapped candidate used to prove public question rendering");
    expect(scannerHtml).not.toContain("forum.example.com");
    expect(scannerHtml).not.toContain("mount-input-rumor");
    await expect(page.getByText("Steam & forums")).toHaveCount(0);
    await expect(page.getByText("Review queue")).toHaveCount(0);
    await expect(page.getByText("Keep for review")).toHaveCount(0);
    await expect(page.getByText("Open source")).toHaveCount(0);
    await expect(page.getByText("Scan history")).toHaveCount(0);
    await expect(page.getByText("Scanner settings & budget")).toHaveCount(0);
    await expectHealthyPage(page, problems);
    await expect(page).toHaveScreenshot("scanner-public.png", { fullPage: true });
  });

  test("admin scanner leads with Source Radar and useful kept-signal links", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await signInAsAdmin(page);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "Report review" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Scanner monitor" })).toBeVisible();

    await page.goto("/scanner");
    await expect(page.getByRole("heading", { name: "Scanner monitor" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Source Radar" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent radar leads" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open source" }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Rejected archive" })).toBeVisible();
    await expect(page.getByLabel("Search recent archive")).toBeVisible();
    await page.getByLabel("Search recent archive").fill("off-topic, not a bug");
    await expect(page.getByText("New armor set locations guide")).toBeVisible();
    await expect(page.getByText("Patch 1.13 full notes mirror")).toHaveCount(0);
    await expect(page.getByRole("status")).toContainText("matching candidates");
    await page.getByLabel("Search recent archive").fill("");
    await expect(page.getByRole("button", { name: "Rescue" }).first()).toBeVisible();
    await expect(page.getByText("rescuing is optional, not homework", { exact: false })).toBeVisible();
    await expect(page.getByText("Scan history")).toBeVisible();
    await expect(page.getByText("Show raw scanner codes")).toBeHidden();
    await expect(page.getByText("Scanner settings & budget")).toBeVisible();
    await expect(page.getByText("Steam & forums")).toHaveCount(0);
    await expectHealthyPage(page, problems);
    await expect(page).toHaveScreenshot("scanner-admin.png", { fullPage: true });
  });

  test("admin footer routes through sign-in to the admin page", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.goto("/");

    await openAdminSignIn(page);
    await expect(page.getByLabel("Admin password")).toBeVisible();
    await expect(page.getByRole("link", { name: "Review reports" })).toHaveCount(0);
    // Keyboard activation, like openAdminSignIn: with the page scrolled to the very
    // bottom, mobile emulation offsets the visual viewport and skews click coordinates
    // into the field above the button (the dialog itself is fine on real devices).
    await page.getByRole("button", { name: "Cancel" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Admin password")).toHaveCount(0);

    await openAdminSignIn(page);
    await expect(page.getByLabel("Admin password")).toBeVisible();
    await page.getByLabel("Admin password").fill("admin-password");
    await page.getByRole("button", { name: "Sign in" }).focus();
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "Report review" })).toBeVisible();
    await page.goto("/");
    await openAdminPageFromFooter(page);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/admin\/login$/);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/login$/);
    await expectHealthyPage(page, problems);
  });

  test("report form submits to the success state", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.goto("/report");

    await expect(page.getByRole("heading", { name: "Submit a report" })).toBeVisible();
    await expect(page.getByText("Your report helps separate isolated bugs from patch-wide patterns.")).toBeVisible();
    await page.getByLabel("Platform").selectOption("pc_steam");
    await page.getByLabel("Category").selectOption("performance");
    await page.getByLabel("Severity").selectOption("high");
    await page.getByLabel("How often?").selectOption("often");
    await page.getByLabel("One-line summary").fill("FPS drops to 20 in open-field combat since 1.13");
    await page
      .getByLabel("What happened?")
      .fill("After patch 1.13, performance mode drops sharply during open-field combat and does not recover.");
    await page.getByText("Add technical detail Pearl Abyss can use").click();
    await page.getByLabel("Hardware (GPU, CPU, RAM)").fill("RTX 4060, Ryzen 5 7600, 32GB RAM");
    await page.getByRole("button", { name: "Submit report" }).click();

    await expect(page.getByRole("heading", { name: "Report received" })).toBeVisible();
    await expect(page.getByText("checked and sorted into the right issue automatically")).toBeVisible();
    await expectHealthyPage(page, problems);
    await expect(page).toHaveScreenshot("report-success.png", { fullPage: true });
  });

  test("report file pickers stay contained and visibly focusable on mobile", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chromium", "Mobile form regression");
    const problems = collectConsoleProblems(page);

    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/report");

      const fileInput = page.locator("#save_import");
      const folderInput = page.locator("#save_import_folder");
      for (const input of [fileInput, folderInput]) {
        await expect(input).toHaveAttribute("tabindex", "-1");
        const bounds = await input.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return { height: rect.height, width: rect.width };
        });
        expect(bounds).toEqual({ height: 1, width: 1 });
      }

      for (const name of ["Choose settings file", "Choose folder"]) {
        const picker = page.getByRole("button", { name });
        await picker.focus();
        await expect(picker).toBeFocused();
        const boxShadow = await picker.evaluate((element) => getComputedStyle(element).boxShadow);
        expect(boxShadow).not.toBe("none");
      }

      await expectHealthyPage(page, problems);
    }
  });

  test("local save import fills visible technical fields without uploading raw files", async ({ page }, testInfo) => {
    const problems = collectConsoleProblems(page);
    await page.goto("/report");
    await expect(page.getByText("Your browser cannot scan your PC.")).toBeVisible();
    await expect(page.getByText("user_engine_option_save.xml").first()).toBeVisible();
    await expect(page.getByText("Open File Explorer and search This PC for user_engine_option_save.xml.")).toBeVisible();
    await expect(page.getByText("If search finds nothing, skip this helper.")).toBeVisible();

    const saveFolder = testInfo.outputPath("save-folder");
    await mkdir(saveFolder, { recursive: true });
    const settingsPath = path.join(saveFolder, "user_engine_option_save.xml");
    await writeFile(settingsPath, settingsXml);

    await page.setInputFiles("#save_import", settingsPath);
    await page.getByText("Add technical detail Pearl Abyss can use").click();

    // Selecting files shows a preview but must NOT mutate the form until the user opts in.
    await expect(page.getByText("1 local file inspected in this browser.")).toBeVisible();
    await expect(page.getByText(/Preview.*nothing added yet/)).toBeVisible();
    await expect(page.getByLabel("Graphics mode / FPS setting")).toHaveValue("");

    // Applying the preview fills the visible technical fields.
    await page.getByRole("button", { name: "Add to report" }).click();
    await expect(page.getByText("Raw files are not uploaded").first()).toBeVisible();
    await expect(page.getByLabel("Graphics mode / FPS setting")).toHaveValue(
      "Upscaling: NVIDIA DLSS 4.0 (AA); Frame generation: on; VSync: off; HDR: on",
    );
    await expect(page.getByLabel("Troubleshooting you tried")).toHaveValue(
      /settings summary: Upscaling: NVIDIA DLSS 4.0 \(AA\)/,
    );
    await expectHealthyPage(page, problems);
    await expect(page).toHaveScreenshot("report-import.png", { fullPage: true });
  });
});
