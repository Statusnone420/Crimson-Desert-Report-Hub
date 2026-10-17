import { expect, test } from "@playwright/test";
import { collectConsoleProblems, expectHealthyPage } from "./helpers";

test("search finds a published issue from Watchlist and preserves the filters when switching", async ({ page }) => {
  const problems = collectConsoleProblems(page);
  await page.goto("/issues");
  const views = page.getByRole("group", { name: "Choose board view" });
  const published = views.getByRole("button", { name: /Published issues/ });
  const watchlist = views.getByRole("button", { name: /Watchlist/ });
  const originalPublishedCount = await published.locator(".board-view-count").innerText();
  await watchlist.click();
  await page.getByRole("searchbox", { name: "Find an issue" }).fill("mount");
  await page.getByRole("combobox", { name: "Category" }).selectOption("controls_gameplay");

  await expect(page.getByRole("status")).toContainText("1 match across both views");
  await expect(published.locator(".board-view-count")).toHaveText("1");
  await expect(watchlist.locator(".board-view-count")).toHaveText("0");
  const match = page.getByRole("button", { name: "View 1 matching published issue", exact: true });
  await match.focus();
  await page.keyboard.press("Enter");
  await expect(published).toHaveAttribute("aria-pressed", "true");
  await expect(published).toBeFocused();
  await expect(page.getByRole("heading", { name: "Mount and input lockups", exact: true })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Find an issue" })).toHaveValue("mount");
  await expect(page.getByRole("combobox", { name: "Category" })).toHaveValue("controls_gameplay");
  await expect(page.locator(".report-dispatch")).toHaveCount(1);

  await page.getByRole("combobox", { name: "Category" }).selectOption("performance");
  await expect(page.getByRole("status")).toContainText("0 matches across both views");
  await expect(page.locator(".board-cross-view")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(published.locator(".board-view-count")).toHaveText(originalPublishedCount);
  await expect(page.getByRole("searchbox", { name: "Find an issue" })).toHaveValue("");
  await expect(page.getByRole("combobox", { name: "Category" })).toHaveValue("all");
  await expectHealthyPage(page, problems);
});
