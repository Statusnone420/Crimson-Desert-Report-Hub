import { expect, test, type Locator, type Page } from "@playwright/test";

// A next/font file served by the local test server.
const LOCAL_FONT_FILE = /^http:\/\/127\.0\.0\.1:\d+\/_next\/static\/media\/[^/?#]+\.woff2$/;

export function collectConsoleProblems(page: Page, expectedNotFoundUrl?: string): string[] {
  const problems: string[] = [];
  const spec = test.info().titlePath.join(" › ");
  // npm run verify sets CI on every machine; only GitHub's runners set GITHUB_ACTIONS.
  const githubWindowsRunner = process.env.GITHUB_ACTIONS === "true" && process.platform === "win32";
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      if (message.text().includes("/_next/webpack-hmr") && message.text().includes("WebSocket connection")) {
        return;
      }
      // On GitHub's Windows runners, Chromium sometimes fails one of the font
      // files a page preloads all at once from the local test server. It reports
      // the Windows socket error WSAENOBUFS as net::ERR_NO_BUFFER_SPACE. Skip
      // only that case, and print it so the CI log shows how often it happens.
      // The same code from any other file, or on any other machine, still fails.
      if (
        githubWindowsRunner &&
        message.type() === "error" &&
        message.text() === "Failed to load resource: net::ERR_NO_BUFFER_SPACE" &&
        LOCAL_FONT_FILE.test(message.location().url)
      ) {
        console.warn(`Ignored runner socket error net::ERR_NO_BUFFER_SPACE in ${spec} (${message.location().url})`);
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

/**
 * Wait until React has hydrated the page, so a click, hover, key press or fill reaches its
 * handler. A slow runner paints server-rendered controls seconds before then, and React drops
 * an event it cannot handle yet. React marks <body> when it commits the hydrated page. A
 * Suspense boundary hydrates after that, so for a control inside one, pass the control.
 */
export async function waitForHydration(page: Page, control?: Locator) {
  if (control) {
    await expect.poll(() => control.evaluate((element) => Object.keys(element).some((key) => key.startsWith("__reactProps$"))), { timeout: 30_000 }).toBe(true);
    return;
  }
  await page.waitForFunction(() => Object.keys(document.body).some((key) => key.startsWith("__reactFiber$")), undefined, { timeout: 30_000 });
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
