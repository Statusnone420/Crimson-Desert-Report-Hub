import type { FullConfig } from "@playwright/test";
import { warmUp } from "./warm-up";

// Every route turnstile-theme.spec.ts opens. Add a route here when the spec starts to use it.
export default async function globalSetup(config: FullConfig) {
  await warmUp(config, { pages: ["/issues", "/about"] });
}
