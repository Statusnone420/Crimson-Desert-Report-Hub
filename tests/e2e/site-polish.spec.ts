import { expect, test } from "@playwright/test";
import { collectConsoleProblems, expectHealthyPage } from "./helpers";

test("interior pages keep the publication identity and leave more room to read", async ({ page }, testInfo) => {
  const problems = collectConsoleProblems(page);
  await page.goto("/");
  const homeHeader = await page.locator(".paper > header").boundingBox();
  expect(homeHeader).not.toBeNull();

  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Patches", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Patch 1.13.01", exact: true })).toBeVisible();
  const interiorHeader = await page.locator(".paper > header").boundingBox();
  expect(interiorHeader).not.toBeNull();
  expect(interiorHeader!.height).toBeLessThan(homeHeader!.height);
  if (testInfo.project.name === "chromium") {
    expect(interiorHeader!.height).toBeLessThan(homeHeader!.height * 0.7);
  }
  await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Patches", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: "Catch me up", exact: true })).toBeVisible();
  const headerReport = page.locator(".paper > header").getByRole("link", { name: "File a report", exact: true }).filter({ visible: true });
  await expect(headerReport).toHaveCount(1);
  await expect(headerReport).toHaveAttribute("href", "/report");
  expect((await headerReport.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await expectHealthyPage(page, problems);
});

test("an issue opens a contextual report without sending anything", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/reports")) writes.push(request.url());
  });
  await page.goto("/issues");
  await expect(page.getByRole("button", { name: /^Published issues / })).toBeVisible();
  const issue = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Map-open crash persists after fix", exact: true }) });
  await expect(issue).not.toContainText("Pearl Abyss says 1.13.01 fixed this");
  await issue.getByRole("link", { name: "File a player report →", exact: true }).click();
  await expect(page).toHaveURL(/\/report\?issue=00000000-0000-4000-8000-000000000002$/);
  await expect(page.getByRole("note")).toContainText("Map-open crash persists after fix");
  await expect(page.getByRole("radio", { name: "Crashes and startup", exact: true })).toBeChecked();
  await expect(page.getByLabel("A short, specific summary", { exact: true })).toBeEmpty();
  await page.getByLabel("Platform", { exact: true }).selectOption("other");
  await expect(page.locator("#platform-hint")).toContainText("Mac, Epic Games Store");
  expect(writes).toEqual([]);
});
