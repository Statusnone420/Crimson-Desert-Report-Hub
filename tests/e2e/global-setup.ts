import type { FullConfig } from "@playwright/test";
import { OPERATOR_VIEWS, workspaceHref } from "../../src/lib/operatorWorkspace";
import { warmUp, type WarmUpRoutes } from "./warm-up";

// Every route this suite's specs open, and no other. tests/e2eWarmUp.test.ts fails when the two differ.
export const routes: WarmUpRoutes = {
  pages: [
    "/", "/news", "/issues", "/patches", "/patches/archive", "/patches/1-13-01", "/observatory", "/scanner", "/catch-up", "/watch", "/report",
    "/about", "/privacy", "/contact", "/admin/login", "/articles/charting-the-unknown", "/articles/charting-the-unknown-delay",
    "/articles/patch-2-02-00", "/articles/patch-2-03-00", "/articles/patch-1-13-01", "/topics/charting-the-unknown",
    "/editorials/clear-skies-over-the-inventory-screen", "/feed.xml", "/feeds", "/rss.xml", "/sitemap.xml", "/feeds/sitemap",
    "/manifest.webmanifest", "/opengraph-image.png", "/twitter-image.png",
  ],
  missingPages: ["/missing-public-page", "/editorials/scattered-softlocks-in-the-north"],
  operatorPages: [...OPERATOR_VIEWS.map((view) => workspaceHref(view)), "/admin", "/admin/problem-reports", "/admin/source-monitor"],
  apiRoutes: [
    "/api/confirmations", "/api/reports", "/api/problem-reports", "/api/admin/session", "/api/admin/problem-reports",
    "/api/admin/problem-reports/10000000-0000-4000-8000-000000000001", "/api/admin/video-review-brief",
  ],
};

export default async function globalSetup(config: FullConfig) {
  // scripts/verify.mjs names the pages its one-spec runs open, so they skip the rest of the suite's routes.
  const only = process.env.PLAYWRIGHT_WARM_UP_PAGES;
  await warmUp(config, only ? { pages: only.split(",") } : routes);
}
