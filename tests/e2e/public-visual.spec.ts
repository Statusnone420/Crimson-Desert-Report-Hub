import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { collectConsoleProblems, expectHealthyPage, signInAsAdmin } from "./helpers";

async function openAdminSignIn(page: Page) {
  const passwordInput = page.getByLabel("Admin password");
  const adminButton = page.getByRole("contentinfo").getByRole("button", { name: "Admin" });
  await expect(adminButton).toBeVisible();
  await adminButton.press("Enter", { timeout: 10_000 });
  await expect(passwordInput).toBeVisible();
}

async function openAdminPageFromFooter(page: Page) {
  const adminButton = page.getByRole("contentinfo").getByRole("button", { name: "Admin" });
  await expect(adminButton).toBeVisible();
  await adminButton.press("Enter", { timeout: 10_000 });
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

const E2E_NOW = new Date("2026-07-20T00:10:00.000Z");

type ContrastTarget = {
  selector: string;
  label: string;
  optional?: boolean;
};

const DASHBOARD_CONTRAST_TARGETS: ContrastTarget[] = [
  { selector: '.dispatch-nav__link[aria-current="page"]', label: "active nav link" },
  { selector: ".dispatch-kicker", label: "section kickers" },
  { selector: ".brief-lead__meta", label: "lead meta line", optional: true },
  { selector: ".pulse-stat__caption", label: "pulse stat captions" },
  { selector: "#context .mono-label", label: "Platform Pulse provider labels", optional: true },
  { selector: "#context .context-card__stats span", label: "Platform Pulse stat labels", optional: true },
  { selector: "#context .context-card__facts dt", label: "Platform Pulse fact labels", optional: true },
  { selector: ".record-block__toc-row", label: "edition toc rows", optional: true },
  { selector: ".dispatch-footer__note", label: "footer note" },
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
    const canvas = styles.getPropertyValue("--dispatch-bg");
    const inset = styles.getPropertyValue("--dispatch-inset");
    const checks = [
      { label: "dim ink on canvas", fg: styles.getPropertyValue("--dispatch-dim"), bg: canvas },
      { label: "muted ink on canvas", fg: styles.getPropertyValue("--dispatch-muted"), bg: canvas },
      { label: "faint ink on canvas", fg: styles.getPropertyValue("--dispatch-faint"), bg: canvas },
      { label: "quiet ink on canvas", fg: styles.getPropertyValue("--dispatch-quiet"), bg: canvas },
      { label: "ghost ink on canvas", fg: styles.getPropertyValue("--dispatch-ghost"), bg: canvas },
      { label: "quiet ink on inset", fg: styles.getPropertyValue("--dispatch-quiet"), bg: inset },
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
  test.beforeEach(async ({ page }) => {
    await page.clock.install({ time: E2E_NOW });
  });

  test("dashboard renders moderated patch intelligence", async ({ page }, testInfo) => {
    // The desktop composition; the sub-900 brief is a separate composition
    // covered by the mobile-viewport test below.
    test.skip(testInfo.project.name !== "chromium", "Desktop composition");
    const problems = collectConsoleProblems(page);
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Primary" });

    await expect(page).toHaveTitle(/Crimson Desert Report Hub/i);
    // Editorial Dispatch nav: full labels on desktop, short labels below 900px.
    await expect(nav.getByRole("link", { name: /^(THE )?BRIEF$/ })).toHaveAttribute("href", "/");
    await expect(nav.getByRole("link", { name: /^(ISSUE BOARD|ISSUES)$/ })).toHaveAttribute("href", "/issues");
    await expect(nav.getByRole("link", { name: /^(FILE A REPORT →|REPORT)$/ })).toHaveAttribute("href", "/report");
    await expect(nav.getByRole("link", { name: "OBSERVATORY" })).toHaveAttribute("href", "/scanner");
    // Masthead: the identity is typographic; edition and dateline are real data.
    await expect(page.getByRole("heading", { name: "Crimson Desert Report Hub" })).toBeVisible();
    await expect(page.getByText("A field report on the current state of the game")).toBeVisible();
    await expect(page.getByText(/EDITION №\d+/)).toBeVisible();
    // Lead: useful patch consequence first; scarcity counts remain lower on the page.
    await expect(page.getByText(/PATCH 1\.13\.01 · HOTFIX · DAY \d+/)).toBeVisible();
    await expect(page.getByRole("heading", { name: /Map-open crash persists after fix/i })).toBeVisible();
    await expect(page.getByText("What changed", { exact: true })).toBeVisible();
    await expect(page.getByText("What appears broken", { exact: true })).toBeVisible();
    await expect(page.getByText("What to check", { exact: true })).toBeVisible();
    // The Record rail.
    await expect(page.getByText("The Record", { exact: true })).toBeVisible();
    await expect(page.getByText("Current patch", { exact: true })).toBeVisible();
    await expect(page.getByText("1 of 2 contested")).toBeVisible();
    await expect(page.getByRole("link", { name: /pearlabyss\.com/ })).toHaveAttribute("href", /pearlabyss\.com/);
    await expect(page.getByText("In This Edition", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /The claims record/ })).toHaveAttribute("href", "#claims");
    // 01 · Patch Pulse: diverging chart — evidence above the axis, radar
    // intelligence below, four separately labeled series plus text restatement.
    await expect(page.getByText("01 · Patch Pulse")).toBeVisible();
    await expect(page.getByRole("img", { name: /Daily activity across \d+ days?/ })).toBeVisible();
    await expect(page.getByText("structured reports", { exact: true })).toBeVisible();
    await expect(page.getByText("player taps", { exact: true })).toBeVisible();
    await expect(page.getByText("new leads", { exact: true })).toBeVisible();
    await expect(page.getByText("re-observations", { exact: true })).toBeVisible();
    const pulseData = page.locator('table[aria-label^="Daily activity by day"]');
    await expect(pulseData).toHaveCount(1);
    await expect(pulseData.locator("tbody tr")).not.toHaveCount(0);
    await expect(pulseData.locator("thead th")).toHaveCount(5);
    await expect(page.getByText(/Public leads kept by the radar this week/)).toBeVisible();
    // 02 · The Radar: aggregate scanner intelligence, labeled, never evidence,
    // and never leaking a private candidate's title, URL, or domain.
    await expect(page.getByText("02 · The Radar")).toBeVisible();
    await expect(page.getByText("New leads · 7d")).toBeVisible();
    await expect(page.getByText("Re-observations · 7d")).toBeVisible();
    await expect(page.getByText("Public-source intelligence, counted in aggregate. Never player evidence.")).toBeVisible();
    // The radar screen: polar working-set field, position first, hues redundant.
    await expect(page.getByRole("img", { name: /Radar screen: \d+ tracked leads?/ })).toBeVisible();
    await expect(page.getByText(/Recency from center: latest scan/i)).toBeVisible();
    await expect(page.locator(".radar-screen text").filter({ hasText: "TRACKED" })).toHaveCount(0);
    await expect(page.locator('.radar-screen [data-recency-band="under_6h"]').first()).toBeVisible();
    await expect(page.locator('.radar-screen [data-recency-band="1_3d"]').first()).toBeVisible();
    await expect(page.getByRole("list", { name: "Tracked leads ranked by problem area" })).toBeVisible();
    // Season almanac: one ramp per register, never blended.
    await expect(page.getByRole("img", { name: /Season calendar, evidence row/ })).toBeVisible();
    await expect(page.getByRole("img", { name: /Season calendar, radar row/ })).toBeVisible();
    const homepageHtml = await page.content();
    expect(homepageHtml).not.toContain("Possible mount input lockup");
    expect(homepageHtml).not.toContain("forum.example.com");
    expect(homepageHtml).not.toContain("mount-input-rumor");
    // Issue board: top three by the existing evidence-strength order. Section
    // numbers close ranks when the optional Platform Pulse is absent.
    await expect(page.locator("#board").getByText(/^\d{2} · The Issue Board$/)).toBeVisible();
    await expect(page.getByRole("link", { name: /All \d+ published issues →/ })).toHaveAttribute("href", "/issues");
    await expect(page.getByRole("heading", { name: "FPS regression since 1.13" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Map-open crash persists after fix" })).toBeVisible();
    await expect(page.getByText(/\d+ rpt · \d+ tap/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Happening to me/ })).toBeVisible();
    // Claims record: verbatim official text; verdicts only where the data ties them.
    await expect(page.locator("#claims").getByText(/^\d{2} · The Claims Record$/)).toBeVisible();
    await expect(
      page.getByText("Fixed an issue where opening the world map could crash or freeze the client."),
    ).toBeVisible();
    await expect(page.getByText("1 fixed for me")).toBeVisible();
    await expect(page.getByText("2 still happening")).toBeVisible();
    // One shared status line replaces the per-row dates when quiet claims share
    // a claim date; the counting rule deep-links to its Method definition.
    const claimsIntro = page.locator("#claims .claims-intro");
    await expect(claimsIntro).toContainText(
      /Players have answered 1 of these 2 claims; the other one has no verdicts yet/,
    );
    await expect(claimsIntro).toContainText("Only taps made after");
    await expect(claimsIntro).not.toContainText(/clock|running since/i);
    await expect(claimsIntro.getByRole("link", { name: "count toward a claim" })).toHaveAttribute(
      "href",
      "/about#player-verdicts",
    );
    // Desktop shows every row, so quiet rows carry no repeated date; their
    // mobile-only marker stays hidden at this width — asserted on computed
    // display so a dropped media rule fails here, not in production.
    await expect(page.locator("#claims .verdict-quiet").filter({ visible: true })).toHaveCount(0);
    expect(
      await page
        .locator("#claims .verdict-quiet")
        .first()
        .evaluate((element) => getComputedStyle(element).display),
    ).toBe("none");
    // Claims group under the source's own section headings — verbatim,
    // desktop-only — and a capped register says so instead of passing the
    // stored rows off as the whole list.
    const groupLabels = page.locator("#claims .claim-group__label");
    await expect(groupLabels).toHaveCount(2);
    await expect(groupLabels.nth(0)).toHaveText("Content");
    await expect(groupLabels.nth(1)).toHaveText("Graphics / Settings");
    await expect(groupLabels.nth(0)).toBeVisible();
    await expect(claimsIntro).toContainText("Showing the first 2 of 5 official fixes.");
    // Lead-band counts speak the stored register; the cap line above is the
    // one surface that discloses the larger source total.
    await expect(page.getByText("Pearl Abyss lists 2 claimed fixes.")).toBeVisible();
    // The source's bracket tag renders as an overline chip: tag characters
    // above the quote, no bracket punctuation, untagged rows chip-free.
    const claimTags = page.locator("#claims .claim-tag");
    await expect(claimTags).toHaveCount(1);
    await expect(claimTags.first()).toHaveText("PS5");
    await expect(claimTags.first()).toBeVisible();
    await expect(page.locator("#claims")).not.toContainText("[PS5]");
    // From the wire: dated coverage only, dated by the SOURCE, never by the scanner.
    await expect(page.locator("#wire").getByText(/^\d{2} · From The Wire$/)).toBeVisible();
    await expect(page.getByText("Vetted coverage on 1.13.01, dated by the source.")).toBeVisible();
    await expect(
      page.getByText("Crimson Desert 1.13.01 hotfix tested: smoother, but not settled"),
    ).toBeVisible();
    await expect(page.locator("#wire").getByText(/dsogaming\.com · JUL \d+/)).toBeVisible();
    // Discovery-time phrasing and radar telemetry stay out of the wire.
    await expect(page.locator("#wire").getByText(/ago/)).toHaveCount(0);
    await expect(page.locator("#wire").getByText(/seen \d+×/)).toHaveCount(0);
    // Community asks: a first-class lane of their own, never mixed with coverage.
    await expect(page.locator("#asks").getByText(/^\d{2} · Community Asks$/)).toBeVisible();
    await expect(page.getByText("What players are asking Pearl Abyss for — requests, not bug reports.")).toBeVisible();
    await expect(
      page.locator("#asks").getByText("Day 20 of asking to add caracals to the desert : r/CrimsonDesert"),
    ).toBeVisible();
    await expect(page.locator("#asks").getByText("seen 6×")).toBeVisible();
    await expect(page.locator("#wire").getByText("Day 20 of asking")).toHaveCount(0);
    // The date gate: undated items never render publicly, however fresh.
    await expect(page.getByText("Undated Crimson Desert 1.13.01 mirror must stay off the public wire")).toHaveCount(0);
    await expect(page.getByText("Older patch observation should never appear in the current brief")).toHaveCount(0);
    // Reject-and-teach hides are a visibility act the public lanes must honor.
    await expect(page.getByText("Hidden Crimson Desert ask stays off the public lanes")).toHaveCount(0);
    // Observatory footnote: the page's only box; scanner analytics stay off the homepage.
    await expect(page.getByText("From the Observatory")).toBeVisible();
    await expect(page.getByRole("link", { name: "Visit the Observatory →" })).toHaveAttribute("href", "/scanner");
    await expect(page.getByTestId("observatory-workspace")).toHaveCount(0);
    await expect(page.getByText("Radar yield", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("tab")).toHaveCount(0);
    // Dispatch guardrails: no cards, pills, or metric strips on the brief.
    await expect(page.locator(".panel, .badge, .chip, .metric-card, .metric-strip")).toHaveCount(0);
    await expectHealthyPage(page, problems);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.addStyleTag({
      content: "*,*::before,*::after { animation: none !important; transition: none !important; }",
    });
    const dashboardScreenshot = await page.screenshot({ fullPage: true });
    await page.screenshot({ path: "test-results/dashboard-buffer-debug.png", fullPage: true });
    expect(dashboardScreenshot).toMatchSnapshot("dashboard.png", { maxDiffPixelRatio: 0.02 });
  });

  test("dashboard reflows through intermediate desktop widths", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Intermediate desktop composition");
    const problems = collectConsoleProblems(page);

    await page.setViewportSize({ width: 960, height: 900 });
    await page.goto("/");
    const portraitLayout = await page.evaluate(() => {
      const grid = document.querySelector("#radar .radar-grid--screen")?.getBoundingClientRect();
      const screen = document.querySelector("#radar .radar-screen-wrap")?.getBoundingClientRect();
      const main = document.querySelector("#radar .radar-main")?.getBoundingClientRect();
      if (!grid || !screen || !main) return null;
      return {
        gridCenter: grid.left + grid.width / 2,
        mainTop: main.top,
        mainWidth: main.width,
        screenBottom: screen.bottom,
        screenCenter: screen.left + screen.width / 2,
      };
    });
    expect(portraitLayout).not.toBeNull();
    expect(Math.abs((portraitLayout?.gridCenter ?? 0) - (portraitLayout?.screenCenter ?? 0))).toBeLessThanOrEqual(1);
    expect(portraitLayout?.mainTop ?? 0).toBeGreaterThan((portraitLayout?.screenBottom ?? 0) + 20);
    expect(portraitLayout?.mainWidth ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(721);
    await expectHealthyPage(page, problems);

    await page.setViewportSize({ width: 1152, height: 960 });
    await page.goto("/");
    const desktopLayout = await page.evaluate(() => {
      const section = document.querySelector("#radar")?.getBoundingClientRect();
      const screen = document.querySelector("#radar .radar-screen-wrap")?.getBoundingClientRect();
      const main = document.querySelector("#radar .radar-main")?.getBoundingClientRect();
      const caption = document.querySelector("#radar .radar-screen-caption");
      const claimsIntro = document.querySelector("#claims .claims-intro");
      const rowQuiet = document.querySelector("#claims .verdict-quiet");
      if (!section || !screen || !main || !caption || !claimsIntro || !rowQuiet) return null;
      return {
        captionFontSize: Number.parseFloat(getComputedStyle(caption).fontSize),
        captionTransform: getComputedStyle(caption).textTransform,
        claimsIntroTransform: getComputedStyle(claimsIntro).textTransform,
        // The #claims .verdict-quiet override must keep the row line and the
        // quiet marker out of uppercase mono shouting.
        rowQuietTransform: getComputedStyle(rowQuiet).textTransform,
        mainLeft: main.left,
        mainTop: main.top,
        screenRight: screen.right,
        screenTop: screen.top,
        sectionHeight: section.height,
      };
    });
    expect(desktopLayout).not.toBeNull();
    expect(Math.abs((desktopLayout?.screenTop ?? 0) - (desktopLayout?.mainTop ?? 0))).toBeLessThanOrEqual(1);
    expect(desktopLayout?.mainLeft ?? 0).toBeGreaterThan((desktopLayout?.screenRight ?? 0) + 24);
    expect(desktopLayout?.sectionHeight ?? Number.POSITIVE_INFINITY).toBeLessThan(1_100);
    expect(desktopLayout?.captionFontSize ?? 0).toBeGreaterThanOrEqual(11);
    expect(desktopLayout?.captionTransform).toBe("none");
    expect(desktopLayout?.claimsIntroTransform).toBe("none");
    expect(desktopLayout?.rowQuietTransform).toBe("none");
    await expectHealthyPage(page, problems);

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.addStyleTag({
      content: "*,*::before,*::after { animation: none !important; transition: none !important; }",
    });
    await expect(page).toHaveScreenshot("dashboard-intermediate.png", {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });

  test("dashboard stays within mobile viewports with production-length readouts", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chromium", "Mobile layout regression");
    const problems = collectConsoleProblems(page);

    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/");

      // Separately composed mobile brief: fact strip, pulse, tappable lead story.
      await expect(page.getByText(/\d+ reports/).first()).toBeVisible();
      await expect(page.getByText("01 · Patch Pulse")).toBeVisible();
      await expect(page.getByRole("button", { name: /Happening to me/ })).toBeVisible();
      // The one claim row this width renders must state which side of the
      // section line it is on — a verdict bar or its own quiet marker.
      const visibleClaimRow = page.locator("#claims .claim-row:not(.claim-row--overflow)");
      await expect(visibleClaimRow).toHaveCount(1);
      await expect(visibleClaimRow.locator(".verdict-bar, .verdict-quiet").first()).toBeVisible();
      // The quiet-row marker's own display is unsuppressed below 900px even
      // inside a hidden overflow row — the fixture's visible row carries a
      // bar, so this is the only way to exercise the marker's media rule.
      expect(
        await page
          .locator("#claims .verdict-quiet")
          .first()
          .evaluate((element) => getComputedStyle(element).display),
      ).toBe("block");
      // Section labels are desktop furniture: this width renders one row, and
      // a group label would point at rows the cut hides.
      await expect(page.locator("#claims .claim-group__label").filter({ visible: true })).toHaveCount(0);
      expect(
        await page
          .locator("#claims .claim-group__label")
          .first()
          .evaluate((element) => getComputedStyle(element).display),
      ).toBe("none");
      // The bracket-tag chip is row-local metadata, not group furniture: it
      // stays with its claim at every width.
      await expect(visibleClaimRow.locator(".claim-tag")).toHaveText("PS5");
      await expect(visibleClaimRow.locator(".claim-tag")).toBeVisible();
      const tapBounds = await page.getByRole("button", { name: /Happening to me/ }).boundingBox();
      expect(tapBounds && tapBounds.height >= 44 ? "tall enough" : `too short: ${tapBounds?.height}`).toBe(
        "tall enough",
      );

      await expectHealthyPage(page, problems);

      // The longest tag the splitter accepts is 40 characters, and nothing
      // guarantees a space to break at. Those glyphs are wider than the 320px
      // column, so the chip has to wrap rather than push the page sideways.
      await visibleClaimRow.locator(".claim-tag").evaluate((element) => {
        element.textContent = "OongkaDamianeKhaleedRustyGauntletBossFix";
      });
      await expectHealthyPage(page, problems);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.addStyleTag({
      content: "*,*::before,*::after { animation: none !important; transition: none !important; }",
    });
    await expect(page).toHaveScreenshot("dashboard.png", { fullPage: true, maxDiffPixelRatio: 0.02 });
  });

  test("dashboard announces browser-local deltas for a returning visitor", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "cdReportHub.lastVisitAt",
        new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      );
    });
    await page.goto("/");

    await expect(page.getByText(/Since your last visit \(/)).toBeVisible();
    await expect(page.getByText("Remembered by this browser only.")).toBeVisible();
    await expectHealthyPage(page, problems);
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
      name: /^(THE )?BRIEF$/,
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
    await expect(page.getByText(/Issue Board · Patch 1\.13\.01/i)).toBeVisible();
    const publicLinks = page.getByText(/Links? seen in the wild/);
    if ((await publicLinks.count()) > 0) {
      // Below 900px the links rail sits behind a disclosure; open it first.
      const disclosure = page.locator("details.issue-rail__details summary").first();
      if (await disclosure.isVisible().catch(() => false)) {
        await disclosure.click();
      }
      await expect(publicLinks.filter({ visible: true }).first()).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Open source" }).filter({ visible: true }).first(),
      ).toBeVisible();
      // Public entries never wear confidence chrome — that authority theater is gone.
      await expect(page.getByText("High confidence")).toHaveCount(0);
    } else {
      await expect(page.getByText(/Leads stay private until they are corroborated/)).toBeVisible();
      await expect(page.getByRole("link", { name: "Scanner funnel" })).toHaveAttribute("href", "/scanner");
      await expect(page.getByRole("link", { name: "File a report" })).toHaveAttribute("href", "/report");
    }
    // Dispatch guardrails: no pills or cards anywhere on the board.
    await expect(page.locator(".badge, .chip, .panel, .metric-card")).toHaveCount(0);
    await expect(page.getByText("private low confidence")).toHaveCount(0);
    await expect(page.getByText("the board never fills in blanks", { exact: false })).toBeVisible();
    // Overpromising watchlist copy must be gone: the scanner never claims per-row
    // active discovery, and zero-evidence seeds are never framed as live hunts.
    await expect(page.getByText("scanner is hunting", { exact: false })).toHaveCount(0);
    await expect(page.getByText("A cluster earns its full section", { exact: false })).toHaveCount(0);
    await expect(page.getByText("Seeing one of these? Report it", { exact: true })).toHaveCount(0);
    // The collapsed monitored line, when watchlist seeds exist, is a single muted
    // line — never a per-seed card. It reads "Monitoring N additional watchlist issues."
    const monitoredLine = page.getByText(/Monitoring \d+ additional watchlist issues?\./);
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

    await expect(page.getByRole("heading", { name: "How this tracker thinks" })).toBeVisible();
    await expect(page.getByText(/Reports are evidence/).first()).toBeVisible();
    await expect(page.getByText(/Confirmations are signals/).first()).toBeVisible();
    await expect(page.getByText(/Source links are leads/).first()).toBeVisible();
    await expect(page.getByText(/public signals backed by separate sources|public chatter becomes evidence/i)).toHaveCount(0);
    // The manual-review overpromise must not ship: excerpts can be neutral auto-summaries.
    await expect(page.getByText(/reviewed by a moderator before any excerpt/)).toHaveCount(0);

    // Method is the canonical reference the rest of the site points at. Rows
    // stay closed, and each one answers in its summary — so a deep link that
    // lands on a collapsed row still reads without being opened.
    const rows = page.locator(".method-row");
    await expect(rows).toHaveCount(7);
    for (const anchor of ["player-verdicts", "radar", "freshness", "privacy", "quiet", "source", "official-support"]) {
      const row = page.locator(`#${anchor}`);
      await expect(row).not.toHaveAttribute("open", /.*/);
      await expect(row.locator(".method-row__say")).toBeVisible();
    }
    // The footer links to #privacy from every page.
    await expect(page.locator("#privacy")).toBeVisible();

    // Opening a row reveals its detail, including the cross-links that live there.
    await page.locator("#player-verdicts .method-row__q").click();
    await expect(page.locator("#player-verdicts .method-row__more")).toBeVisible();
    await page.locator("#player-verdicts .method-row__q").click();

    await page.locator("#radar .method-row__q").click();
    await expect(page.locator("#radar").getByRole("link", { name: "Observatory" })).toHaveAttribute(
      "href",
      "/scanner",
    );
    await page.locator("#radar .method-row__q").click();
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

    await expect(page.getByRole("heading", { name: "How the radar reads the web" })).toBeVisible();
    await expect(page.getByText("The Observatory · Public source radar")).toBeVisible();
    await expect(page.getByText(/Scanner scheduled|Scanner paused/)).toBeVisible();
    // Flow and stock never share a row: the week's partition must visibly add
    // up in the bar, and the working set carries explicit units.
    await expect(page.getByText("This week · the candidate flow")).toBeVisible();
    await expect(page.getByText(/\d+ candidates? reviewed in the last 7 days/)).toBeVisible();
    await expect(page.getByText("Right now · the working set")).toBeVisible();
    await expect(page.getByText("Tracked leads", { exact: true })).toBeVisible();
    await expect(page.getByText("Problem areas", { exact: true })).toBeVisible();
    await expect(page.getByText("Published issues", { exact: true })).toBeVisible();
    await expect(page.getByText("every public candidate lands in one of these four states")).toHaveCount(0);
    await expect(page.getByText("Awaiting corroboration", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Web search (Tavily)")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Questions from the radar" })).toBeVisible();
    await expect(page.getByText("Mount and input lockups")).toBeVisible();
    await expect(page.getByRole("button", { name: /Happening to me/ })).toBeVisible();
    // The section note carries the register once; per-question rows keep only their counts.
    await expect(page.getByText("Leads do not change its evidence count.")).toHaveCount(0);
    // One merged Privacy & publishing band replaces the Display-rule + three-column method repeat.
    await expect(page.getByRole("heading", { name: "Privacy & publishing" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Read the method ↗" })).toHaveAttribute("href", "/about#source");
    await expect(page.getByRole("heading", { name: "Privacy", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Published links" })).toHaveCount(0);
    // One ranked working-set view replaces the repeated scatterplot and sparkline families.
    await expect(page.getByRole("heading", { name: "Ranked problem areas" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Tracked leads ranked by problem area" })).toBeVisible();
    await expect(page.getByText(/Real publication dates: \d+\/\d+/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Context, not evidence" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Review count/ })).toBeVisible();
    await expect(page.getByRole("img", { name: /Review volume across \d+ recorded snapshots/ })).toBeVisible();
    await expect(page.getByRole("img", { name: /Positive share across \d+ recorded snapshots/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Release and Twitch interest" })).toBeVisible();
    await expect(page.getByText("PlayStation 5", { exact: false })).toBeVisible();
    await expect(page.getByRole("link", { name: "View on IGDB ↗" })).toHaveAttribute(
      "href",
      "https://www.igdb.com/games/crimson-desert",
    );
    await expect(page.getByText("24h peak", { exact: true })).toBeVisible();
    await expect(page.getByText("24h low", { exact: true })).toBeVisible();
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
    await expect(page.getByRole("heading", { name: "Today's radar desk" })).toBeVisible();
    await expect(page.getByText("Operator · The Observatory")).toBeVisible();
    await expect(page.getByText(/radar yield/i)).toBeVisible();
    await expect(page.getByText("New leads · 24h")).toBeVisible();
    await expect(page.getByText("Re-observed · 24h")).toBeVisible();
    await expect(page.getByText(/candidates reviewed/)).toBeVisible();
    await expect(page.getByText("Action inbox", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Nothing requires intervention." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Review the pattern, not a dropdown farm." })).toBeVisible();
    // Records are a ledger, not work: the heading and its count stay visible,
    // and every card inside is one click away.
    await expect(page.getByRole("heading", { name: "What the scanner kept" })).toBeVisible();
    await expect(page.locator("#records .operator-section__count")).toContainText("newest");
    // Five lane items this patch, but one is undated and one the operator
    // already rejected. Both stay in the list with an Undo; neither can reach
    // the Brief, so neither may be counted as publishable. The count is also
    // labelled a window, because the read stops at 40.
    await expect(page.locator("#lanes .operator-section__count")).toContainText(
      "newest 5 this patch · 3 publishable",
    );
    await page.locator("#records details.operator-section > summary").click();
    await expect(page.getByRole("link", { name: "Open source" }).first()).toBeVisible();
    const teachingSearch = page.getByRole("searchbox", { name: "Search optional scanner review" });
    await expect(teachingSearch).toBeVisible();
    await teachingSearch.fill("not sortable into a bug area");
    await expect(page.getByText("New armor set locations guide")).toBeVisible();
    await expect(page.getByText("Patch 1.13 full notes mirror")).toHaveCount(0);
    await expect(page.getByText("2 matches", { exact: true })).toBeVisible();
    await teachingSearch.fill("");
    await expect(page.getByRole("button", { name: "Keep as relevant" }).first()).toBeVisible();
    await expect(page.getByText("Reject and teach…").first()).toBeVisible();
    await expect(page.getByText("Scan history and diagnostics")).toBeVisible();
    await expect(page.getByText("Raw funnel, skip, and error codes")).toBeHidden();
    await expect(page.getByText("Scanner cadence and budget")).toBeVisible();
    await expect(page.getByRole("heading", { name: "What the scanner will remember" })).toBeVisible();
    await expect(page.getByText(/auto-rejected pages are not assignments/i)).toBeVisible();
    await expect(page.getByText(/Reddit API OFF/i)).toHaveCount(0);
    await expect(page.getByText("Steam & forums")).toHaveCount(0);
    await expectHealthyPage(page, problems);
    await expect(page).toHaveScreenshot("scanner-admin.png", { fullPage: true });
  });

  test("operator report review and compile surfaces wear the console chrome", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Operator surfaces are desktop-first");
    const problems = collectConsoleProblems(page);
    await signInAsAdmin(page);

    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Report review" })).toBeVisible();
    await expect(page.getByText("Operator console · signed in")).toBeVisible();
    await expect(page.getByText("Needs you")).toBeVisible();
    // The mock queue carries one pending report: the real Approve/Reject/Spam contract renders.
    await expect(page.getByText("Pending visual test report")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reject" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Spam" })).toBeVisible();
    await expect(page.getByText("Lifecycle exceptions")).toBeVisible();
    await expect(page.getByText("Visibility overrides")).toBeVisible();
    await expect(page.getByText("Current patch override")).toBeVisible();
    const visibilityLedger = page.locator("details").filter({
      has: page.getByText("Visibility overrides", { exact: true }),
    }).first();
    await visibilityLedger.locator(":scope > summary").click();
    await expect(
      visibilityLedger.getByRole("heading", { name: "Constant graphics glitches on Xbox since patch 1.13" }),
    ).toBeVisible();
    await expect(visibilityLedger.getByText(/Temporary duplicate hold/)).toBeVisible();
    await expect(visibilityLedger.getByRole("button", { name: "Reset to automatic" })).toBeVisible();

    const createOverride = visibilityLedger.locator('details[aria-label="Create visibility override"]');
    await createOverride.locator(":scope > summary").click();
    await expect(createOverride.locator(".override-create")).toHaveCount(0);
    await expect(createOverride.getByText(/Automatic records stay out of the page until you search/)).toBeVisible();
    await createOverride.getByRole("searchbox", { name: "Issue title" }).fill("FPS regression");
    await expect(createOverride.getByText("1 matching issues.")).toBeVisible();
    await expect(createOverride.locator(".override-create")).toHaveCount(1);
    await expect(createOverride.getByText("FPS regression since 1.13", { exact: true })).toBeVisible();
    // Session copy must state the absolute TTL, never "after inactivity".
    await expect(page.getByText(/after inactivity/)).toHaveCount(0);
    await expect(page.getByText(/12 hours after sign-in/)).toBeVisible();
    // The skip link must become visible on focus. Any unlayered .sr-only rule
    // in globals.css would beat Tailwind's layered focus:not-sr-only reset and
    // silently keep it a 1x1 clipped box on every route.
    const skipLink = page.getByRole("link", { name: "Skip to content" });
    expect((await skipLink.boundingBox())?.height ?? 99).toBeLessThan(5);
    await skipLink.focus();
    await expect(skipLink).toBeFocused();
    expect((await skipLink.boundingBox())?.height ?? 0).toBeGreaterThan(10);
    await skipLink.blur();

    // Phase 4 skeleton: neutral status wording that does not invent decision
    // provenance, an itemized Needs you caption, and a scope line stating each
    // write before submit.
    await expect(page.getByText("Approved reports", { exact: true })).toBeVisible();
    await expect(page.getByText("Currently approved", { exact: true })).toBeVisible();
    await expect(page.getByText("Currently marked spam", { exact: true })).toBeVisible();
    await expect(page.getByText("Auto-sorted")).toHaveCount(0);
    await expect(page.getByText(/auto-sort reason/)).toHaveCount(0);
    await expect(page.getByText(/Approve.*marks the report approved/)).toBeVisible();
    await expect(page.getByText(/there is no rendered excerpt retry/)).toBeVisible();
    await expect(page.getByText(/recomputes every signal's visibility in the same action/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" })).toBeVisible();
    await expectHealthyPage(page, problems);
    await expect(page).toHaveScreenshot("admin-review.png", { fullPage: true });

    // The export confirm gate: the utility names its payload before anything
    // downloads, Download still hits the real route, and all three close paths
    // (download, cancel, Escape) put the strip away. Runs after the screenshot
    // so the baseline stays the collapsed state.
    await page.getByRole("button", { name: "Export CSV" }).click();
    await expect(page.getByText("Export all report-review rows?")).toBeVisible();
    // The disclosure names the sensitive fields leaving the system and the
    // two hash columns that deliberately never enter the CSV.
    await expect(page.getByText(/PERS IDs, evidence URLs, and every moderation state/)).toBeVisible();
    await expect(page.getByText("Submission and deduplication hashes are excluded.")).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download CSV" }).click();
    expect((await download).suggestedFilename()).toMatch(/^cd-reports-\d{4}-\d{2}-\d{2}\.csv$/);
    await expect(page.getByText("Export all report-review rows?")).toHaveCount(0);
    await page.getByRole("button", { name: "Export CSV" }).click();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("Export all report-review rows?")).toHaveCount(0);
    // Escape must close the strip immediately after a keyboard open, while
    // focus is still on the trigger in the nav — the strip is a sibling, so
    // its own handler never sees that keypress.
    const exportTrigger = page.getByRole("button", { name: "Export CSV" });
    await exportTrigger.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Export all report-review rows?")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByText("Export all report-review rows?")).toHaveCount(0);
    await expect(exportTrigger).toBeFocused();

    // 320px is the narrowest supported screen. All three destinations stay on
    // screen and the page never scrolls sideways: the label row must wrap on
    // its own, since the outer bar can only wrap the two groups as whole items.
    const restoreViewport = page.viewportSize();
    await page.setViewportSize({ width: 320, height: 900 });
    for (const label of ["REPORT REVIEW", "SCANNER MONITOR", "DOSSIERS"]) {
      await expect(page.getByRole("link", { name: label })).toBeInViewport();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    if (restoreViewport) await page.setViewportSize(restoreViewport);

    await page.goto("/admin/compile");
    await expect(page.getByRole("heading", { name: "Compile Pearl Abyss dossier" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Compile now" })).toBeVisible();
    await expect(page.getByText("Aggregates are deterministic. AI only rewrites prose and falls back cleanly.")).toBeVisible();
    await expect(page.getByText("Previous runs")).toBeVisible();
    await expectHealthyPage(page, problems);
    await expect(page).toHaveScreenshot("admin-compile.png", { fullPage: true });
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
    let adminStatusRequests = 0;
    // A cold status check can outlive the old one-second retry window. One
    // activation must wait for that in-flight transition without clicking again.
    await page.route("**/api/admin/status", async (route) => {
      adminStatusRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await route.continue();
    });
    await page.goto("/");
    await openAdminPageFromFooter(page);
    expect(adminStatusRequests).toBe(1);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/admin\/login$/);

    // An expired-session navigation carries its destination through sign-in:
    // the operator lands back on the page they were headed to, not the
    // console home. The plain guard bounce still works and names its origin.
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/login\?from=%2Fadmin$/);
    await page.goto("/admin/compile");
    await expect(page).toHaveURL(/\/admin\/login\?from=%2Fadmin%2Fcompile$/);
    await page.getByLabel("Password").fill("admin-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/admin\/compile$/);
    await expect(page.getByRole("heading", { name: "Compile Pearl Abyss dossier" })).toBeVisible();
    await expectHealthyPage(page, problems);
  });

  test("report form submits to the success state", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.goto("/report");

    await expect(page.getByRole("heading", { name: "File a report" })).toBeVisible();
    await expect(page.getByText("Your report helps separate isolated bugs from patch-wide patterns.")).toBeVisible();
    await page.getByLabel("Platform").selectOption("pc_steam");
    await page.getByLabel("Category").selectOption("performance");
    await page.getByLabel("Severity").selectOption("high");
    await page.getByLabel("How often?").selectOption("often");
    await page.getByLabel("One-line summary").fill("FPS drops to 20 in open-field combat since 1.13");
    await page
      .getByLabel("What happened?")
      .fill("After patch 1.13, performance mode drops sharply during open-field combat and does not recover.");
    // Technical detail is a flat rule-divided section in the Dispatch layout.
    await page.getByLabel("Hardware (GPU, CPU, RAM)").fill("RTX 4060, Ryzen 5 7600, 32GB RAM");
    await page.getByRole("button", { name: "Submit report" }).click();

    await expect(page.getByRole("heading", { name: "Filed." })).toBeVisible();
    await expect(page.getByText("checked and sorted into the right issue automatically")).toBeVisible();
    await expect(page).toHaveScreenshot("report-success.png", { fullPage: true });
    await page.getByRole("button", { name: "File another report" }).click();
    await expect(page.getByLabel("Category")).toHaveValue("");
    await expectHealthyPage(page, problems);
  });

  test("report file pickers stay contained and visibly focusable on mobile", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chromium", "Mobile form regression");
    const problems = collectConsoleProblems(page);

    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/report");

      // Below 900px the assistant rail starts collapsed after the viewport
      // store hydrates. Wait for that controlled mobile state before opening
      // it; reading the SSR-open state is the hydration race this test covers.
      const assistantRail = page.locator("details.assistant-rail");
      const assistantSummary = assistantRail.locator("> summary");
      await expect(assistantRail).not.toHaveAttribute("open");
      await assistantSummary.focus();
      await page.keyboard.press("Enter");
      await expect(assistantRail).toHaveAttribute("open", "");

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
    // Below 900px the assistant rail starts collapsed behind its disclosure.
    const assistantSummary = page.locator("details.assistant-rail > summary");
    if (await assistantSummary.isVisible().catch(() => false)) {
      await assistantSummary.click();
    }
    await expect(page.getByText("Your browser cannot scan your PC.")).toBeVisible();
    await expect(page.getByText("user_engine_option_save.xml").first()).toBeVisible();
    await expect(page.getByText("Open File Explorer and search This PC for user_engine_option_save.xml.")).toBeVisible();
    await expect(page.getByText("If search finds nothing, skip this helper.")).toBeVisible();

    const saveFolder = testInfo.outputPath("save-folder");
    await mkdir(saveFolder, { recursive: true });
    const settingsPath = path.join(saveFolder, "user_engine_option_save.xml");
    await writeFile(settingsPath, settingsXml);

    await page.setInputFiles("#save_import", settingsPath);

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
