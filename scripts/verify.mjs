import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = process.argv.slice(2);
const headed = options.includes("--headed");
const shards = options.filter((option) => option.startsWith("--shard="));
const phases = options.filter((option) => option !== "--headed" && !option.startsWith("--shard="));
const mode = phases[0] ?? "--all";
const nodeVersion = readFileSync(path.join(root, ".node-version"), "utf8").trim();
const npmVersion = "11.12.1";
const npmCli = process.env.npm_execpath;

// GitHub splits the browser gate across runners: --browser-main runs the main
// suite (optionally one --shard=N/M of it), and --browser-other runs the rest.
const shardMatch = shards.length === 1 ? /^--shard=([1-9]\d*)\/([1-9]\d*)$/.exec(shards[0]) : null;
if (!["--all", "--core", "--browser", "--browser-main", "--browser-other", "--ui"].includes(mode) || phases.length > 1 ||
    options.filter((option) => option === "--headed").length > 1 ||
    (headed && ["--core", "--ui"].includes(mode)) ||
    (shards.length > 0 && (mode !== "--browser-main" || !shardMatch || Number(shardMatch[1]) > Number(shardMatch[2])))) {
  console.error("Usage: npm run verify [-- --core|--browser|--browser-main [--shard=N/M]|--browser-other|--ui] [--headed]");
  process.exit(1);
}
// npm_config_user_agent can survive from an older outer npm launcher.
// Query the executable that will actually run every check.
const npmCheck = npmCli ? spawnSync(process.execPath, [npmCli, "--version"], { encoding: "utf8" }) : null;
if (process.versions.node !== nodeVersion || npmCheck?.error || npmCheck?.status !== 0 || npmCheck?.stdout.trim() !== npmVersion) {
  console.error(`Verification requires Node ${nodeVersion} and npm ${npmVersion}. Run npm run verify to use the pinned tools.`);
  process.exit(1);
}

const core = [
  ["Lint", ["run", "lint"]],
  ["Unit tests", ["test", "--", "--maxWorkers=2"]],
  ["Type check", ["exec", "tsc", "--", "--noEmit"]],
  ["Production build", ["run", "build"]],
];
const browser = [
  ["Install Chromium", ["exec", "playwright", "--", "install", "chromium"]],
  ["Desktop, mobile, and operator tests", ["run", "test:e2e"]],
  ["Patch publication and archive", ["run", "test:e2e:patches"]],
  // These runs open only /observatory, so the main warm-up skips the rest of the suite's routes.
  ["Delayed Twitch history", ["exec", "playwright", "--", "test", "tests/e2e/observatory-polish.spec.ts", "--no-deps", "--grep", "recorded Twitch history"], { PREVIEW_SEED_FILE: "tests/e2e/fixtures/platform-context-delayed.json", PLAYWRIGHT_WARM_UP_PAGES: "/observatory" }],
  ["Older Twitch history", ["exec", "playwright", "--", "test", "tests/e2e/observatory-polish.spec.ts", "--no-deps", "--grep", "recorded Twitch history"], { PREVIEW_SEED_FILE: "tests/e2e/fixtures/platform-context-older-history.json", PLAYWRIGHT_WARM_UP_PAGES: "/observatory" }],
  ["IGDB platform recovery", ["exec", "playwright", "--", "test", "tests/e2e/observatory-polish.spec.ts", "--no-deps", "--grep", "platform record retains"], { PREVIEW_SEED_FILE: "tests/e2e/fixtures/observatory-recovery.json", PLAYWRIGHT_WARM_UP_PAGES: "/observatory" }],
  ["Empty and unavailable states", ["run", "test:e2e:n0"]],
  ["Turnstile themes", ["run", "test:e2e:turnstile"]],
];
if (headed) {
  for (const [, args] of browser.slice(1)) {
    if (args[0] === "run") args.push("--");
    args.push("--headed");
  }
}
if (shardMatch) {
  // A shard without the operator-writes tests would otherwise rerun that whole
  // project as a dependency. One CI worker still runs the projects in config
  // order, so the fixture writes never overlap a screenshot.
  const args = browser[1][1];
  if (!args.includes("--")) args.push("--");
  args.push("--no-deps", shards[0]);
}

