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
});
