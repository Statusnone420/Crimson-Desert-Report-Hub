import type { FullConfig } from "@playwright/test";
import { warmUp } from "./warm-up";

// Every route n0.spec.ts opens, on both of its servers. Add a route here when the spec starts to use it.
export default async function globalSetup(config: FullConfig) {
  await warmUp(config, { pages: ["/", "/patches", "/issues", "/observatory", "/report"] });
}
