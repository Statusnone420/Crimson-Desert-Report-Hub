import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_TURNSTILE_PORT ?? 3202);
const supabasePort = Number(process.env.PLAYWRIGHT_TURNSTILE_SUPABASE_PORT ?? 18767);

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "turnstile-theme.spec.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  outputDir: "test-results/turnstile",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node tests/e2e/mock-dev-server.mjs",
    url: `http://127.0.0.1:${port}`,
    env: {
      ...process.env,
      PLAYWRIGHT_PORT: String(port),
      PLAYWRIGHT_SUPABASE_PORT: String(supabasePort),
      PLAYWRIGHT_TURNSTILE: "true",
      PREVIEW_SEED_FILE: "",
      CD_REVIEW_BUILD: "true",
      CD_LOCAL_SNAPSHOT: "false",
      VERCEL_ENV: "",
    },
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: "turnstile-desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1100 } } },
    { name: "turnstile-mobile", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
  ],
});
