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

// CI compiles these client navigations on demand while two projects share the
// mock server; wait past the default expect timeout before asserting.
async function waitForClientPath(page: Page, pathname: string) {
  await page.waitForURL((url) => url.pathname === pathname, { timeout: 30_000 });
}

for (const scenario of [
  { timezone: "Asia/Tokyo", now: "2026-09-06T16:00:00Z", today: "2026-09-07", tomorrow: "2026-09-08", midnight: "2026-09-06T15:00:00.000Z", label: "Since September 7", firstDayMilestones: 18 },
  { timezone: "America/Los_Angeles", now: "2026-09-07T02:00:00Z", today: "2026-09-06", tomorrow: "2026-09-07", midnight: "2026-09-06T07:00:00.000Z", label: "Since September 6", firstDayMilestones: 17 },
]) {
  test.describe(`catch-up calendar in ${scenario.timezone}`, () => {
    test.use({ timezoneId: scenario.timezone });

    test("date-only links use local midnight and reject local tomorrow", async ({ page }) => {
      await page.clock.setFixedTime(new Date(scenario.now));
      await page.goto(`/catch-up#since=${scenario.today}`);
      await expect(page.locator(".cu-edition")).toContainText(scenario.label);
      const dialog = await openCatchUpMenu(page);
      await expect(dialog.getByLabel("Last played")).toHaveValue(scenario.today);
      await dialog.getByRole("button", { name: "Show updates" }).click();
      await expect(page).toHaveURL((url) => new URLSearchParams(url.hash.slice(1)).get("since") === scenario.midnight);

      await page.goto(`/catch-up#since=${scenario.tomorrow}`);
      await expect(page.locator(".cu-edition")).toContainText("The recent highlights");

      await page.goto("/catch-up#since=2026-07-02");
      await expect(page.locator(".cu-coverage")).toBeVisible();
      await page.goto("/catch-up#since=2026-07-03");
      await expect(page.locator(".cu-edition")).toContainText("Since July 3");
      // The July 3 03:00 UTC notice was already July 3 in Tokyo, but July 2 in Los Angeles.
      await expect(page.locator(".cu-milestone")).toHaveCount(scenario.firstDayMilestones);
      await expect(page.locator(".cu-coverage")).toHaveCount(0);
    });

    test("saved resume dates agree with the local selection label and reopened picker", async ({ page }) => {
      await page.clock.setFixedTime(new Date(scenario.now));
      const saved = new Date(scenario.now).toISOString();
      await page.addInitScript(({ key, saved }) => {
        localStorage.setItem(key, JSON.stringify({ remember: true, lastVisit: saved, caughtUpThrough: saved }));
      }, { key: CATCH_UP_STORAGE_KEY, saved });
      await page.goto("/catch-up");
      for (const label of ["Where I left off", "Since my last visit"]) {
        const dialog = await openCatchUpMenu(page);
        const shortcut = dialog.getByRole("button", { name: new RegExp(label) });
        await expect(shortcut).toContainText(scenario.label.replace("Since ", ""));
        await shortcut.click();
        await expect(page.locator(".cu-edition")).toContainText(scenario.label);
        await expect(page).toHaveURL((url) => new URLSearchParams(url.hash.slice(1)).get("since") === saved);
        const reopened = await openCatchUpMenu(page);
        await expect(reopened.getByLabel("Last played")).toHaveValue(scenario.today);
        await reopened.getByRole("button", { name: "Close catch-up options" }).click();
      }
    });

    test("uses local today for the limit, submission, and reopened date", async ({ page }) => {
      await page.clock.setFixedTime(new Date(scenario.now));
      await page.goto("/catch-up");
      let dialog = await openCatchUpMenu(page);
      await dialog.getByRole("tab", { name: "Date" }).click();
      const input = dialog.getByLabel("Last played");
      await expect(input).toHaveAttribute("max", scenario.today);
      await input.fill(scenario.tomorrow);
      expect(await input.evaluate((element: HTMLInputElement) => element.validity.rangeOverflow)).toBe(true);
      await input.fill(scenario.today);
      await dialog.getByRole("button", { name: "Show updates" }).click();

      await expect(page).toHaveURL((url) => new URLSearchParams(url.hash.slice(1)).get("since") === scenario.midnight);
      await expect(page.locator(".cu-edition")).toContainText(scenario.label);
      dialog = await openCatchUpMenu(page);
      await expect(dialog.getByLabel("Last played")).toHaveValue(scenario.today);
    });
  });
}

