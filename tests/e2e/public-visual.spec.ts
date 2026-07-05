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
  { selector: ".min-w-56 > .mt-1.text-xs", label: "scanner work summary" },
  { selector: ".min-w-56 > .mt-2.text-xs", label: "scanner preview note" },
  { selector: ".rounded-md.border.px-3:nth-child(1) > .mt-1.text-xs", label: "watchlist item 1 detail", optional: true },
  { selector: ".rounded-md.border.px-3:nth-child(2) > .mt-1.text-xs", label: "watchlist item 2 detail", optional: true },
  { selector: ".rounded-md.border.px-3:nth-child(3) > .mt-1.text-xs", label: "watchlist item 3 detail", optional: true },
  { selector: ".rounded-md.border.px-3:nth-child(4) > .mt-1.text-xs", label: "watchlist item 4 detail", optional: true },
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
      { label: "faint text on panel", fg: styles.getPropertyValue("--text-faint"), bg: styles.getPropertyValue("--panel") },
      { label: "faint text on inset panel", fg: styles.getPropertyValue("--text-faint"), bg: styles.getPropertyValue("--panel-2") },
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

    await expect(page).toHaveTitle(/Crimson Desert Report Hub/i);
    await expect(page.getByRole("heading", { name: "Crimson Desert report hub" })).toBeVisible();
    await expect(page.getByText("Community signals", { exact: true })).toBeVisible();
    await expect(page.getByText("Direct reports", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "AI scanner watching public sources" })).toBeVisible();
    await expect(page.getByText("scheduled scans on")).toBeVisible();
    await expect(page.getByText(/\d+ signals · \d+ reports/).first()).toBeVisible();
    await expect(page.getByText("2 signals · 6 reports")).toBeVisible();
    await expect(page.getByText("FPS regression since 1.13")).toBeVisible();
    await expect(page.getByText("Map-open crash persists after fix")).toBeVisible();
    await expectHealthyPage(page, problems);
    await expect(page).toHaveScreenshot("dashboard.png", { fullPage: true });
  });

  test("dashboard audit-critical text meets AA contrast", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Crimson Desert report hub" })).toBeVisible();
    await expectContrastAtLeast(page, DASHBOARD_CONTRAST_TARGETS);
    await expectDesignTokenContrast(page);
    await expectHealthyPage(page, problems);
  });

  test("dashboard keeps app landmarks accessible and avoids material layout shift", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await startLayoutShiftObserver(page);
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Crimson Desert report hub" })).toBeVisible();
    await expectAccessibleLandmarks(page);
    await expectCumulativeLayoutShiftBelow(page);
    await expectHealthyPage(page, problems);
  });

  test("issue clusters show approved excerpts only", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.goto("/issues");

    await expect(page.getByRole("heading", { name: "Issue clusters" })).toBeVisible();
    await expect(page.getByText("Community signals").first()).toBeVisible();
    await expect(page.getByText("Approved excerpts").first()).toBeVisible();
    await expect(page.getByText("High confidence")).toBeVisible();
    await expect(page.getByText("Confirmed")).toHaveCount(0);
    await expect(page.getByText("private low confidence")).toHaveCount(0);
    await expect(page.getByText("Raw submissions are never published.")).toBeVisible();
    await expectHealthyPage(page, problems);
    await expect(page).toHaveScreenshot("issues.png", { fullPage: true });
  });

  test("about page explains privacy and public source posture", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.goto("/about");

    await expect(page.getByRole("heading", { name: "About this tracker" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Public source" })).toBeVisible();
    await expect(page.getByRole("link", { name: "View the source on GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/Statusnone420/Crimson-Desert-Report-Hub",
    );
    await expectHealthyPage(page, problems);
    await expect(page).toHaveScreenshot("about.png", { fullPage: true });
  });

  test("owner console unlocks admin shortcuts", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.goto("/");

    await page.getByRole("button", { name: "Owner" }).click();
    await expect(page.getByLabel("Admin password")).toBeVisible();
    await page.getByLabel("Admin password").fill("admin-password");
    await page.getByRole("button", { name: "Unlock controls" }).click();

    await expect(page.getByRole("link", { name: "Moderation queue" })).toHaveAttribute("href", "/admin");
    await expect(page.getByRole("link", { name: "Source monitor" })).toHaveAttribute("href", "/admin/source-monitor");
    await expect(page.getByRole("link", { name: "Compile dossier" })).toHaveAttribute("href", "/admin/compile");
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

    await expect(page.getByRole("heading", { name: "Thanks for the clean signal." })).toBeVisible();
    await expect(page.getByText("Your report is in the moderation queue")).toBeVisible();
    await expectHealthyPage(page, problems);
    await expect(page).toHaveScreenshot("report-success.png", { fullPage: true });
  });

  test("local save import fills visible technical fields without uploading raw files", async ({ page }, testInfo) => {
    const problems = collectConsoleProblems(page);
    await page.goto("/report");
    const saveFolder = testInfo.outputPath("save-folder");
    await mkdir(saveFolder, { recursive: true });
    await writeFile(path.join(saveFolder, "user_engine_option_save.xml"), settingsXml);

    await page.setInputFiles("#save_import", saveFolder);
    await page.getByText("Add technical detail Pearl Abyss can use").click();

    await expect(page.getByText("1 local file inspected in this browser.")).toBeVisible();
    await expect(page.getByText("Raw files are not uploaded").first()).toBeVisible();
    await expect(page.getByLabel("Graphics mode / FPS setting")).toHaveValue(
      "NVIDIA DLSS 4.0 / AA / Frame Generation on / VSync off / HDR on",
    );
    await expect(page.getByLabel("Troubleshooting you tried")).toHaveValue(/settings XML parsed/);
    await expectHealthyPage(page, problems);
    await expect(page).toHaveScreenshot("report-import.png", { fullPage: true });
  });
});
