import path from "node:path";
import { defineConfig } from "vitest/config";

// Separate from the root vitest config on purpose. The root config includes only
// `tests/**`, so `npm run test` and CI can never pick this up and hit the network.
const ROOT = path.resolve(__dirname, "..", "..");

export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/bakeoff/**/*.bakeoff.ts"],
    // The report IS the output of this tool. Vitest intercepts console by default and
    // would leave the run looking like a silent pass.
    disableConsoleIntercept: true,
    // One live query per candidate; the whole run is well inside a minute, but the
    // network is the network.
    testTimeout: 300_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(ROOT, "src"),
      "server-only": path.resolve(ROOT, "tests/server-only-stub.ts"),
    },
  },
});
