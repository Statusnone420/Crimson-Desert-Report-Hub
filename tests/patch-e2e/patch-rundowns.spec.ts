import { expect, test } from "@playwright/test";
import { collectConsoleProblems, expectHealthyPage, waitForHydration } from "../e2e/helpers";

test("the latest hotfix remains discoverable below newer news and in archive, feeds and Catch up", async ({ page, request }, testInfo) => {
  const problems = collectConsoleProblems(page);
  await page.goto("/");
  await waitForHydration(page);
  await expect(page.locator("#lead h2")).toHaveText("Charting the Unknown delayed two weeks to October 29");
  await expect(page.locator(".front-page-secondary").getByRole("heading", { name: /weekly patches coming with 2.03.00/ })).toBeVisible();
  await expect(page.locator(".newspaper").locator("..")).toHaveCSS("opacity", "1");
  await expectHealthyPage(page, problems);
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("hotfix-home.png"), fullPage: true });
  await page.locator("#lead").screenshot({ animations: "disabled", path: testInfo.outputPath("hotfix-lead.png") });
  await page.locator(".front-page-secondary").getByRole("link", { name: "Crimson Desert patch 2.03.01: patch notes rundown", exact: true }).click();
  await expect(page).toHaveURL(/\/articles\/patch-2-03-01$/);
  await expect(page.locator(".rundown-body li")).toHaveCount(3);
  await expect(page.locator(".rundown-body ul")).toHaveCSS("list-style-type", "disc");
  await expect(page.locator(".rundown-body")).toContainText("lantern-aim input for controllers");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://crimsonreporthub.com/articles/patch-2-03-01");
  await expect(page.locator(".newspaper").locator("..")).toHaveCSS("opacity", "1");
  await expectHealthyPage(page, problems);
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("hotfix-rundown.png"), fullPage: true });
  await page.getByRole("link", { name: "Read this patch’s claim record" }).click();
  await expect(page).toHaveURL(/\/patches\/2-03-01$/);
  await expect(page.locator("#claims")).toContainText("lantern-aim input for controllers");
  await page.getByRole("link", { name: "Back to the patch archive" }).click();
  await expect(page.locator(".patch-heading h1")).toHaveText("Patch 2.03.01");
  await expect(page.locator(".patch-intro")).not.toContainText("Fellow Greymanes");
  await expect(page.locator("#archive li")).toHaveCount(6);
  await page.locator("#archive").getByRole("link", { name: "Patch 2.03.00", exact: true }).click();
  await expect(page.locator(".patch-heading h1")).toHaveText("Patch 2.03.00");
  await expect(page.locator("#claims")).toContainText("older patch issue");
  await expect(page.locator("#claims")).not.toContainText("lantern");
  await expect(page.getByRole("link", { name: "Read the report", exact: true })).toHaveAttribute("href", "/articles/patch-2-03-00");
  await page.getByRole("button", { name: "Catch me up", exact: true }).click();
  const menu = page.getByRole("dialog", { name: "Catch up", exact: true });
  await menu.getByRole("tab", { name: "Patch", exact: true }).click();
  await menu.getByRole("radio", { name: /2.03.01/ }).check();
  await menu.getByRole("button", { name: "Show updates" }).click();
  await expect(page).toHaveURL(/\/catch-up#patch=2.03.01&include=1/);
  await expect(page.locator(".cu-milestone")).toHaveCount(2);
  await expect(page.locator("#hotfix-2-03-01")).toContainText("Patch 2.03.01: official notes");
  await expect(page.locator(".cu-milestone").getByRole("link", { name: /Read the Patch 2.03.01/ })).toHaveAttribute("href", "/articles/patch-2-03-01");
  await expectHealthyPage(page, problems);
  for (const path of ["/rss.xml", "/feed.xml", "/sitemap.xml"]) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain("/articles/patch-2-03-01");
  }
  const missing = await request.get("/patches/9-99-99");
  expect(missing.status()).toBe(404);
  await page.goto("/patches/archive");
  await expect(page).toHaveURL(/\/patches#archive$/);
});

