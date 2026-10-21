import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    if (path.dirname(directory) !== tmpdir() || !["cd-verify-test-", "cd-report-hub-verify-"].some((prefix) => path.basename(directory).startsWith(prefix))) {
      throw new Error("Refusing to remove an unexpected test directory.");
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "cd-verify-test-"));
  directories.push(directory);
  mkdirSync(path.join(directory, "scripts"));
  copyFileSync("scripts/verify.mjs", path.join(directory, "scripts/verify.mjs"));
  writeFileSync(path.join(directory, ".node-version"), process.versions.node);
  const log = path.join(directory, "commands.jsonl");
  const npmCli = path.join(directory, "fake-npm.mjs");
  writeFileSync(npmCli, `
import { appendFileSync, existsSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "--version") {
  console.log(process.env.VERIFY_TEST_NPM_VERSION ?? "11.12.1");
  process.exit(0);
}
appendFileSync(process.env.VERIFY_TEST_LOG, JSON.stringify({
  args,
  seed: process.env.PREVIEW_SEED_FILE ?? null,
  warmUpPages: process.env.PLAYWRIGHT_WARM_UP_PAGES ?? null,
  now: process.env.PLAYWRIGHT_NOW ?? null,
  serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? null,
  ci: process.env.CI,
  marker: existsSync("gate-marker.txt") ? readFileSync("gate-marker.txt", "utf8") : null,
  localEnvPresent: existsSync(".env.local"),
}) + "\\n");
if (args[0] === process.env.VERIFY_TEST_FAIL) process.exit(7);
`);
  function run(extraEnv: Record<string, string> = {}, args: string[] = []) {
    const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
      !["npm_execpath", "npm_config_user_agent", "github_actions"].includes(name.toLowerCase()),
    ));
    const result = spawnSync(process.execPath, [path.join(directory, "scripts/verify.mjs"), ...args], {
      cwd: directory,
      encoding: "utf8",
      env: {
        ...inherited,
        NODE_ENV: process.env.NODE_ENV,
        GITHUB_ACTIONS: "true",
        npm_execpath: npmCli,
        npm_config_user_agent: "npm/11.12.1 verification-test",
        VERIFY_TEST_LOG: log,
        ...extraEnv,
      },
    });
    const commands = existsSync(log)
      ? readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line))
      : [];
    const snapshot = result.stdout.match(/^Working directory: (.+)$/m)?.[1].trim();
    if (snapshot && snapshot !== directory) directories.push(snapshot);
    return { result, commands };
  }
  function stage() {
    writeFileSync(path.join(directory, ".gitignore"), "commands.jsonl\n.env.local\noutput/\n");
    for (const args of [["init", "--quiet"], ["add", "."]]) {
      const result = spawnSync("git", ["-c", "core.excludesFile=", ...args], { cwd: directory, encoding: "utf8" });
      if (result.status !== 0) throw new Error(`Fixture Git setup failed: ${result.stderr}`);
    }
  }
  return { directory, run, stage };
}

