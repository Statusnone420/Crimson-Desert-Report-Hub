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
  const headerCheckin = page.locator(".paper > header").getByRole("link", { name: "Add a check-in", exact: true }).filter({ visible: true });
  await expect(headerCheckin).toHaveCount(1);
  await expect(headerCheckin).toHaveAttribute("href", "/issues");
  expect((await headerCheckin.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await expectHealthyPage(page, problems);
});

test("general issue check-ins remain available while a pending claim waits for exact context", async ({ page }) => {
  await page.goto("/issues");
  await expect(page.getByRole("button", { name: /^Published issues / })).toBeVisible();
  const fps = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "FPS regression since 1.13", exact: true }) });
  await expect(fps.getByRole("button", { name: /^Happening to me(?: —|$)/ })).toBeVisible();
  await expect(fps.getByRole("button", { name: /^Not happening for me(?: —|$)/ })).toBeVisible();
  await expect(fps.getByRole("link", { name: /report/i })).toHaveCount(0);

  const pendingMap = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Map-open crash persists after fix", exact: true }) });
  await expect(pendingMap.getByText("The exact fix context is unavailable. Check-ins for this claim will open when its source can be shown.")).toBeVisible();
  await expect(pendingMap.getByRole("button", { name: /^Fixed for me(?: —|$)/ })).toHaveCount(0);
  await expect(pendingMap.getByRole("button", { name: /^Still happening(?: —|$)/ })).toHaveCount(0);
  await expect(pendingMap.getByRole("link", { name: /report/i })).toHaveCount(0);
});
