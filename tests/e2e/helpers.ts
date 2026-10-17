import { expect, type Page } from "@playwright/test";

export function collectConsoleProblems(page: Page, expectedNotFoundUrl?: string): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      if (message.text().includes("/_next/webpack-hmr") && message.text().includes("WebSocket connection")) {
        return;
      }
      // Motion announces the requested OS preference in development. This is
      // informational; hydration warnings and all application errors still fail.
      if (message.type() === "warning" && message.text() === "You have Reduced Motion enabled on your device. Animations may not appear as expected.. For more information and steps for solving, visit https://motion.dev/troubleshooting/reduced-motion-disabled") return;
      if (expectedNotFoundUrl && message.location().url === expectedNotFoundUrl && message.text() === "Failed to load resource: the server responded with a status of 404 (Not Found)") return;
      problems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    problems.push(`pageerror: ${error.message}`);
  });
  return problems;
}

export async function expectHealthyPage(page: Page, problems: string[]) {
  await expect(page.locator("body")).not.toHaveText("");
  await expect(page.getByText(/Application error|Unhandled Runtime Error|Failed to compile/i)).toHaveCount(0);
  expect(problems).toEqual([]);
  // The page body must never scroll sideways — wide content scrolls in its own container.
  const layout = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const scrollWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    const offenders = [...document.querySelectorAll("body *")]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || (rect.left >= -1 && rect.right <= viewportWidth + 1)) return false;

        let parent = element.parentElement;
        while (parent && parent !== document.body) {
          const overflowX = getComputedStyle(parent).overflowX;
          if (["auto", "scroll", "hidden", "clip"].includes(overflowX)) return false;
          parent = parent.parentElement;
        }
        return true;
      })
      .slice(0, 8)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          element: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${
            element.getAttribute("class")
              ? `.${element.getAttribute("class")?.trim().replace(/\s+/g, ".")}`
              : ""
          }`,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          text: element.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) ?? "",
          width: Math.round(rect.width),
        };
      });

    return { offenders, scrollWidth, viewportWidth };
  });
  expect(
    layout.scrollWidth,
    `page has horizontal overflow:\n${JSON.stringify(layout, null, 2)}`,
  ).toBeLessThanOrEqual(layout.viewportWidth + 1);
}

export async function signInAsAdmin(page: Page) {
  const response = await page.request.post("/api/admin/login", { data: { password: "admin-password" } });
  expect(response.ok()).toBe(true);
}

/** Refresh mock-backed reads after fixture changes. Next's development server
 * recomputes its data cache for no-cache requests; no settings write is needed. */
export async function refreshFixtureReads(page: Page, paths = ["/", "/issues", "/scanner"]) {
  for (const path of paths) {
    const response = await page.request.get(path, { headers: { "cache-control": "no-cache" } });
    expect(response.ok(), `fixture refresh failed for ${path}`).toBe(true);
    await response.body();
  }
}
