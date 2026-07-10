import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_N0_PORT ?? 3200);

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "n0.spec.ts",
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${port}`,
  },
  webServer: {
    command: "node tests/e2e/empty-dev-server.mjs",
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
