import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { SOURCE_URL } from "../../src/lib/site";
import { collectConsoleProblems, expectHealthyPage } from "./helpers";

for (const theme of ["light", "dark"] as const) {
  test(`public endings keep one next step and a compact readable footer in ${theme} mode`, async ({ page }, testInfo) => {
    const problems = collectConsoleProblems(page);
    for (const [route, name] of [["/patches", "patches"], ["/articles/patch-2-02-00", "article"]]) {
      await page.goto(route);
      if (await page.locator("html").getAttribute("data-theme") !== theme) {
        await page.getByRole("button", { name: `Switch to ${theme} mode`, exact: true }).click();
      }
      const footer = page.getByRole("contentinfo");
      const links = footer.getByRole("navigation", { name: "Footer navigation" });
      await expect(links.getByRole("link")).toHaveCount(7);
      await expect(links.getByRole("link", { name: "Watch", exact: true })).toHaveAttribute("href", "/watch");
      await expect(links.getByRole("link", { name: "RSS feed for reports and patch rundowns", exact: true })).toHaveAttribute("href", "/rss.xml");
      await expect(links.getByRole("link", { name: "Atom feed for reports and patch rundowns", exact: true })).toHaveAttribute("href", "/feed.xml");
      await expect(links.getByRole("link", { name: "Add a check-in", exact: true })).toHaveAttribute("href", "/issues");
      await expect(links.getByRole("link", { name: "Contact", exact: true })).toHaveAttribute("href", "/contact");
      await expect(links.getByRole("link", { name: "Community", exact: true })).toHaveCount(0);
      // The source link is an icon beside the trust line, outside the text links.
      const source = footer.getByRole("link", { name: "Source code on GitHub", exact: true });
      await expect(source).toHaveAttribute("href", SOURCE_URL);
      await expect(footer).toContainText("No ads · No trackers");
      await expect(footer).toContainText("Not affiliated with or endorsed by Pearl Abyss.");
      await expect(footer.getByRole("link", { name: "Image source", exact: true })).toHaveAttribute("href", /^https:\/\//);
      await expect(page.getByRole("link", { name: "Back to top", exact: true })).toHaveCount(1);
      if (name === "patches") {
        const ending = page.getByRole("region", { name: "The player record", exact: true });
        await expect(ending.getByRole("link", { name: "View player reports", exact: true })).toHaveCount(1);
        await expect(page.getByRole("link", { name: "Next: The player record", exact: true })).toHaveCount(0);
      } else {
        await expect(page.getByRole("link", { name: "More from the news desk", exact: true })).toHaveAttribute("href", "/news");
      }
      for (const link of await links.getByRole("link").all()) {
        expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      const sourceBox = (await source.boundingBox())!;
      expect(sourceBox.width).toBeGreaterThanOrEqual(44);
      expect(sourceBox.height).toBeGreaterThanOrEqual(44);
      if (testInfo.project.name === "mobile-chromium") {
        expect((await footer.boundingBox())!.height).toBeLessThanOrEqual(240);
      }
      await expectHealthyPage(page, problems);
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
      await expect(footer).toBeInViewport({ ratio: 1 });
      mkdirSync("output/playwright", { recursive: true });
      await page.screenshot({ animations: "disabled", path: `output/playwright/${name}-ending-${theme}-${testInfo.project.name}.png` });
      if (testInfo.project.name === "mobile-chromium") {
        await page.setViewportSize({ width: 320, height: 844 });
        await expectHealthyPage(page, problems);
        expect((await footer.boundingBox())!.height).toBeLessThanOrEqual(280);
        await page.setViewportSize({ width: 390, height: 844 });
      }
    }
  });
}

test("public information stays readable without access to the source repository", async ({ page }, testInfo) => {
  const problems = collectConsoleProblems(page);
  for (const route of ["/about", "/privacy", "/contact"]) {
    await page.goto(route);
    const main = page.getByRole("main");
    // Only the shared footer links to the source; the page content itself does not.
    await expect(main.locator('a[href*="github.com/Statusnone420"]')).toHaveCount(0);
    await expect(main).not.toContainText(/open.source|source repository/i);
    if (route === "/about") {
      await expect(main.getByRole("link", { name: "Privacy", exact: true })).toHaveAttribute("href", "/privacy");
      await expect(main.getByRole("link", { name: "Pearl Abyss support", exact: true }))
        .toHaveAttribute("href", "https://support.pearlabyss.com/");
    } else if (route === "/privacy") {
      await expect(main.getByRole("link", { name: "Method · privacy", exact: true })).toHaveAttribute("href", "/about#privacy");
      await expect(main).toContainText("The database does not store raw IP addresses.");
      await expect(main).toContainText("Private problem reports");
      await expect(main).toContainText("salted one-way hashes");
    } else {
      await expect(main.getByRole("link", { name: "Pearl Abyss support", exact: true })).toHaveAttribute("href", "https://support.pearlabyss.com/");
      await expect(main.getByRole("link", { name: "Find an issue to check in on", exact: true })).toHaveAttribute("href", "/issues");
      await expect(main).toContainText("Reports go privately to Crimson Desert Report Hub.");
      await expect(main).toContainText("No account is needed.");
    }
    for (const theme of ["light", "dark"] as const) {
      if (await page.locator("html").getAttribute("data-theme") !== theme) {
        await page.getByRole("button", { name: `Switch to ${theme} mode`, exact: true }).click();
      }
      await expectHealthyPage(page, problems);
      mkdirSync("output/playwright", { recursive: true });
      await page.screenshot({ fullPage: true, animations: "disabled", path: `output/playwright/${route.slice(1)}-${theme}-${testInfo.project.name}.png` });
    }
    if (testInfo.project.name === "mobile-chromium") {
      await page.setViewportSize({ width: 320, height: 844 });
      await expectHealthyPage(page, problems);
      await page.setViewportSize({ width: 390, height: 844 });
    }
  }
});

test("contact stays public and navigation keeps unique metadata", async ({ page, request }) => {
  test.slow();
  const canonicalUrls = () => page.locator('link[rel="canonical"]').evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  const contact = await request.get("/contact", { maxRedirects: 0 });
  expect(contact.status()).toBe(200);
  const response = await page.goto("/contact");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/contact$/);
  await expect.poll(canonicalUrls).toEqual(["https://crimsonreporthub.com/contact"]);

  for (let visit = 0; visit < 3; visit += 1) {
    await page.getByRole("navigation", { name: "Footer navigation" })
      .getByRole("link", { name: "Privacy", exact: true }).click();
    await page.waitForURL(/\/privacy$/, { timeout: 60_000, waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/privacy$/);
    await expect.poll(canonicalUrls).toEqual(["https://crimsonreporthub.com/privacy"]);
    await expect(page).toHaveTitle("Privacy · Crimson Desert Report Hub");
    await page.goBack();
    await page.waitForURL(/\/contact$/, { timeout: 60_000, waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/contact$/);
    await expect.poll(canonicalUrls).toEqual(["https://crimsonreporthub.com/contact"]);
  }

  await page.reload();
  await expect.poll(canonicalUrls).toEqual(["https://crimsonreporthub.com/contact"]);
});