describe("shared verification runner", () => {
  it("stops on a failed check and preserves its exit code", () => {
    const { result, commands } = fixture().run({ VERIFY_TEST_FAIL: "test" });
    expect(result.status, result.stderr).toBe(7);
    expect(result.stderr).toContain("FAILED: Unit tests. Do not push.");
    expect(commands.at(-1).args[0]).toBe("test");
    expect(commands.some(({ args }) => args.includes("build") || args.includes("playwright"))).toBe(false);
  });

  it("removes inherited service keys and limits fixture overrides to their own steps", () => {
    const { result, commands } = fixture().run({
      SUPABASE_SERVICE_ROLE_KEY: "must-not-reach-checks",
      PREVIEW_SEED_FILE: "private-preview.json",
      PLAYWRIGHT_WARM_UP_PAGES: "/inherited",
      PLAYWRIGHT_NOW: "2099-01-01T00:00:00.000Z",
      CI: "false",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(commands.every(({ serviceKey, ci }) => serviceKey === null && ci === "true")).toBe(true);
    const seeded = commands.filter(({ seed }) => seed !== null);
    expect(seeded.map(({ seed }) => seed)).toEqual([
      "tests/e2e/fixtures/platform-context-delayed.json",
      "tests/e2e/fixtures/platform-context-older-history.json",
      "tests/e2e/fixtures/observatory-recovery.json",
    ]);
    // The one-spec runs warm only the page they open; every other step warms its whole suite.
    const desk = (args: string[]) => args.includes("tests/e2e/expansion-desk.spec.ts");
    expect(commands.map(({ warmUpPages }) => warmUpPages)).toEqual(commands.map(({ seed, args }) =>
      seed !== null ? "/observatory" : desk(args) ? "/topics/charting-the-unknown" : null));
    // Only the expansion desk run moves the fixture clock, past the October notices it shows.
    expect(commands.filter(({ now }) => now !== null).map(({ args, now }) => ({ desk: desk(args), now })))
      .toEqual([{ desk: true, now: "2026-10-21T15:00:00.000Z" }]);
    expect(commands.at(-1).args).toEqual(["run", "test:e2e:turnstile"]);
    expect(commands.at(-1).seed).toBeNull();
  });

  it("rejects an unknown phase before running any check", () => {
    const { result, commands } = fixture().run({}, ["--skip-tests"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Usage:");
    expect(commands).toEqual([]);
  });

  it("runs every full-gate check in visible mode and adds headed only to browser tests", () => {
    const normal = fixture().run();
    const visible = fixture().run({}, ["--headed"]);
    expect(visible.result.status, visible.result.stderr).toBe(0);
    expect(visible.commands).toHaveLength(normal.commands.length);
    expect(visible.commands.map(({ args }) => args.filter((arg: string, index: number) =>
      arg !== "--headed" && !(arg === "--" && args[index + 1] === "--headed" && args[0] === "run"),
    ))).toEqual(normal.commands.map(({ args }) => args));
    const headed = visible.commands.filter(({ args }) => args.includes("--headed"));
    expect(headed).toHaveLength(8);
    expect(headed.map(({ seed }) => seed)).toEqual([
      null, null,
      "tests/e2e/fixtures/platform-context-delayed.json",
      "tests/e2e/fixtures/platform-context-older-history.json",
      "tests/e2e/fixtures/observatory-recovery.json",
      null, null, null,
    ]);
  });

  it("keeps the visual explorer isolated and never records it as a verification pass", () => {
    const { directory, run, stage } = fixture();
    stage();
    const { result, commands } = run({ GITHUB_ACTIONS: "false" }, ["--ui"]);
    expect(result.status, result.stderr).toBe(0);
    expect(commands.map(({ args }) => args)).toEqual([
      ["ci"],
      ["exec", "playwright", "--", "install", "chromium"],
      ["exec", "playwright", "--", "test", "--ui", "--ui-host=127.0.0.1", "--ui-port=3171"],
    ]);
    expect(result.stdout).not.toContain("[verify] PASS:");
    expect(existsSync(path.join(directory, "output/verification/latest.json"))).toBe(false);
  });

  it.each([["--ui", "--headed"], ["--core", "--headed"], ["--headed", "--headed"], ["--core", "--browser"]])(
    "rejects incompatible or duplicated verification options %j", (...args) => {
      const { result, commands } = fixture().run({}, args);
      expect(result.status).toBe(1);
      expect(commands).toEqual([]);
    },
  );

  it("splits the browser gate into the main suite and the other suites without dropping a suite", () => {
    const browser = fixture().run({}, ["--browser"]);
    const main = fixture().run({}, ["--browser-main"]);
    const other = fixture().run({}, ["--browser-other"]);
    for (const { result } of [browser, main, other]) expect(result.status, result.stderr).toBe(0);
    const setup = [["ci"], ["exec", "playwright", "--", "install", "chromium"]];
    expect(main.commands.slice(0, 2).map(({ args }) => args)).toEqual(setup);
    expect(other.commands.slice(0, 2).map(({ args }) => args)).toEqual(setup);
    expect(main.commands.slice(2).map(({ args }) => args)).toEqual([["run", "test:e2e"]]);
    expect([...main.commands.slice(2), ...other.commands.slice(2)].map(({ args, seed }) => ({ args, seed })))
      .toEqual(browser.commands.slice(2).map(({ args, seed }) => ({ args, seed })));
  });

  it("runs one shard of the main suite without rerunning its project dependencies", () => {
    const shard = fixture().run({}, ["--browser-main", "--shard=2/4"]);
    expect(shard.result.status, shard.result.stderr).toBe(0);
    expect(shard.commands.at(-1).args).toEqual(["run", "test:e2e", "--", "--no-deps", "--shard=2/4"]);
    const visible = fixture().run({}, ["--browser-main", "--headed", "--shard=4/4"]);
    expect(visible.result.status, visible.result.stderr).toBe(0);
    expect(visible.commands.at(-1).args).toEqual(["run", "test:e2e", "--", "--headed", "--no-deps", "--shard=4/4"]);
  });

  it.each([
    ["--shard=1/4"],
    ["--browser", "--shard=1/4"],
    ["--browser-other", "--shard=1/4"],
    ["--browser-main", "--shard=0/4"],
    ["--browser-main", "--shard=5/4"],
    ["--browser-main", "--shard=1/0"],
    ["--browser-main", "--shard=1/4x"],
    ["--browser-main", "--shard=1/4", "--shard=2/4"],
    ["--browser-main", "--browser-other"],
  ])("rejects a shard outside the main browser suite or an invalid shard %j", (...args) => {
    const { result, commands } = fixture().run({}, args);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Usage:");
    expect(commands).toEqual([]);
  });

  it("accepts the pinned npm executable even when an older launcher leaves its user-agent", () => {
    const { result, commands } = fixture().run({ npm_config_user_agent: "npm/10.9.8 node/v22.23.2 linux x64" });
    expect(result.status, result.stderr).toBe(0);
    expect(commands.at(-1).args).toEqual(["run", "test:e2e:turnstile"]);
  });

  it("rejects an unpinned npm executable even when its inherited user-agent claims the pinned version", () => {
    const { result, commands } = fixture().run({ VERIFY_TEST_NPM_VERSION: "10.9.8" });
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain("Verification requires Node");
    expect(commands).toEqual([]);
  });

  it("rejects an unstaged fix instead of passing a broken staged file", () => {
    const { directory, run, stage } = fixture();
    const marker = path.join(directory, "gate-marker.txt");
    writeFileSync(marker, "broken staged content");
    stage();
    writeFileSync(marker, "fixed but unstaged content");

    const { result, commands } = run({ GITHUB_ACTIONS: "false" });
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain("Unstaged tracked changes");
    expect(commands).toEqual([]);
  });

  it("rejects untracked source files that the commit would omit", () => {
    const { directory, run, stage } = fixture();
    stage();
    writeFileSync(path.join(directory, "unstaged-fix.ts"), "export const fixed = true;\n");

    const { result, commands } = run({ GITHUB_ACTIONS: "false" });
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain("Untracked files");
    expect(commands).toEqual([]);
  });

  it("verifies fully staged files without copying ignored credentials", () => {
    const { directory, run, stage } = fixture();
    writeFileSync(path.join(directory, "gate-marker.txt"), "staged content");
    writeFileSync(path.join(directory, ".env.local"), "SYNTHETIC_SECRET=not-for-verification\n");
    stage();

    const { result, commands } = run({ GITHUB_ACTIONS: "false" });
    expect(result.status, result.stderr).toBe(0);
    expect(commands.every(({ marker, localEnvPresent }) => marker === "staged content" && !localEnvPresent)).toBe(true);
    expect(JSON.parse(readFileSync(path.join(directory, "output/verification/latest.json"), "utf8")).status).toBe("passed");
  });
});
