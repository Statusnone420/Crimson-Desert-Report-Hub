import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

const port = 3106;
export default defineConfig({
  ...base,
  testDir: "./tests/patch-e2e",
  globalSetup: "./tests/patch-e2e/global-setup.ts",
  testMatch: "patch-rundowns.spec.ts",
  testIgnore: [],
  workers: 1,
  use: { ...base.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    command: "node tests/e2e/mock-dev-server.mjs",
    url: `http://127.0.0.1:${port}`,
    env: {
      ...process.env,
      PLAYWRIGHT_PORT: String(port),
      PLAYWRIGHT_SUPABASE_PORT: "18771",
      PLAYWRIGHT_NOW: "2026-09-21T19:00:00.000Z",
      PREVIEW_SEED_FILE: "tests/e2e/fixtures/patch-rundowns.json",
      CD_REVIEW_BUILD: "true",
    },
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: base.projects?.filter((project) => project.name !== "operator-writes").map((project) => ({ ...project, dependencies: [], testIgnore: [], testMatch: "patch-rundowns.spec.ts" })),
});
