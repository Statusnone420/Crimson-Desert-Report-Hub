import { expect, test, type Page } from "@playwright/test";
import { collectConsoleProblems } from "./helpers";

const SOCKET_ERROR = "Failed to load resource: net::ERR_NO_BUFFER_SPACE";
const ORIGIN = "http://127.0.0.1:3100";
const PAGE = `${ORIGIN}/console-check`;
// The stand-in page loads each file below as a script that logs one console
// message, so the message carries that file's URL the way a failed font load does.
const FILES: Array<[path: string, script: string]> = [
  ["/_next/static/media/ibm_plex_mono_400_latin_ext-s.p.1u30mmyq6lnsd.woff2", `console.error(${JSON.stringify(SOCKET_ERROR)})`],
  ["/_next/static/chunks/src_0_c5ct2._.js", `console.error(${JSON.stringify(SOCKET_ERROR)})`],
  ["/api/checkins", `console.error(${JSON.stringify(SOCKET_ERROR)})`],
  ["/_next/static/media/ibm_plex_mono_400_latin-s.p.40sczeszzbjw1.woff2", `console.error("Failed to load resource: net::ERR_CONNECTION_REFUSED")`],
  ["/_next/static/media/ibm_plex_mono_500_latin-s.p.0oace-s_gkfks.woff2", `console.warn(${JSON.stringify(SOCKET_ERROR)})`],
];
const EVERY_MESSAGE = [
  `error: ${SOCKET_ERROR}`,
  `error: ${SOCKET_ERROR}`,
  `error: ${SOCKET_ERROR}`,
  "error: Failed to load resource: net::ERR_CONNECTION_REFUSED",
  `warning: ${SOCKET_ERROR}`,
];

type Runner = { CI?: string; GITHUB_ACTIONS?: string; platform: NodeJS.Platform };

function setEnv(name: "CI" | "GITHUB_ACTIONS", value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

// collectConsoleProblems checks the runner when it starts, so the stand-in
// runner only has to last for that call.
function collectOn(page: Page, runner: Runner) {
  const saved = { CI: process.env.CI, GITHUB_ACTIONS: process.env.GITHUB_ACTIONS, platform: process.platform };
  setEnv("CI", runner.CI);
  setEnv("GITHUB_ACTIONS", runner.GITHUB_ACTIONS);
  Object.defineProperty(process, "platform", { value: runner.platform });
  try {
    return collectConsoleProblems(page);
  } finally {
    setEnv("CI", saved.CI);
    setEnv("GITHUB_ACTIONS", saved.GITHUB_ACTIONS);
    Object.defineProperty(process, "platform", { value: saved.platform });
  }
}

test("console checks skip the runner socket error only for a font file on GitHub's Windows runners", async ({ page }) => {
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.join(" ")); };
  try {
    const scripts = new Map(FILES.map(([path, script]) => [ORIGIN + path, script]));
    await page.route(`${ORIGIN}/**`, (route) => {
      const url = route.request().url();
      if (url === PAGE) {
        const body = `<!doctype html><link rel="icon" href="data:,">${FILES.map(([path]) => `<script src="${path}"></script>`).join("")}`;
        return route.fulfill({ contentType: "text/html", body });
      }
      return route.fulfill({ contentType: "text/javascript", body: scripts.get(url) });
    });
    const githubWindows = collectOn(page, { CI: "true", GITHUB_ACTIONS: "true", platform: "win32" });
    // npm run verify sets CI on every machine.
    const localVerify = collectOn(page, { CI: "true", platform: "win32" });
    const localRun = collectOn(page, { platform: "win32" });
    const githubLinux = collectOn(page, { CI: "true", GITHUB_ACTIONS: "true", platform: "linux" });

    await page.goto(PAGE);

    await expect.poll(() => githubLinux.length).toBe(EVERY_MESSAGE.length);
    expect(githubWindows).toEqual(EVERY_MESSAGE.slice(1));
    expect(localVerify).toEqual(EVERY_MESSAGE);
    expect(localRun).toEqual(EVERY_MESSAGE);
    expect(githubLinux).toEqual(EVERY_MESSAGE);
    expect(warnings).toEqual([
      `Ignored runner socket error net::ERR_NO_BUFFER_SPACE in ${test.info().titlePath.join(" › ")} (${ORIGIN}${FILES[0][0]})`,
    ]);
  } finally {
    console.warn = warn;
  }
});
