import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

function collectConsoleProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
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
        let current: Element | null = element;
        while (current) {
          const background = parseRgb(getComputedStyle(current).backgroundColor);
          if (background && background[3] > 0) {
            return [background[0], background[1], background[2]];
          }
          current = current.parentElement;
        }
        return [16, 17, 15];
      }

      return targets.flatMap((target) => {
        const elements = [...document.querySelectorAll(target.selector)];
        if (elements.length === 0) {
          return target.optional ? [] : [`${target.label}: selector not found (${target.selector})`];
        }
        return elements.flatMap((element, index) => {
          const color = parseRgb(getComputedStyle(element).color);
          if (!color) return [`${target.label}: foreground color could not be parsed`];
          const ratio = contrastRatio([color[0], color[1], color[2]], solidBackground(element));
          return ratio >= minimum
            ? []
            : [`${target.label}${elements.length > 1 ? ` #${index + 1}` : ""}: ${ratio.toFixed(2)} < ${minimum}`];
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
    await expect(nav.getByRole("link", { name: "Submit report" })).toHaveAttribute("href", "/report");
    await expect(nav.getByRole("link", { name: "About" })).toHaveAttribute("href", "/about");
    await expect(nav.getByRole("link", { name: "Scanner" })).toHaveAttribute("href", "/scanner");
    await expect(page.getByRole("heading", { name: "Crimson Desert Report Hub" })).toBeVisible();
    await expect(page.getByText("Right now", { exact: true })).toBeVisible();
    await expect(page.getByText(/Patch 1\.13\.\d{2}/).first()).toBeVisible();
    await expect(page.getByText("Evidence-backed issues", { exact: true })).toBeVisible();
    await expect(page.getByText("Awaiting corroboration", { exact: true })).toBeVisible();
    await expect(page.getByText(/latest player report \d+[mh] ago/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Source Radar" })).toHaveAttribute("href", "/scanner");
    await expect(page.getByRole("heading", { name: "Top issues this patch" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "30-day patch activity" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Official patch source" })).toBeVisible();
    await expect(page.getByText(/\d+ reports · \d+ signals/).first()).toBeVisible();
    await expect(page.getByText("6 reports · 2 signals")).toBeVisible();
    await expect(page.getByText("FPS regression since 1.13").first()).toBeVisible();
    await expect(page.getByText("Map-open crash persists after fix").first()).toBeVisible();
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
    await expect(page).toHaveScreenshot("dashboard.png", { fullPage: true });
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
    const communitySignals = page.getByText("Community signals");
    if ((await communitySignals.count()) > 0) {
      await expect(communitySignals.first()).toBeVisible();
      await expect(page.getByRole("link", { name: "Open source" }).first()).toBeVisible();
      await expect(page.getByText("High confidence")).toBeVisible();
    } else {
      await expect(page.getByText("Source candidates stay private until they clear the rules.")).toBeVisible();
      await expect(page.getByRole("link", { name: "Scanner funnel" })).toHaveAttribute("href", "/scanner");
      await expect(page.getByRole("link", { name: "Submit a report" })).toHaveAttribute("href", "/report");
    }
    await expect(page.getByText("Confirmed")).toHaveCount(0);
    await expect(page.getByText("private low confidence")).toHaveCount(0);
    await expect(page.getByText("Backed issues first.")).toBeVisible();
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

  test("about page explains privacy and public source posture", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.goto("/about");

    await expect(page.getByRole("heading", { name: "About this tracker" })).toBeVisible();
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
    await expect(page.getByText("Published", { exact: true })).toBeVisible();
    await expect(page.getByText("Web search (Tavily)")).toBeVisible();
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
    await page.goto("/");
    const adminButton = page.getByRole("button", { name: "Admin" });
    await adminButton.scrollIntoViewIfNeeded();
    await adminButton.focus();
    await page.keyboard.press("Enter");
    await page.getByLabel("Admin password").fill("admin-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "Report review" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Scanner monitor" })).toBeVisible();

    await page.goto("/scanner");
    await expect(page.getByRole("heading", { name: "Scanner monitor" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Source Radar" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent kept signals" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open source" }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Review queue" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Keep for review" }).first()).toBeVisible();
    await expect(page.getByText("Usually noise. Keep anything that is actually a player problem.")).toBeVisible();
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

    const adminButton = page.getByRole("button", { name: "Admin" });
    await adminButton.scrollIntoViewIfNeeded();
    await adminButton.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Admin password")).toBeVisible();
    await expect(page.getByRole("link", { name: "Review reports" })).toHaveCount(0);
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByLabel("Admin password")).toHaveCount(0);

    await adminButton.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Admin password")).toBeVisible();
    await page.getByLabel("Admin password").fill("admin-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "Report review" })).toBeVisible();
    await page.goto("/");
    await adminButton.scrollIntoViewIfNeeded();
    await adminButton.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/admin$/);
    await expectHealthyPage(page, problems);
  });

  test("report form submits to the success state", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.goto("/report");

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
