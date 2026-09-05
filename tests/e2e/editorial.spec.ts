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
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await expectHealthyPage(page, problems);
});