test.describe("public catch-up journey", () => {
  test.use({ timezoneId: "UTC" });
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(NOW);
  });

  test("a direct admin login initializes the menu without recording a visit", async ({ page }) => {
    await page.goto("/admin/login");
    const dialog = await openCatchUpMenu(page);
    await expect.poll(() => storedPreferences(page)).toBeNull();
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await expect.poll(() => storedPreferences(page)).toBeNull();

    const remember = dialog.getByRole("checkbox", { name: "Remember my place on this browser" });
    await expect(remember).toBeEnabled();
    await remember.uncheck();
    await remember.check();
    await expect.poll(() => storedPreferences(page)).toEqual({ remember: true, lastVisit: null, caughtUpThrough: null });

    await dialog.getByRole("button", { name: "Show updates" }).click();
    await waitForClientPath(page, "/catch-up");
    await expect.poll(() => storedPreferences(page)).toEqual({ remember: true, lastVisit: NOW.toISOString(), caughtUpThrough: null });
  });

  test("login and signed-in scanner work preserve the public visit through reload and client navigation", async ({ page }) => {
    const previous = { remember: true, lastVisit: PREVIOUS_VISIT, caughtUpThrough: CAUGHT_UP_THROUGH };
    await page.addInitScript(({ key, value }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value));
    }, { key: CATCH_UP_STORAGE_KEY, value: previous });
    await page.goto("/admin/login?from=%2Fscanner");
    await expect(page.getByRole("button", { name: "Catch me up", exact: true })).toBeEnabled();
    await expect.poll(() => storedPreferences(page)).toEqual(previous);
    await page.getByLabel("Password", { exact: true }).fill("admin-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await waitForClientPath(page, "/scanner");
    await expect(page.locator(".operator-newspaper")).toBeVisible();
    await expect.poll(() => storedPreferences(page)).toEqual(previous);
    await page.reload();
    await expect(page.locator(".operator-newspaper")).toBeVisible();
    await expect.poll(() => storedPreferences(page)).toEqual(previous);
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await expect.poll(() => storedPreferences(page)).toEqual(previous);

    await page.locator(".nameplate__title a").click();
    await waitForClientPath(page, "/");
    await expect.poll(() => storedPreferences(page)).toEqual({ ...previous, lastVisit: NOW.toISOString() });
    await page.goBack();
    await expect(page.locator(".operator-newspaper")).toBeVisible();
    await page.clock.setFixedTime(new Date("2026-09-06T13:00:00.000Z"));
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await expect.poll(() => storedPreferences(page)).toEqual({ ...previous, lastVisit: NOW.toISOString() });
  });

  test("anonymous scanner visits still record the public Observatory visit", async ({ page }) => {
    await page.goto("/scanner");
    await expect(page.getByRole("heading", { name: "The game, in context." })).toBeVisible();
    await expect(page.locator(".operator-newspaper")).toHaveCount(0);
    await expect.poll(() => storedPreferences(page)).toEqual({ remember: true, lastVisit: NOW.toISOString(), caughtUpThrough: null });

    const departed = "2026-09-06T13:00:00.000Z";
    await page.clock.setFixedTime(new Date(departed));
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await expect.poll(() => storedPreferences(page)).toEqual({ remember: true, lastVisit: departed, caughtUpThrough: null });
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
    const targetId = new URLSearchParams((await journeyLink.getAttribute("href"))?.slice(1)).get("chapter");
    expect(targetId).toBeTruthy();

    await journeyLink.click();

    await expect(page).toHaveURL(/\/catch-up#patch=2\.00\.01$/);
    await expect(milestones).toHaveCount(3);
    await expect(page.locator(`#${targetId}`)).toBeFocused();
    await expect(page.locator(`#${targetId}`)).toHaveAttribute("tabindex", "-1");
  });

  test("middle-clicking an older chapter opens its full edition in a new tab", async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name === "mobile-chromium", "A physical mouse middle-click is covered by the desktop project.");
    await page.goto("/catch-up#history=all");
    await expect(page.locator("article.cu-milestone")).toHaveCount(18);
    const chapterLink = page.locator(".cu-rail-links a").first();
    await expect(chapterLink).toHaveAttribute("href", "#history=all&chapter=update-1-13-00");
    const opened = context.waitForEvent("page");
    await chapterLink.click({ button: "middle" });
    const newTab = await opened;
    try {
      await newTab.bringToFront();
      await expect(newTab).toHaveURL(/\/catch-up#history=all&chapter=update-1-13-00$/);
      await expect(newTab.locator("article.cu-milestone")).toHaveCount(18);
      await expect(newTab.locator("#update-1-13-00")).toBeFocused();
      await expect(newTab.locator("#update-1-13-00")).toBeInViewport();
      await expect(page).toHaveURL(/\/catch-up#history=all$/);
    } finally {
      await newTab.close();
    }
  });

  for (const edition of [
    { hash: "#patch=1.13.00", count: 17, chapter: "hotfix-1-13-01" },
    { hash: "#since=2026-07-03T00%3A00%3A00.000Z", count: 18, chapter: "update-1-13-00" },
  ]) {
    test(`a copied chapter link preserves ${edition.hash} on direct load and reload`, async ({ page, context }) => {
      await page.goto(`/catch-up${edition.hash}`);
      await expect(page.locator("article.cu-milestone")).toHaveCount(edition.count);
      const copiedURL = await page.locator(".cu-rail-links a").first().evaluate((link: HTMLAnchorElement) => link.href);
      const expectedHash = `${edition.hash}&chapter=${edition.chapter}`;
      expect(new URL(copiedURL).search).toBe("");
      expect(new URL(copiedURL).hash).toBe(expectedHash);
      const newTab = await context.newPage();
      try {
        await newTab.clock.setFixedTime(NOW);
        await newTab.goto(copiedURL);
        await expect(newTab.locator("article.cu-milestone")).toHaveCount(edition.count);
        await expect(newTab.locator(`#${edition.chapter}`)).toBeFocused();
        await expect(newTab.locator(`#${edition.chapter}`)).toBeInViewport();
        await newTab.reload();
        await expect(newTab).toHaveURL((url) => url.hash === expectedHash);
        await expect(newTab.locator("article.cu-milestone")).toHaveCount(edition.count);
        await expect(newTab.locator(`#${edition.chapter}`)).toBeFocused();
        await expect(newTab.locator(`#${edition.chapter}`)).toBeInViewport();
      } finally {
        await newTab.close();
      }
    });
  }

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
