import { expect, test } from "@playwright/test";
import { patch20300 } from "../../src/lib/editorialArticles";
import { SITE_URL } from "../../src/lib/site";
import { waitForHydration } from "./helpers";

for (const route of [
  { from: "/about", to: "/contact", link: "Contact" },
  { from: "/contact", to: "/privacy", link: "Privacy" },
  { from: "/privacy", to: "/about", link: "About" },
  { from: "/news", to: patch20300.path, link: patch20300.title },
]) {
  test(`slow-device navigation replaces metadata from ${route.from}`, async ({ page }) => {
    test.slow();
    // A quick click can hydrate the link before the separate metadata tree.
    // Throttling reproduces the persistent stale-head failure seen in CI.
    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setCPUThrottlingRate", { rate: 8 });
    await page.goto(route.from);
    await waitForHydration(page);
    await page.getByRole("link", { name: route.link, exact: true }).click();
    await page.waitForURL(new RegExp(`${route.to}$`), { timeout: 60_000, waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(new RegExp(`${route.to}$`));
    await expect.poll(() => page.locator('link[rel="canonical"]').evaluateAll((links) => links.map((link) => link.getAttribute("href"))))
      .toEqual([`${SITE_URL}${route.to}`]);
    await expect(page.locator('meta[property="og:url"]')).toHaveCount(1);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", `${SITE_URL}${route.to}`);
    await expect(page.locator('meta[name="description"]')).toHaveCount(1);
    await expect(page.locator("title")).toHaveCount(1);
  });
}
