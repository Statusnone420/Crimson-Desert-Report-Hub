import { expect, test, type Locator, type Page } from "@playwright/test";
import { collectConsoleProblems, expectHealthyPage } from "./helpers";

async function expectReadableText(controls: Locator) {
  const result = await controls.evaluateAll((elements) => {
    const checked: string[] = [];
    const failures: { text: string; fontSize: number }[] = [];
    for (const element of elements) {
      if (!element.checkVisibility()) continue;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const parent = walker.currentNode.parentElement;
        const text = walker.currentNode.textContent?.trim() ?? "";
        if (!parent || !/[a-z]/i.test(text) || parent.closest('[aria-hidden="true"]') || !parent.checkVisibility()) continue;
        const fontSize = Number.parseFloat(getComputedStyle(parent).fontSize);
        checked.push(text);
        if (fontSize < 14) failures.push({ text, fontSize });
      }
    }
    return { checked, failures };
  });
  expect(result.checked.length, "No visible control text was checked").toBeGreaterThan(0);
  expect(result.failures, "Visible control text is smaller than 14px").toEqual([]);
}

async function expectStandaloneTargets(controls: Locator) {
  const targets = await controls.evaluateAll((elements) => elements.flatMap((element) => {
    if (!element.checkVisibility()) return [];
    return [{ text: element.textContent?.trim(), height: element.getBoundingClientRect().height }];
  }));
  expect(targets.length, "No visible standalone controls were checked").toBeGreaterThan(0);
  expect(targets.filter(({ height }) => height < 44), "Standalone controls are shorter than 44px").toEqual([]);
  await expectReadableText(controls);
}

async function fillValidReport(page: Page) {
  await page.getByLabel("Platform").selectOption("pc_steam");
  await page.getByRole("radio", { name: "Performance" }).locator("..").click();
  await page.getByRole("radio", { name: "Serious" }).locator("..").click();
  await page.getByRole("radio", { name: "Often" }).locator("..").click();
  await page.getByLabel("A short, specific summary").fill("Frame rate falls while opening the map");
  await page.getByLabel("Describe the problem").fill("The frame rate drops when opening the world map after a battle near the camp.");
}

test.describe("secondary public states remain readable", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-07-20T00:10:00.000Z"));
  });

  test("empty public watchlist keeps its reset action and counting disclosure readable", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.goto("/issues");
    const switcher = page.getByRole("group", { name: "Choose board view" });
    const watchlist = switcher.getByRole("button", { name: /Watchlist/ });
    await watchlist.click();
    await expect(watchlist).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".board-watchlist .watch-entry")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "No matching public leads." })).toBeVisible();
    await expect(page.getByRole("status")).toHaveText("Showing 0 of 0 public watchlist leads");
    await page.getByLabel("Find an issue").fill("frame rate");
    const reset = page.getByRole("button", { name: "Show all public leads →" });
    await expectStandaloneTargets(reset);
    await reset.click();
    await expect(page.getByLabel("Find an issue")).toHaveValue("");
    await expect(watchlist).toHaveAttribute("aria-pressed", "true");
    const method = page.locator(".board-method");
    await method.locator("summary").click();
    await expect(method).toHaveAttribute("open", "");
    await expect(method.getByRole("link", { name: "Read the method →" })).toBeVisible();
    await expectReadableText(method.locator("a, summary"));
    await expectStandaloneTargets(method.locator("summary"));
    await expectHealthyPage(page, problems);
  });

  test("positive-share readings and expanded Twitch captures retain readable controls", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.goto("/observatory");
    const positiveShare = page.getByRole("button", { name: "Positive share", exact: true });
    await positiveShare.click();
    await expect(positiveShare).toHaveAttribute("aria-pressed", "true");
    const balance = page.locator(".obs-share-days > span");
    const latestBalance = await balance.innerText();
    await page.getByRole("button", { name: "Previous review reading" }).click();
    await expect(balance).not.toHaveText(latestBalance, { useInnerText: true });
    await page.getByRole("button", { name: "Next review reading" }).click();
    await expect(balance).toHaveText(latestBalance, { useInnerText: true });
    await expectStandaloneTargets(page.locator(".obs-share-days button"));

    await page.getByRole("group", { name: "Twitch window" }).getByRole("button", { name: "7 days", exact: true }).click();
    await page.locator(".obs-twitch-values > summary").click();
    const captures = page.locator(".obs-twitch-values");
    await expect(captures).toHaveAttribute("open", "");
    await expect(captures.locator("tbody tr")).toHaveCount(5);
    await expectStandaloneTargets(captures.locator("summary"));
    const slider = page.getByRole("slider", { name: "Choose a Twitch capture" });
    await slider.focus();
    await slider.press("End");
    const latestCapture = await page.locator(".obs-twitch-readout").innerText();
    await slider.press("Home");
    await expect(slider).toHaveValue("0");
    await expect(page.locator(".obs-twitch-readout")).not.toHaveText(latestCapture, { useInnerText: true });
    await slider.press("End");
    await expect(page.locator(".obs-twitch-readout")).toHaveText(latestCapture, { useInnerText: true });
    await expectReadableText(page.locator("main a, main button, main summary"));
    await expectHealthyPage(page, problems);
  });

  test("report errors and review controls remain usable before sending", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    const reportWrites: string[] = [];
    await page.route("**/api/reports", async (route) => {
      reportWrites.push(route.request().method());
      await route.abort();
    });
    await page.goto("/report");
    await page.getByRole("button", { name: "Review report" }).click();
    const errors = page.locator(".filing-errors a");
    await expect(errors.first()).toBeVisible();
    await expectStandaloneTargets(errors);
    const summaryError = page.locator('.filing-errors a[href="#issue_title"]');
    await summaryError.click();
    await expect(page.getByLabel("A short, specific summary")).toBeFocused();
    await expectHealthyPage(page, problems);

    await fillValidReport(page);
    await page.getByRole("button", { name: "Review report" }).click();
    await expect(page.getByRole("heading", { name: "Frame rate falls while opening the map" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Send report/ })).toBeEnabled();
    await expectStandaloneTargets(page.locator(".filing-review-actions button"));
    await expectReadableText(page.locator("main a, main button"));
    await expectHealthyPage(page, problems);
    await page.getByRole("button", { name: "← Edit draft", exact: true }).click();
    await expect(page.getByLabel("A short, specific summary")).toHaveValue("Frame rate falls while opening the map");
    await expect(page.getByLabel("Platform")).toHaveValue("pc_steam");
    expect(reportWrites, "Reviewing and editing must not submit a report").toEqual([]);
    await expectHealthyPage(page, problems);
  });
});
