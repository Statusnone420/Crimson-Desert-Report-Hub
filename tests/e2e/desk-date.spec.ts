import { expect, test } from "@playwright/test";
import { collectConsoleProblems, expectHealthyPage } from "./helpers";

// The desk day must not follow the reader's local timezone.
test.use({ timezoneId: "Asia/Tokyo" });

test("all public mastheads use today's desk date despite older server renders", async ({ page }) => {
  // The fixture server renders in July. A September browser must never inherit
  // that date, even when navigating between independently cached routes.
  await page.clock.setFixedTime(new Date("2026-09-06T13:00:00Z"));
  const problems = collectConsoleProblems(page);
  for (const route of ["/", "/issues", "/report", "/about", "/privacy", "/news"]) {
    await page.goto(route);
    await expect(page.locator(".topline > div").first()).toHaveText("Sunday, September 6, 2026");
    await expectHealthyPage(page, problems);
  }
});

test("cached HTML cannot print a stale date when JavaScript is disabled", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    for (const route of ["/", "/issues", "/report"]) {
      await page.goto(`http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? 3100}${route}`);
      await expect(page.locator(".topline > div").first()).toHaveText("Eastern Time");
    }
  } finally {
    await context.close();
  }
});

test("open mastheads roll over at New York midnight and refresh on return", async ({ context }) => {
  // One clock controls the entire context. Let navigation finish before pausing it.
  await context.clock.install({ time: new Date("2026-09-07T03:00:00Z") });
  const pages = await Promise.all([context.newPage(), context.newPage(), context.newPage()]);
  const routes = ["/", "/issues", "/report"];
  for (const [index, page] of pages.entries()) {
    await page.goto(routes[index]);
    await expect(page.locator(".topline > div").first()).toHaveText("Sunday, September 6, 2026");
  }
  await context.clock.pauseAt(new Date("2026-09-07T03:59:50Z"));
  await context.clock.runFor(10_100);
  for (const page of pages) {
    await expect(page.locator(".topline > div").first()).toHaveText("Monday, September 7, 2026");
  }
  await context.clock.setSystemTime(new Date("2026-09-08T13:00:00Z"));
  for (const page of pages) {
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.locator(".topline > div").first()).toHaveText("Tuesday, September 8, 2026");
  }
  await context.clock.setSystemTime(new Date("2026-09-09T13:00:00Z"));
  for (const page of pages) {
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.locator(".topline > div").first()).toHaveText("Wednesday, September 9, 2026");
  }
});
