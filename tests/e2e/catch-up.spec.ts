import { expect, test, type Page } from "@playwright/test";
import { CATCH_UP_STORAGE_KEY, type CatchUpPreferences } from "../../src/lib/catchUpPreferences";
import { collectConsoleProblems, expectHealthyPage } from "./helpers";

const NOW = new Date("2026-09-06T12:00:00.000Z");
const PREVIOUS_VISIT = "2026-08-27T12:00:00.000Z";
const CAUGHT_UP_THROUGH = "2026-08-29T12:00:00.000Z";

async function storedPreferences(page: Page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null") as CatchUpPreferences | null, CATCH_UP_STORAGE_KEY);
}

async function openCatchUpMenu(page: Page) {
  await page.getByRole("button", { name: "Catch me up", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Catch up" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("public catch-up journey", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(NOW);
  });

  test("a new visit can build a catch-up from a patch", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.goto("/catch-up");
    await expect(page.getByRole("heading", { level: 1, name: "Catch up on Pywel" })).toBeVisible();
    await expect.poll(() => storedPreferences(page)).toEqual({
      remember: true,
      lastVisit: NOW.toISOString(),
      caughtUpThrough: null,
    });

    const dialog = await openCatchUpMenu(page);
    await expect(dialog.getByLabel("Remember my place on this browser")).toBeChecked();
    await expect(dialog.getByRole("button", { name: /Since my last visit/ })).toHaveCount(0);
    await dialog.getByRole("tab", { name: "Patch" }).click();
    await dialog.getByRole("radio", { name: /^2\.00\.01/ }).check();
    await dialog.getByRole("button", { name: "Show updates" }).click();

    await expect(page).toHaveURL(/\/catch-up#patch=2\.00\.01$/);
    const milestones = page.locator("article.cu-milestone");
    await expect(milestones).toHaveCount(3);
    await expect(milestones.first()).toContainText("Quarry controls and horse travel get a follow-up");
    await expect(page.getByText("An early hotfix targets text and performance")).toHaveCount(0);
    await expectHealthyPage(page, problems);
  });

  test("saved visit and caught-up dates offer both resume points", async ({ page }) => {
    await page.addInitScript(({ key, previousVisit, caughtUpThrough }) => {
      localStorage.setItem(key, JSON.stringify({ remember: true, lastVisit: previousVisit, caughtUpThrough }));
    }, { key: CATCH_UP_STORAGE_KEY, previousVisit: PREVIOUS_VISIT, caughtUpThrough: CAUGHT_UP_THROUGH });
    await page.goto("/catch-up");

    let dialog = await openCatchUpMenu(page);
    await expect(dialog.getByRole("button", { name: /Where I left off/ })).toContainText("August 29");
    await expect(dialog.getByRole("button", { name: /Since my last visit/ })).toContainText("August 27");
    await dialog.getByRole("button", { name: /Since my last visit/ }).click();
    await expect(page).toHaveURL(/#since=2026-08-27T12%3A00%3A00\.000Z$/);
    await expect(page.locator("article.cu-milestone")).toHaveCount(4);

    dialog = await openCatchUpMenu(page);
    await dialog.getByRole("button", { name: /Where I left off/ }).click();
    await expect(page).toHaveURL(/#since=2026-08-29T12%3A00%3A00\.000Z$/);
    await expect(page.locator("article.cu-milestone")).toHaveCount(2);
  });

  test("date selection and explicit completion update the edition", async ({ page }) => {
    await page.goto("/catch-up");
    const dialog = await openCatchUpMenu(page);
    await dialog.getByRole("tab", { name: "Date" }).click();
    await dialog.getByLabel("Last played").fill("2026-09-03");
    await dialog.getByRole("button", { name: "Show updates" }).click();

    await expect(page).toHaveURL(/#since=2026-09-03T00%3A00%3A00\.000Z$/);
    await expect(page.locator("article.cu-milestone")).toHaveCount(2);
    await page.getByRole("button", { name: "Mark me caught up" }).click();
    await expect.poll(() => storedPreferences(page)).toMatchObject({
      remember: true,
      caughtUpThrough: NOW.toISOString(),
    });
  });

  test("an early date and patch expose the full history while keeping the brief short", async ({ page }) => {
    await page.goto("/catch-up");
    await expect(page.locator(".cu-edition")).toContainText("History: July 3 – September 4, 2026");

    let dialog = await openCatchUpMenu(page);
    await dialog.getByRole("tab", { name: "Date" }).click();
    await dialog.getByLabel("Last played").fill("2026-07-03");
    await dialog.getByRole("button", { name: "Show updates" }).click();
    await expect(page).toHaveURL(/#since=2026-07-03T00%3A00%3A00\.000Z$/);
    await expect(page.locator("article.cu-milestone")).toHaveCount(18);
    await expect(page.locator(".cu-coverage")).toHaveCount(0);

    dialog = await openCatchUpMenu(page);
    await dialog.getByRole("tab", { name: "Patch" }).click();
    const patches = dialog.getByRole("group", { name: "Last patch played" });
    await expect(patches.getByRole("radio", { name: /^1\.13\.00/ })).toHaveCount(1);
    await patches.getByRole("radio", { name: /^1\.13\.00/ }).check();
    await dialog.getByRole("button", { name: "Show updates" }).click();

    await expect(page).toHaveURL(/#patch=1\.13\.00$/);
    await expect(page.locator("article.cu-milestone")).toHaveCount(17);
    await expect(page.locator(".cu-brief-grid > li")).toHaveCount(3);
    await expect(page.locator("article.cu-milestone").first()).toContainText("Patch 1.13.01");
    await expect(page.locator(".cu-chapter-meta").getByText("Patch 1.13.00", { exact: true })).toHaveCount(0);
  });

  test("opting out clears saved dates and remains off after reload", async ({ page }) => {
    await page.addInitScript(({ key, previousVisit, caughtUpThrough }) => {
      if (sessionStorage.getItem("catch-up-seeded")) return;
      localStorage.setItem(key, JSON.stringify({ remember: true, lastVisit: previousVisit, caughtUpThrough }));
      sessionStorage.setItem("catch-up-seeded", "true");
    }, { key: CATCH_UP_STORAGE_KEY, previousVisit: PREVIOUS_VISIT, caughtUpThrough: CAUGHT_UP_THROUGH });
    await page.goto("/catch-up");

    let dialog = await openCatchUpMenu(page);
    await dialog.getByLabel("Remember my place on this browser").uncheck();
    await expect.poll(() => storedPreferences(page)).toEqual({ remember: false, lastVisit: null, caughtUpThrough: null });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await page.reload();
    dialog = await openCatchUpMenu(page);
    await expect(dialog.getByLabel("Remember my place on this browser")).not.toBeChecked();
    await expect(dialog.getByRole("button", { name: /Where I left off|Since my last visit/ })).toHaveCount(0);
    await expect.poll(() => storedPreferences(page)).toEqual({ remember: false, lastVisit: null, caughtUpThrough: null });
  });

  test("a delayed opt-out cannot be overwritten when the page is hidden", async ({ page }) => {
    await page.goto("/catch-up");
    await expect.poll(() => storedPreferences(page)).toMatchObject({ remember: true });

    await page.evaluate((key) => {
      localStorage.setItem(key, JSON.stringify({ remember: false, lastVisit: null, caughtUpThrough: null }));
      window.dispatchEvent(new Event("pagehide"));
    }, CATCH_UP_STORAGE_KEY);

    await expect.poll(() => storedPreferences(page)).toEqual({
      remember: false,
      lastVisit: null,
      caughtUpThrough: null,
    });
  });

  test("pagehide preserves a newer caught-up timestamp from storage", async ({ page }) => {
    const newerCaughtUpThrough = "2026-09-06T11:59:00.000Z";
    await page.goto("/catch-up");
    await expect.poll(() => storedPreferences(page)).toMatchObject({ remember: true });

    await page.evaluate(({ key, caughtUpThrough }) => {
      localStorage.setItem(key, JSON.stringify({
        remember: true,
        lastVisit: "2026-09-01T12:00:00.000Z",
        caughtUpThrough,
      }));
      window.dispatchEvent(new Event("pagehide"));
    }, { key: CATCH_UP_STORAGE_KEY, caughtUpThrough: newerCaughtUpThrough });

    await expect.poll(() => storedPreferences(page)).toEqual({
      remember: true,
      lastVisit: NOW.toISOString(),
      caughtUpThrough: newerCaughtUpThrough,
    });
  });

  test("journey links keep the chosen edition and focus their chapter", async ({ page }) => {
    await page.goto("/catch-up#patch=2.00.01");
    const milestones = page.locator("article.cu-milestone");
    await expect(milestones).toHaveCount(3);
    const journeyLink = page.getByRole("link", { name: "In the journey" }).first();
    const targetId = (await journeyLink.getAttribute("href"))?.slice(1);
    expect(targetId).toBeTruthy();

    await journeyLink.click();

    await expect(page).toHaveURL(/\/catch-up#patch=2\.00\.01$/);
    await expect(milestones).toHaveCount(3);
    await expect(page.locator(`#${targetId}`)).toBeFocused();
    await expect(page.locator(`#${targetId}`)).toHaveAttribute("tabindex", "-1");
  });

  test("a visible filter explains a patch selection and opens the full history", async ({ page }) => {
    await page.goto("/catch-up#patch=1.18.02");
    const milestones = page.locator("article.cu-milestone");
    await expect(milestones).toHaveCount(5);
    await expect(page.locator(".cu-journey-filter p, .cu-rail-selection").filter({ visible: true }).first()).toContainText("After patch 1.18.02");

    const showAll = page.getByRole("link", { name: "Show all history →" }).filter({ visible: true }).first();
    await expect(showAll).toBeVisible();
    await showAll.click();

    await expect(page).toHaveURL(/\/catch-up#history=all$/);
    await expect(milestones).toHaveCount(18);
    await expect(milestones.first()).toContainText("Patch 1.13.00");
    await expect(milestones.first()).toBeFocused();
    await expect(milestones.first()).toHaveAttribute("tabindex", "-1");
  });

  test("menu tabs support arrow keys and the All mode submits full history", async ({ page }) => {
    await page.goto("/catch-up");
    const dialog = await openCatchUpMenu(page);
    const tabs = dialog.getByRole("tab");
    await expect(tabs).toHaveCount(4);

    const recent = dialog.getByRole("tab", { name: "Recent" });
    const date = dialog.getByRole("tab", { name: "Date" });
    const patch = dialog.getByRole("tab", { name: "Patch" });
    const all = dialog.getByRole("tab", { name: "All" });
    await recent.focus();
    await recent.press("ArrowRight");
    await expect(date).toBeFocused();
    await expect(date).toHaveAttribute("aria-selected", "true");
    await date.press("End");
    await expect(all).toBeFocused();
    await expect(all).toHaveAttribute("aria-selected", "true");
    await all.press("ArrowLeft");
    await expect(patch).toBeFocused();
    await patch.press("Home");
    await expect(recent).toBeFocused();

    await all.click();
    await dialog.getByRole("button", { name: "Show updates" }).click();
    await expect(page).toHaveURL(/\/catch-up#history=all$/);
    await expect(page.locator("article.cu-milestone")).toHaveCount(18);
  });

  test("Escape closes the menu and the phone layout does not scroll sideways", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chromium", "Phone layout coverage runs in the mobile project.");
    await page.setViewportSize({ width: 320, height: 844 });
    const problems = collectConsoleProblems(page);
    await page.goto("/catch-up");
    const dialog = await openCatchUpMenu(page);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expectHealthyPage(page, problems);
  });
});
