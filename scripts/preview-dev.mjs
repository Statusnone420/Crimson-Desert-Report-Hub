/**
 * Local preview against the invented database: boots the same in-memory
 * PostgREST shim the Playwright suite uses, but seeded from the repo-ignored
 * preview-data/seed.json (generate it with `npm run preview:seed`).
 *
 * Ports are offset from the Playwright defaults so a test run and a preview
 * can coexist. No real Supabase, no network writes, nothing to clean up.
 */
import { existsSync } from "node:fs";

process.env.PREVIEW_SEED_FILE ??= "preview-data/seed.json";
process.env.PLAYWRIGHT_PORT ??= "3130";
process.env.PLAYWRIGHT_SUPABASE_PORT ??= "18790";

if (!existsSync(process.env.PREVIEW_SEED_FILE)) {
  console.error(
    `[preview] ${process.env.PREVIEW_SEED_FILE} not found. Run \`npm run preview:seed\` first (see scripts/generate-preview-seed.mjs for options).`,
  );
  process.exit(1);
}

console.log(`[preview] http://127.0.0.1:${process.env.PLAYWRIGHT_PORT} (seed: ${process.env.PREVIEW_SEED_FILE})`);
await import("../tests/e2e/mock-dev-server.mjs");
