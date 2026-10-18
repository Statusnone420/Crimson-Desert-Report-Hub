import { expect, test } from "@playwright/test";
import { chartingTheUnknownDelay as report } from "../../src/lib/editorialArticles";
import { collectConsoleProblems, expectHealthyPage, waitForHydration } from "./helpers";

test("the delay report opens from News and Catch Up with credited art and separate editorial opinion", async ({ page, request }, testInfo) => {
  test.slow();
  const problems = collectConsoleProblems(page);
  await page.goto("/news");
  await waitForHydration(page);
  await page.getByRole("link", { name: report.title, exact: true }).click();
  await page.waitForURL(new RegExp(`${report.path}$`), { timeout: 60_000, waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(new RegExp(`${report.path}$`));
  await expect(page.locator("h1")).toHaveText(report.title);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://crimsonreporthub.com${report.path}`);
  await expect(page.locator(".article-hero figcaption")).toContainText("Image © Pearl Abyss");
  await expect(page.getByRole("region", { name: /Editorial opinion:/ })).toContainText("The delay stinks.");
  await expect(page.locator(".opening")).toContainText("October 15 to October 29, 2026");
  const original = await request.get(report.heroImage.src);
  expect(original.status()).toBe(200);
  const dimensions = await page.evaluate(async (src) => {
    const image = new window.Image();
    image.src = src;
    await image.decode();
    return [image.naturalWidth, image.naturalHeight];
  }, report.heroImage.src);
  expect(dimensions).toEqual([1920, 1080]);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: testInfo.outputPath("expansion-delay.png"), fullPage: true, animations: "disabled" });
  await expectHealthyPage(page, problems);

  await page.goto("/catch-up#history=all&chapter=announcement-charting-the-unknown-delay");
  await waitForHydration(page);
  const chapter = page.locator("#announcement-charting-the-unknown-delay");
  await expect(chapter).toBeFocused();
  await expect(chapter.locator(".cu-chapter-meta time")).toHaveAttribute("datetime", "2026-09-30T10:20:00Z");
  await expect(chapter.locator(".cu-chapter-meta")).not.toContainText("Patch");
  const popup = page.waitForEvent("popup");
  await chapter.getByRole("link", { name: "Read the report", exact: true }).click();
  const opened = await popup;
  await expect(opened.locator("h1")).toHaveText(report.title);
  await opened.close();
  for (const route of ["/feed.xml", "/rss.xml", "/sitemap.xml"]) {
    const response = await request.get(route);
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain(`https://crimsonreporthub.com${report.path}`);
  }
});
