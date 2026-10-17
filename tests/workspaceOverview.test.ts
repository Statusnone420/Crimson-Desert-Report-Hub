import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkspaceOverview, type WorkspaceOverviewProps } from "@/components/operator/WorkspaceOverview";

const baseProps: WorkspaceOverviewProps = {
  decisions: [],
  availability: {
    reports: { available: true, total: 0 },
    claims: { available: true, total: 0 },
    videos: { available: true, total: 0 },
    dossiers: { available: true, total: 0 },
  },
  health: createElement("p", null, "Healthy"),
  recentActivity: [],
  recentActivityAvailable: true,
};

describe("WorkspaceOverview recent activity", () => {
  it("distinguishes an unavailable history read from an empty history", () => {
    const unavailable = renderToStaticMarkup(createElement(WorkspaceOverview, {
      ...baseProps,
      recentActivityAvailable: false,
    }));
    const empty = renderToStaticMarkup(createElement(WorkspaceOverview, baseProps));

    expect(unavailable).toContain("Recent activity unavailable");
    expect(unavailable).toContain("The automation history read failed.");
    expect(unavailable).not.toContain("No recent activity recorded");
    expect(empty).toContain("No recent activity recorded");
    expect(empty).toContain("The automation history read succeeded and returned no records.");
  });

  it("links recent activity and diagnostics into Scanner health", () => {
    const markup = renderToStaticMarkup(createElement(WorkspaceOverview, {
      ...baseProps,
      recentActivity: [{
        id: "run-1",
        title: "Scan completed",
        detail: "1 recent scan already ran",
        occurredAt: "Sep 11, 2026, 1:32:00 PM EDT",
        href: "/operator?view=scanner#health",
      }],
    }));

    expect(markup).toContain("href=\"/operator?view=scanner#health\"");
    expect(markup).toContain("Open diagnostics");
    expect(markup).toContain("Sep 11, 2026, 1:32:00 PM EDT");
    expect(markup).not.toContain("2026-09-11T");
  });

  it("does not describe an empty decision list as showing 0 of 0", () => {
    const markup = renderToStaticMarkup(createElement(WorkspaceOverview, baseProps));
    expect(markup).toContain("No pending decisions. The review queues are clear.");
    expect(markup).not.toContain("Showing 0 of 0 pending decisions");
  });
});