// Require the working files to match the staged commit before copying them.
// Ignored credentials, dependencies, caches, and preview data stay excluded.
function sourceFiles() {
  const options = { cwd: root, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 };
  const unstaged = spawnSync("git", ["diff", "--quiet", "--no-ext-diff"], options);
  if (unstaged.error || unstaged.status !== 0) {
    console.error(unstaged.status === 1
      ? "Unstaged tracked changes would differ from the commit. Stage the intended changes before verification."
      : "Cannot compare the working files with the Git index.");
    process.exit(1);
  }
  const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], options);
  if (untracked.error || untracked.status !== 0 || untracked.stdout) {
    console.error(untracked.status === 0
      ? "Untracked files would be omitted from the commit. Stage intended files or ignore local-only files before verification."
      : "Cannot check for untracked repository files.");
    process.exit(1);
  }
  const listed = spawnSync("git", ["ls-files", "--cached", "-z"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (listed.error || listed.status !== 0) {
    console.error("Cannot list the repository files for clean verification.");
    process.exit(1);
  }
  return [...new Set(listed.stdout.split("\0").filter(Boolean))].filter((file) => existsSync(path.join(root, file))).sort();
}

function sourceDigest(files) {
  const hash = createHash("sha256");
  for (const file of files) {
    const source = path.join(root, file);
    if (!lstatSync(source).isFile()) throw new Error(`Verification requires a regular file: ${file}`);
    hash.update(file).update("\0").update(readFileSync(source)).update("\0");
  }
  return hash.digest("hex");
}

let directory = root;
let originalDigest;
if (process.env.GITHUB_ACTIONS !== "true") {
  const files = sourceFiles();
  originalDigest = sourceDigest(files);
  directory = mkdtempSync(path.join(tmpdir(), "cd-report-hub-verify-"));
  for (const file of files) {
    const source = path.join(root, file);
    const target = path.join(directory, file);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
}

// Inherited service credentials and preview overrides must not alter the gate.
const env = { ...process.env };
for (const name of Object.keys(env)) {
  if (/^(SUPABASE_|NEXT_PUBLIC_|VERCEL_|TAVILY_|OPENROUTER_|AI_SETTINGS_|TWITCH_|IGDB_|STEAM_|TURNSTILE_|PROBLEM_REPORT_|ADMIN_|SESSION_|CRON_|CD_|PLAYWRIGHT_|PREVIEW_SEED_FILE$|NODE_OPTIONS$|NODE_ENV$)/i.test(name)) {
    delete env[name];
  }
}
env.CI = "true";
env.NEXT_TELEMETRY_DISABLED = "1";

console.log(`Verification: ${mode.slice(2)}; Node ${process.versions.node}; npm ${npmVersion}`);
console.log(`Working directory: ${directory}`);
if (mode === "--ui") {
  console.log("Visual test explorer: http://127.0.0.1:3171");
  console.log("This explorer uses the main browser suite. Run npm run verify:visible for the complete verification gate.");
}
const steps = [
  ["Clean dependency install", ["ci"]],
  ...(["--all", "--core"].includes(mode) ? core : []),
  ...(["--all", "--browser"].includes(mode) ? browser : []),
  ...(mode === "--browser-main" ? browser.slice(0, 2) : []),
  ...(mode === "--browser-other" ? [browser[0], ...browser.slice(2)] : []),
  ...(mode === "--ui" ? [
    browser[0],
    ["Visual test explorer", ["exec", "playwright", "--", "test", "--ui", "--ui-host=127.0.0.1", "--ui-port=3171"], {
      PLAYWRIGHT_PORT: "3155",
      PLAYWRIGHT_SUPABASE_PORT: "18855",
    }],
  ] : []),
];
for (const [label, args, overrides = {}] of steps) {
  console.log(`\n[verify] ${label}`);
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    cwd: directory,
    env: { ...env, ...overrides },
    stdio: "inherit",
  });
  if (result.error || result.status !== 0) {
    console.error(`[verify] FAILED: ${label}. Do not push. Evidence remains in ${directory}.`);
    process.exit(result.status || 1);
  }
}
if (mode === "--ui") {
  console.log("Visual test explorer closed. Run npm run verify or npm run verify:visible to record a full verification pass.");
  process.exit(0);
}
if (originalDigest && originalDigest !== sourceDigest(sourceFiles())) {
  console.error("[verify] Source files changed during verification. Run the checks again before pushing.");
  process.exit(1);
}
if (mode === "--all" && originalDigest) {
  const evidence = path.join(root, "output", "verification", "latest.json");
  mkdirSync(path.dirname(evidence), { recursive: true });
  writeFileSync(evidence, JSON.stringify({
    status: "passed",
    verifiedAt: new Date().toISOString(),
    sourceDigest: originalDigest,
    nodeVersion,
    npmVersion,
    headed,
    directory,
    steps: steps.map(([label]) => label),
  }, null, 2) + "\n");
}
console.log(`\n[verify] PASS: ${mode.slice(2)}. Evidence remains in ${directory}.`);
