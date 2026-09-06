import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const unavailablePort = Number(process.env.PLAYWRIGHT_N0_PORT ?? 3200);
const zeroPort = Number(process.env.PLAYWRIGHT_N0_ZERO_PORT ?? 3201);
const zeroSupabasePort = Number(process.env.PLAYWRIGHT_N0_SUPABASE_PORT ?? 18766);

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "n0.spec.ts",
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node tests/e2e/empty-dev-server.mjs",
      url: `http://127.0.0.1:${unavailablePort}`,
      env: {
        ...process.env,
        PLAYWRIGHT_N0_PORT: String(unavailablePort),
        CD_REVIEW_BUILD: "true",
        CD_LOCAL_SNAPSHOT: "false",
        STEAM_PULSE_ENABLED: "false",
        STEAM_PLAYER_COUNTS_ENABLED: "false",
        TWITCH_CLIENT_ID: "",
        TWITCH_CLIENT_SECRET: "",
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "node tests/e2e/mock-dev-server.mjs",
      url: `http://127.0.0.1:${zeroPort}`,
      env: {
        ...process.env,
        PLAYWRIGHT_PORT: String(zeroPort),
        PLAYWRIGHT_SUPABASE_PORT: String(zeroSupabasePort),
        PREVIEW_SEED_FILE: path.join(process.cwd(), "tests", "e2e", "fixtures", "n0-seed.json"),
        CD_LOCAL_SNAPSHOT: "true",
        CD_REVIEW_BUILD: "false",
        VERCEL_ENV: "",
        ADMIN_PASSWORD: "",
        SESSION_SECRET: "",
        STEAM_PULSE_ENABLED: "false",
        STEAM_PLAYER_COUNTS_ENABLED: "false",
        TWITCH_CLIENT_ID: "",
        TWITCH_CLIENT_SECRET: "",
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: "unavailable",
      grep: /missing services stay unavailable instead of becoming a false zero/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${unavailablePort}` },
    },
    {
      name: "true-zero",
      grep: /connected empty tables render honest zero states/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${zeroPort}` },
    },
  ],
});