test("patch previews scroll by button, pointer and keyboard without losing the oldest edition", async ({ page }, testInfo) => {
  const problems = collectConsoleProblems(page);
  if (!testInfo.project.use.isMobile) await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/patches#archive");
  await waitForHydration(page);
  const archive = page.locator("#archive");
  const rail = archive.getByRole("list");
  const newer = archive.getByRole("button", { name: "Show newer patches" });
  const older = archive.getByRole("button", { name: "Show older patches" });
  const scrubber = archive.getByRole("slider", { name: "Browse patch history" });
  await expect(archive.getByRole("link", { name: "Patch 2.03.01", exact: true })).toContainText("lantern-aim input for controllers");
  await expect(newer).toBeDisabled();
  await expect(older).toBeEnabled();
  await page.evaluate(() => document.fonts.ready);
  const visibleCards = testInfo.project.use.isMobile ? 1 : 3;
  const railBounds = await rail.boundingBox();
  expect(railBounds).not.toBeNull();
  for (let index = 0; index < visibleCards; index++) {
    const card = archive.locator(".patch-preview").nth(index);
    const cardBounds = await card.boundingBox();
    const footerBounds = await card.locator(".patch-preview-footer").boundingBox();
    const ctaBounds = await card.locator(".patch-preview-footer > span:last-child").boundingBox();
    expect(cardBounds).not.toBeNull();
    expect(footerBounds).not.toBeNull();
    expect(ctaBounds).not.toBeNull();
    expect(cardBounds!.x).toBeGreaterThanOrEqual(railBounds!.x);
    expect(cardBounds!.x + cardBounds!.width).toBeLessThanOrEqual(railBounds!.x + railBounds!.width);
    expect(ctaBounds!.x).toBeGreaterThanOrEqual(footerBounds!.x);
    expect(ctaBounds!.x + ctaBounds!.width).toBeLessThanOrEqual(footerBounds!.x + footerBounds!.width + 1);
  }
  await expectHealthyPage(page, problems);
  await archive.screenshot({ path: testInfo.outputPath("patch-archive-initial.png"), animations: "disabled" });
  await older.click();
  await expect.poll(() => rail.evaluate((node) => node.scrollLeft)).toBeGreaterThan(100);
  await scrubber.focus();
  await page.keyboard.press("End");
  await expect(older).toBeDisabled();
  const oldest = archive.getByRole("link", { name: "Patch 2.00.01", exact: true });
  await expect(oldest).toBeInViewport({ ratio: 0.95 });
  await expect(oldest).toContainText("Official date unavailable");
  await expect(oldest.locator("time")).toHaveCount(0);
  await expect(oldest).toContainText("A fix preview is not available");
  await page.keyboard.press("Home");
  await expect(newer).toBeDisabled();
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => Number(await scrubber.inputValue())).toBeGreaterThan(0);
  await scrubber.hover({ position: { x: 20, y: 22 } });
  const bounds = await scrubber.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + 20, bounds!.y + bounds!.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width * 0.65, bounds!.y + bounds!.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => Number(await scrubber.inputValue())).toBeGreaterThan(40);
  await expectHealthyPage(page, problems);
  await scrubber.focus();
  await page.keyboard.press("Home");
  await archive.screenshot({ path: testInfo.outputPath("patch-archive.png"), animations: "disabled" });
});

test("patch archive supports reduced motion and dark mode", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/patches#archive");
  await waitForHydration(page);
  await page.evaluate(() => document.documentElement.dataset.theme = "dark");
  const archive = page.locator("#archive");
  await archive.getByRole("button", { name: "Show older patches" }).click();
  await expect.poll(() => archive.getByRole("list").evaluate((node) => node.scrollLeft)).toBeGreaterThan(100);
  await expect(archive.getByRole("list")).toHaveCSS("scroll-behavior", "auto");
  await archive.screenshot({ path: testInfo.outputPath("patch-archive-dark.png"), animations: "disabled" });
});

test("every patch remains available without JavaScript", async ({ browser }, testInfo) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: testInfo.project.use.viewport });
  const page = await context.newPage();
  try {
    await page.goto(`${testInfo.project.use.baseURL}/patches#archive`);
    const archive = page.locator("#archive");
    await expect(archive.getByRole("link")).toHaveCount(6);
    await expect(archive.getByRole("slider")).toHaveCount(0);
    await archive.getByRole("link", { name: "Patch 2.00.01", exact: true }).click();
    await expect(page).toHaveURL(/\/patches\/2-00-01$/);
    await expect(page.locator(".patch-heading h1")).toHaveText("Patch 2.00.01");
  } finally {
    await context.close();
  }
});
