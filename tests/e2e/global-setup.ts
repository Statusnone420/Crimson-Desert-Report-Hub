import type { FullConfig } from "@playwright/test";
import { OPERATOR_VIEWS, workspaceHref } from "../../src/lib/operatorWorkspace";
import { warmUp } from "./warm-up";

// Every route this suite opens or calls. Add a route here when a spec starts to use it.
export default async function globalSetup(config: FullConfig) {
  await warmUp(config, {
    pages: [
      "/", "/news", "/issues", "/patches", "/patches/archive", "/patches/1-13-01", "/observatory", "/catch-up", "/watch", "/report",
      "/about", "/privacy", "/contact", "/admin/login", "/articles/charting-the-unknown", "/articles/charting-the-unknown-delay",
      "/articles/patch-2-02-00", "/articles/patch-2-03-00", "/articles/patch-1-13-01", "/topics/charting-the-unknown",
      "/editorials/clear-skies-over-the-inventory-screen", "/missing-public-page", "/feed.xml", "/rss.xml", "/sitemap.xml", "/manifest.webmanifest",
    ],
    operatorPages: [...OPERATOR_VIEWS.map((view) => workspaceHref(view)), "/admin", "/admin/problem-reports", "/admin/source-monitor"],
    apiRoutes: [
      "/api/confirmations", "/api/reports", "/api/problem-reports", "/api/admin/session", "/api/admin/ai-settings", "/api/admin/scan",
      "/api/admin/scan/status", "/api/admin/scan/provider-smoke", "/api/admin/problem-reports", "/api/admin/problem-reports/warm-up",
      "/api/admin/video-review-brief", "/api/admin/videos/warm-up/draft", "/api/admin/export",
    ],
  });
}
