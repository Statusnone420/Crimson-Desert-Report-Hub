import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { collectConsoleProblems, expectHealthyPage } from "./helpers";

for (const theme of ["light", "dark"] as const) {
  test(`public endings keep one next step and a compact readable footer in ${theme} mode`, async ({ page }, testInfo) => {
    const problems = collectConsoleProblems(page);
    for (const [route, name] of [["/patches", "patches"], ["/articles/patch-2-02-00", "article"]]) {
      await page.goto(route);
      if (await page.locator("html").getAttribute("data-theme") !== theme) {
        await page.getByRole("button", { name: `Switch to ${theme} mode`, exact: true }).click();
      }
      const footer = page.getByRole("contentinfo");
      const links = footer.getByRole("navigation", { name: "Footer navigation" });
      await expect(links.getByRole("link")).toHaveCount(7);
      await expect(links.getByRole("link", { name: "Watch", exact: true })).toHaveAttribute("href", "/watch");
      await expect(links.getByRole("link", { name: "RSS feed for original reports", exact: true })).toHaveAttribute("href", "/rss.xml");
      await expect(links.getByRole("link", { name: "Atom feed for original reports", exact: true })).toHaveAttribute("href", "/feed.xml");
      await expect(links.getByRole("link", { name: "File a report →", exact: true })).toHaveAttribute("href", "/report");
      await expect(footer).toContainText("No ads · No trackers");
      await expect(footer).toContainText("Not affiliated with or endorsed by Pearl Abyss.");
      await expect(footer.getByRole("link", { name: "Image source ↗", exact: true })).toHaveAttribute("href", /^https:\/\//);
      await expect(page.getByRole("link", { name: "Back to top ↑", exact: true })).toHaveCount(1);
      if (name === "patches") {
        const ending = page.getByRole("region", { name: "The player record", exact: true });
        await expect(ending.getByRole("link", { name: "View player reports →", exact: true })).toHaveCount(1);
        await expect(page.getByRole("link", { name: "Next: The player record →", exact: true })).toHaveCount(0);
      } else {
        await expect(page.getByRole("link", { name: "More from the news desk →", exact: true })).toHaveAttribute("href", "/news");
      }
      for (const link of await links.getByRole("link").all()) {
        expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      if (testInfo.project.name === "mobile-chromium") {
        expect((await footer.boundingBox())!.height).toBeLessThanOrEqual(240);
      }
      await expectHealthyPage(page, problems);
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
      await expect(footer).toBeInViewport({ ratio: 1 });
      mkdirSync("output/playwright", { recursive: true });
      await page.screenshot({ animations: "disabled", path: `output/playwright/${name}-ending-${theme}-${testInfo.project.name}.png` });
      if (testInfo.project.name === "mobile-chromium") {
        await page.setViewportSize({ width: 320, height: 844 });
        await expectHealthyPage(page, problems);
        expect((await footer.boundingBox())!.height).toBeLessThanOrEqual(280);
        await page.setViewportSize({ width: 390, height: 844 });
      }
    }
  });
}
