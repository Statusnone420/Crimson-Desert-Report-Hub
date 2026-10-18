import { expect, test } from "@playwright/test";
import { patch20200, patch20300, chartingTheUnknown, chartingTheUnknownDelay } from "../../src/lib/editorialArticles";
import { collectConsoleProblems, expectHealthyPage, waitForHydration } from "./helpers";

test("front-page readers can open the delay story and previous patch reports", async ({ page }) => {
  test.slow();
  const problems = collectConsoleProblems(page);
  await page.goto("/");
  await waitForHydration(page);
  const reports = page.getByRole("region", { name: "Hub reports and patch rundowns" });
  await expect(reports.getByRole("heading")).toHaveText([
    chartingTheUnknownDelay.title,
    patch20300.title,
    patch20200.title,
    chartingTheUnknown.title,
  ]);
  await expect(reports.locator("time")).toHaveText(["September 30, 2026", "September 18, 2026", "September 11, 2026", "September 5, 2026"]);
  await expect(reports.locator("#lead .dek")).toHaveText(chartingTheUnknownDelay.description);
  await reports.getByRole("article").first().getByRole("link", { name: "Read the report" }).click();
  await page.waitForURL(/\/articles\/charting-the-unknown-delay$/, { timeout: 60_000, waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/articles\/charting-the-unknown-delay$/);
  await expect(page.getByRole("heading", { name: chartingTheUnknownDelay.title })).toBeVisible();
  await expect(page.locator(".article-heading .article-deck")).toHaveText(chartingTheUnknownDelay.description);

  await page.goto("/");
  await waitForHydration(page);
  await reports.getByRole("article").nth(2).getByRole("link", { name: "Read the report" }).click();
  await page.waitForURL(/\/articles\/patch-2-02-00$/, { timeout: 60_000, waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/articles\/patch-2-02-00$/);
  await expect(page.getByRole("heading", { name: patch20200.title })).toBeVisible();
  await expectHealthyPage(page, problems);
});

test("original reports keep their hierarchy across screen sizes and themes", async ({ page }, testInfo) => {
  const problems = collectConsoleProblems(page);
  const widths = testInfo.project.name === "mobile-chromium" ? [390, 320] : [1440, 768];
  await page.clock.setFixedTime(new Date("2026-09-11T09:00:00Z"));
  await page.goto("/");
  await waitForHydration(page);
  for (const width of widths) {
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 1100 });
    for (const theme of ["light", "dark"] as const) {
      if (await page.locator("html").getAttribute("data-theme") !== theme) {
        await page.getByRole("button", { name: `Switch to ${theme} mode` }).click();
      }
      const reports = page.getByRole("region", { name: "Hub reports and patch rundowns" });
      for (const image of await reports.locator("img").all()) {
        await image.scrollIntoViewIfNeeded();
        await expect.poll(() => image.evaluate((element) => {
          const image = element as HTMLImageElement;
          return image.complete && image.naturalWidth > 0;
        })).toBe(true);
      }
      await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
      await page.evaluate(() => document.fonts.ready);
      const geometry = await page.evaluate(() => {
        const rect = (selector: string) => {
          const element = document.querySelector(selector);
          if (!element) throw new Error(`Missing ${selector}`);
          const { top, bottom, left, right } = element.getBoundingClientRect();
          return { top, bottom, left, right };
        };
        return {
          lead: rect("#lead"),
          copy: rect(".front-page-lead-copy"),
          image: rect("#lead figure"),
          action: rect("#lead .action"),
          secondary: rect(".front-page-secondary"),
          // An older edition can have no dated press coverage; the live record still follows.
          coverage: document.querySelector('[aria-label="Selected press coverage"]') ? rect('[aria-label="Selected press coverage"]') : null,
          readings: rect(".dd-brief"),
          record: rect(".stories"),
          headings: [...document.querySelectorAll(".front-page-reports h2")].map((heading) => Number.parseFloat(getComputedStyle(heading).fontSize)),
          viewportHeight: window.innerHeight,
        };
      });
      // The recorded readings open the page on the first screen; the two newest reports follow.
      expect(geometry.readings.top).toBeLessThan(geometry.viewportHeight);
      expect(geometry.lead.top).toBeGreaterThanOrEqual(geometry.readings.bottom);
      expect(geometry.secondary.top).toBeGreaterThanOrEqual(geometry.lead.bottom);
      expect(geometry.record.top).toBeGreaterThanOrEqual(geometry.secondary.bottom);
      if (geometry.coverage) expect(geometry.coverage.top).toBeGreaterThanOrEqual(geometry.secondary.bottom);
      expect(geometry.headings[0]).toBeGreaterThan(geometry.headings[1]);
      if (width <= 900) {
        expect(geometry.copy.bottom).toBeLessThanOrEqual(geometry.image.top);
        // The lead's reading link stays within one screen of the lead's top, above its artwork.
        expect(geometry.action.bottom - geometry.lead.top).toBeLessThanOrEqual(geometry.viewportHeight);
      } else {
        expect(geometry.image.right).toBeLessThan(geometry.copy.left);
      }
      await expectHealthyPage(page, problems);
      await page.screenshot({ path: testInfo.outputPath(`front-page-${width}-${theme}.png`), fullPage: true, animations: "disabled", scale: "css" });
      await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
      await page.screenshot({ path: testInfo.outputPath(`front-page-${width}-${theme}-viewport.png`), animations: "disabled", scale: "css" });
    }
  }
});
