import { expect, test } from "@playwright/test";
import { collectConsoleProblems, expectHealthyPage } from "./helpers";

test("front-page readers can open the patch report and then the DLC report", async ({ page }) => {
  const problems = collectConsoleProblems(page);
  await page.goto("/");
  const reports = page.getByRole("region", { name: "Original Hub reports" });
  await expect(reports.getByRole("heading")).toHaveText([
    "The base game keeps moving",
    "Beyond Pywel’s familiar shores",
  ]);
  await expect(reports.locator("time")).toHaveText(["September 11, 2026", "September 5, 2026"]);
  await reports.getByRole("article").first().getByRole("link", { name: "Read the report →" }).click();
  await expect(page).toHaveURL(/\/articles\/patch-2-02-00$/);
  await expect(page.getByRole("heading", { name: "The base game keeps moving" })).toBeVisible();

  await page.goto("/");
  await reports.getByRole("article").nth(1).getByRole("link", { name: "Read the report →" }).click();
  await expect(page).toHaveURL(/\/articles\/charting-the-unknown$/);
  await expect(page.getByRole("heading", { name: "Beyond Pywel’s familiar shores" })).toBeVisible();
  await expectHealthyPage(page, problems);
});

test("original reports keep their hierarchy across screen sizes and themes", async ({ page }, testInfo) => {
  const problems = collectConsoleProblems(page);
  const widths = testInfo.project.name === "mobile-chromium" ? [390, 320] : [1440, 768];
  await page.clock.setFixedTime(new Date("2026-09-11T09:00:00Z"));
  await page.goto("/");
  for (const width of widths) {
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 1100 });
    for (const theme of ["light", "dark"] as const) {
      if (await page.locator("html").getAttribute("data-theme") !== theme) {
        await page.getByRole("button", { name: `Switch to ${theme} mode` }).click();
      }
      const reports = page.getByRole("region", { name: "Original Hub reports" });
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
          record: rect(".stories"),
          headings: [...document.querySelectorAll(".front-page-reports h2")].map((heading) => Number.parseFloat(getComputedStyle(heading).fontSize)),
          viewportHeight: window.innerHeight,
        };
      });
      expect(geometry.secondary.top).toBeGreaterThanOrEqual(geometry.lead.bottom);
      expect(geometry.record.top).toBeGreaterThanOrEqual(geometry.secondary.bottom);
      if (geometry.coverage) expect(geometry.coverage.top).toBeGreaterThanOrEqual(geometry.secondary.bottom);
      expect(geometry.headings[0]).toBeGreaterThan(geometry.headings[1]);
      if (width <= 900) {
        expect(geometry.copy.bottom).toBeLessThanOrEqual(geometry.image.top);
        expect(geometry.action.top).toBeGreaterThanOrEqual(0);
        expect(geometry.action.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
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
