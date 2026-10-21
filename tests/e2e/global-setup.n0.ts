import type { FullConfig } from "@playwright/test";
import { warmUp, type WarmUpRoutes } from "./warm-up";

// Every route n0.spec.ts opens, on both of its servers, and no other. tests/e2eWarmUp.test.ts fails when the two differ.
export const routes: WarmUpRoutes = { pages: ["/", "/patches", "/issues", "/observatory", "/scanner", "/report"] };

export default async function globalSetup(config: FullConfig) {
  await warmUp(config, routes);
}
