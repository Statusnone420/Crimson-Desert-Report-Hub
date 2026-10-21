import type { FullConfig } from "@playwright/test";
import { warmUp, type WarmUpRoutes } from "../e2e/warm-up";

// Every route this suite's specs open, and no other. tests/e2eWarmUp.test.ts fails when the two differ.
export const routes: WarmUpRoutes = {
  pages: [
    "/", "/articles/patch-2-03-01", "/patches", "/patches/archive", "/patches/2-03-01", "/patches/2-03-00", "/patches/2-00-01",
    "/catch-up", "/feed.xml", "/rss.xml", "/sitemap.xml",
  ],
  missingPages: ["/patches/9-99-99"],
};

export default async function globalSetup(config: FullConfig) {
  await warmUp(config, routes);
}
