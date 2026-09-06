import { expect, test, type Locator } from "@playwright/test";
import { collectConsoleProblems, expectHealthyPage } from "./helpers";

const E2E_NOW = new Date("2026-07-20T00:10:00.000Z");
const PUBLIC_ROUTES = [
  "/",
  "/news",
  "/watch",
  "/patches",
  "/issues",
  "/observatory",
  "/report",
  "/about",
  "/privacy",
  "/articles/charting-the-unknown",
];

const MAIN_ACTIONS = [
  "main a.action",
  "main a.chart-link",
  "main a.back-link",
  "main a.inline-source",
  "main a.video-link",
  "main a.dispatch-primary-action",
  "main .patch-player-actions a",
  "main .dispatch-actions a",
  "main .article-bottom a",
].join(", ");

type TargetMetrics = {
  label: string;
  fontSize: number;
  height: number;
};

async function visibleTargetMetrics(locator: Locator): Promise<TargetMetrics[]> {
  return locator.evaluateAll((elements) => elements.flatMap((element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (box.width === 0 || box.height === 0 || style.visibility === "hidden") return [];
    return [{
      label: element.getAttribute("aria-label") || element.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) || element.tagName,
      fontSize: Number.parseFloat(style.fontSize),
      height: box.height,
    }];
  }));
}

function expectReadableTargets(metrics: TargetMetrics[], minimumFontSize: number, route: string) {
  expect(metrics.length, `${route} has no visible shared actions`).toBeGreaterThan(0);
  expect(
    metrics.filter(({ fontSize }) => fontSize < minimumFontSize),
    `${route} has action text below ${minimumFontSize}px`,
  ).toEqual([]);
  expect(
    metrics.filter(({ height }) => height < 44),
    `${route} has action targets shorter than 44px`,
  ).toEqual([]);
}

function boxesOverlap(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

test.describe("public newspaper readability", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(E2E_NOW);
  });

  test("shared navigation and actions remain readable on every public route", async ({ page }, testInfo) => {
    test.slow();
    const problems = collectConsoleProblems(page);
    const minimumNavFontSize = testInfo.project.name === "mobile-chromium" ? 14 : 16;

    for (const route of PUBLIC_ROUTES) {
      await page.goto(route);

      const nav = page.getByRole("navigation", { name: "Main navigation" });
      const navMetrics = await visibleTargetMetrics(nav.getByRole("link"));
      expect(navMetrics.length, `${route} is missing its public navigation`).toBeGreaterThanOrEqual(4);
      expect(
        navMetrics.filter(({ fontSize }) => fontSize < minimumNavFontSize),
        `${route} has navigation text below ${minimumNavFontSize}px`,
      ).toEqual([]);
      expect(
        navMetrics.filter(({ height }) => height < 44),
        `${route} has navigation targets shorter than 44px`,
      ).toEqual([]);

      const sharedActions = page.locator(".np-footer-links a, .np-footer-links button");
      expectReadableTargets(await visibleTargetMetrics(sharedActions), 14, route);

      const mainActions = await visibleTargetMetrics(page.locator(MAIN_ACTIONS));
      if (mainActions.length > 0) expectReadableTargets(mainActions, 14, route);

      await expectHealthyPage(page, problems);
    }
  });

  test("the narrowest supported width keeps the shared actions readable", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chromium", "The desktop project covers the wide layout.");
    await page.setViewportSize({ width: 320, height: 844 });
    const problems = collectConsoleProblems(page);
    await page.goto("/");

    expectReadableTargets(
      await visibleTargetMetrics(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link")),
      14,
      "/ at 320px",
    );
    expectReadableTargets(
      await visibleTargetMetrics(page.locator(".np-footer-links a, .np-footer-links button")),
      14,
      "/ at 320px",
    );
    await expectHealthyPage(page, problems);
  });

  test("front-page lead and official stories expose real headings", async ({ page }) => {
    await page.goto("/");

    const lead = page.locator("#lead");
    const leadHeading = lead.getByRole("heading");
    await expect(leadHeading).toHaveCount(1);
    await expect(leadHeading.getByRole("link")).toHaveAttribute("href", "/patches");

    const officialStories = page.locator(".stories article");
    expect(await officialStories.count()).toBeGreaterThan(0);
    for (const story of await officialStories.all()) {
      const heading = story.getByRole("heading");
      await expect(heading).toHaveCount(1);
      await expect(heading.getByRole("link")).toHaveAttribute("href", "/patches#claims");
    }
  });

  test("front-page issue actions have distinct tap targets", async ({ page }) => {
    await page.goto("/");
    const board = page.locator("#board");
    const issueBoard = board.getByRole("link", { name: /(?:All \d+ published issues?|Read the issue board)/ });
    const fileReport = board.getByRole("link", { name: "File a report →" });
    await expect(issueBoard).toBeVisible();
    await expect(fileReport).toBeVisible();

    const layout = await board.evaluate((element) => {
      const links = [...element.querySelectorAll("a")].filter((link) => {
        const text = link.textContent?.trim() ?? "";
        return /^(All \d+ published issues?|Read the issue board|File a report)/.test(text);
      });
      if (links.length !== 2) return null;
      const [first, second] = links.map((link) => link.getBoundingClientRect());
      const horizontalGap = Math.max(0, Math.max(first.left, second.left) - Math.min(first.right, second.right));
      const verticalGap = Math.max(0, Math.max(first.top, second.top) - Math.min(first.bottom, second.bottom));
      return {
        gap: Math.max(horizontalGap, verticalGap),
        overlap: first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top,
      };
    });

    expect(layout).not.toBeNull();
    expect(layout?.overlap).toBe(false);
    expect(layout?.gap).toBeGreaterThanOrEqual(8);
  });

  test("light is the first-visit theme and a saved dark choice persists", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await page.getByRole("button", { name: "Switch to dark mode" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect.poll(() => page.evaluate(() => localStorage.getItem("newspaper-theme"))).toBe("dark");

    await page.goto("/privacy");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("button", { name: "Switch to light mode" })).toBeVisible();
  });

  test("review-chart keyboard and tap readouts do not cover the total", async ({ page }) => {
    await page.goto("/");
    const chart = page.getByRole("heading", { name: "Daily review-count change" }).locator("..");
    const total = chart.getByText("Total reviews").locator("..");
    const point = chart.getByRole("button", { name: /net reviews/ }).first();
    await point.focus();

    const readout = chart.locator(".chart-readout");
    await expect(readout).toBeVisible();
    const keyboardText = await readout.innerText();
    await point.press("Enter");
    await expect(readout).toHaveText(keyboardText, { useInnerText: true });
    await point.click();
    await expect(readout).toBeVisible();

    const [readoutBox, totalBox] = await Promise.all([readout.boundingBox(), total.boundingBox()]);
    expect(readoutBox).not.toBeNull();
    expect(totalBox).not.toBeNull();
    expect(boxesOverlap(readoutBox!, totalBox!)).toBe(false);
  });
});
