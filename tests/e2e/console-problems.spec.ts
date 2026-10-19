import { expect, test } from "@playwright/test";
import { collectConsoleProblems } from "./helpers";

test("console checks skip only the Windows runner socket error, and say so", async ({ page }) => {
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.join(" ")); };
  try {
    await page.setContent("<p>console check</p>");
    const problems = collectConsoleProblems(page);
    await page.evaluate(() => {
      console.error("Failed to load resource: net::ERR_NO_BUFFER_SPACE");
      console.error("Failed to load resource: net::ERR_CONNECTION_REFUSED");
      console.error("Failed to load resource: net::ERR_FAILED");
      console.warn("Failed to load resource: net::ERR_NO_BUFFER_SPACE");
      console.error("Something else broke");
    });
    await expect.poll(() => problems.length).toBe(4);
    expect(problems).toEqual([
      "error: Failed to load resource: net::ERR_CONNECTION_REFUSED",
      "error: Failed to load resource: net::ERR_FAILED",
      "warning: Failed to load resource: net::ERR_NO_BUFFER_SPACE",
      "error: Something else broke",
    ]);
    expect(warnings).toEqual([
      `Ignored runner socket error net::ERR_NO_BUFFER_SPACE in ${test.info().titlePath.join(" › ")}`,
    ]);
  } finally {
    console.warn = warn;
  }
});
