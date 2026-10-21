import type { FullConfig } from "@playwright/test";
import { warmUp } from "../e2e/warm-up";

// Every route this suite opens. Add a route here when a spec starts to use it.
export default async function globalSetup(config: FullConfig) {
  await warmUp(config, {
    pages: [
      "/", "/articles/patch-2-03-01", "/patches", "/patches/archive", "/patches/2-03-01", "/patches/2-03-00", "/patches/2-00-01",
      "/patches/9-99-99", "/catch-up", "/feed.xml", "/rss.xml", "/sitemap.xml",
    ],
  });
}
