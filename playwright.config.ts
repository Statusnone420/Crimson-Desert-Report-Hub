import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3100);

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: "n0.spec.ts",
  fullyParallel: false,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      animations: "disabled",
      maxDiffPixelRatio: 0.02,
    },
  },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "node tests/e2e/mock-dev-server.mjs",
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{arg}{ext}",
  projects: [
    {
      // Runs first and alone. These tests mutate the shared fixture, and the two
      // screenshot projects render from that same mock server in parallel
      // workers, so a write landing mid-render would drift a baseline. Going
      // first rather than last also keeps the order of proof right: a drifted
      // screenshot must not be able to cancel the only coverage that shows the
      // admin RPCs still work. Each test restores the fixture as it finishes.
      name: "operator-writes",
      testMatch: "operator-writes.spec.ts",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1100 } },
    },
    {
      name: "chromium",
      // A project-level testIgnore replaces the top-level one, so n0 repeats here.
      testIgnore: ["n0.spec.ts", "operator-writes.spec.ts"],
      dependencies: ["operator-writes"],
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1100 } },
    },
    {
      name: "mobile-chromium",
      // A project-level testIgnore replaces the top-level one, so n0 repeats here.
      testIgnore: ["n0.spec.ts", "operator-writes.spec.ts"],
      dependencies: ["operator-writes"],
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } },
    },
  ],
});
