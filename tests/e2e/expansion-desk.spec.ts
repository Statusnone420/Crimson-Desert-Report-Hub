import { expect, test } from "@playwright/test";
import { collectConsoleProblems, expectHealthyPage, waitForHydration } from "./helpers";

// The desk lists the Oct 8 short and the Oct 20 overview only once the server clock has passed them.
// npm run verify runs this file again with PLAYWRIGHT_NOW set to Oct 21; the main suite's July clock skips it.
const now = Date.parse(process.env.PLAYWRIGHT_NOW ?? "2026-07-20T00:10:00.000Z");
test.skip(now < Date.parse("2026-10-20T23:00:00Z"), "The server clock is before the Oct 20 notice.");

test("the expansion desk loads a YouTube player only after a reader presses play", async ({ page }) => {
  const problems = collectConsoleProblems(page);
  const playerRequests: string[] = [];
  // Nothing leaves the test machine; a request here proves the player was asked for.
  await page.route("https://www.youtube-nocookie.com/**", (route) => {
    playerRequests.push(route.request().url());
    return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Player</title>" });
  });
  await page.goto("/topics/charting-the-unknown");
  await waitForHydration(page);
  await expect(page.locator(".article-deck")).toContainText("Oct 29, 22:00 UTC.");
  await expect(page.locator(".desk-price")).toContainText("$24.99 on Steam (US store)");

  const overview = page.getByRole("button", { name: "Play Features Overview video" });
  const short = page.getByRole("button", { name: "Play “Dive into the unknown” short" });
  await expect(overview).toBeVisible();
  await expect(short).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
  expect(playerRequests).toEqual([]);

  await overview.click();
  const player = page.locator("iframe");
  await expect(player).toHaveCount(1);
  await expect(player).toHaveAttribute("src", /^https:\/\/www\.youtube-nocookie\.com\/embed\/k9WnZqkAFis\?/);
  await expect(player).toBeFocused();
  await expect.poll(() => playerRequests.length).toBe(1);

  await short.click();
  await expect(page.locator("iframe")).toHaveCount(2);
  await expect(page.locator("iframe").nth(1)).toHaveAttribute("src", /^https:\/\/www\.youtube-nocookie\.com\/embed\/er6wiBEXYYs\?/);
  await expectHealthyPage(page, problems);
});
