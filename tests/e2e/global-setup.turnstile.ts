import type { FullConfig } from "@playwright/test";
import { warmUp, type WarmUpRoutes } from "./warm-up";

// Every route turnstile-theme.spec.ts opens, and no other. tests/e2eWarmUp.test.ts fails when the two differ.
export const routes: WarmUpRoutes = { pages: ["/issues", "/about"] };

export default async function globalSetup(config: FullConfig) {
  await warmUp(config, routes);
}
