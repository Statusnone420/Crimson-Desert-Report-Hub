import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { collectConsoleProblems, expectHealthyPage } from "./helpers";

const now = process.env.PLAYWRIGHT_NOW ?? "2026-07-20T00:10:00.000Z";
const coverageVisible = Date.parse(now) >= Date.parse("2026-09-05T00:00:00Z");

test("newspaper editorial routes retain the brand and separate coverage from scanner snippets", async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date(now));
  const problems = collectConsoleProblems(page);
  await page.goto("/news");
  await expect(page.getByRole("heading", { name: "Crimson Desert news", exact: true })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://crimsonreporthub.com/news");
  await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "News", exact: true })).toHaveAttribute("aria-current", "page");
  await page.goto("/topics/charting-the-unknown");
  await expect(page).toHaveURL(/\/articles\/charting-the-unknown$/);
  await expect(page.getByRole("heading", { name: "Beyond Pywel’s familiar shores", exact: true })).toBeVisible();
  await expect(page.locator(".article-hero img")).toBeVisible();
  await expect(page.locator(".opening")).toContainText("Crimson Desert’s next journey");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://crimsonreporthub.com/articles/charting-the-unknown");
  await expect(page.getByRole("heading", { name: "The official outline" })).toHaveCount(0);
  mkdirSync("output/playwright", { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ animations: "disabled", path: `output/playwright/editorial-article-${testInfo.project.name}.png`, fullPage: true });
  await page.goto("/watch");
  await expect(page.getByRole("heading", { name: "Crimson Desert, in motion" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Watch the official reveal ↗" })).toHaveAttribute("href", "https://www.youtube.com/watch?v=HaCtG1F_hfE");
  if (coverageVisible) {
    await expect(page.getByRole("link", { name: "Watch on YouTube ↗" })).toHaveAttribute("href", "https://www.youtube.com/watch?v=6H6c0S80d4U");
    await expect(page.getByText(/KhrazeGaming · Creator commentary/)).toBeVisible();
  }
  await page.goto("/");
  await expect(page).toHaveTitle(/Crimson Desert Report Hub.*News/);
  await expect(page.locator("#asks")).toHaveCount(0);
  await expect(page.getByText(/Day 20 of asking|Airbnb|No dated coverage is available for this patch/)).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Selected press coverage" })).toHaveCount(coverageVisible ? 1 : 0);
  const wireLayout = await page.evaluate(() => {
    const newspaper = document.querySelector(".newspaper");
    if (!newspaper) return null;
    const fixture = document.createElement("section");
    fixture.className = "np-wire";
    fixture.setAttribute("aria-hidden", "true");
    fixture.innerHTML = `<div class="np-wire-feature"><article><div><p class="kicker">Creator spotlight</p><h2>A creator’s view of Pywel</h2><p class="np-date">Byline</p><a href="#"><h3>Headline</h3></a></div><div><p>Excerpt that should sit beside the heading instead of leaving a vacant column.</p><a class="action" href="#">Watch on YouTube ↗</a></div></article></div>`;
    newspaper.appendChild(fixture);
    const grid = fixture.querySelector(":scope > div");
    const article = fixture.querySelector("article");
    const lede = article?.children[0];
    const excerpt = article?.children[1];
    if (!grid || !article || !lede || !excerpt) {
      fixture.remove();
      return null;
    }
    const gridBox = grid.getBoundingClientRect();
    const articleBox = article.getBoundingClientRect();
    const ledeBox = lede.getBoundingClientRect();
    const excerptBox = excerpt.getBoundingClientRect();
    const result = {
      articleFillsGrid: Math.abs(articleBox.width - gridBox.width) < 2,
      sideBySide: excerptBox.left >= ledeBox.right - 1 && Math.abs(ledeBox.top - excerptBox.top) < 24,
      stacked: excerptBox.top >= ledeBox.bottom - 2,
      ruleWidth: Number.parseFloat(getComputedStyle(excerpt).borderLeftWidth),
    };
    fixture.remove();
    return result;
  });
  expect(wireLayout?.articleFillsGrid).toBe(true);
  if (testInfo.project.name === "mobile-chromium") {
    expect(wireLayout).toMatchObject({ sideBySide: false, stacked: true, ruleWidth: 0 });
  } else {
    expect(wireLayout?.sideBySide).toBe(true);
    expect(wireLayout?.stacked).toBe(false);
    expect(wireLayout?.ruleWidth).toBeGreaterThan(0);
  }
  if (coverageVisible) {
    const spotlight = page.getByRole("region", { name: "Selected creator coverage" });
    await expect(spotlight.getByRole("heading", { name: "A creator’s view of Pywel" })).toBeVisible();
    expect(await spotlight.evaluate((section) => {
      const article = section.querySelector("article");
      return article ? article.getBoundingClientRect().width / section.getBoundingClientRect().width : 0;
    })).toBeGreaterThan(0.85);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.getByRole("link", { name: "More videos →" }).click();
  await expect(page).toHaveURL(/\/watch$/);
  await expect(page.getByRole("heading", { name: "Crimson Desert, in motion" })).toBeVisible();
  await expectHealthyPage(page, problems);
});
