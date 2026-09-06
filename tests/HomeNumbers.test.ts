import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HomeNumbers } from "@/components/newspaper/HomeNumbers";
import type { SteamPulsePoint } from "@/lib/queries";
import type { PatchRadarData } from "@/lib/radar.server";

const steam: SteamPulsePoint[] = [{
  snapshotDay: "2026-09-05",
  collectedAt: "2026-09-05T18:00:00.000Z",
  totalReviews: 12345,
  positivePercentage: 82.5,
  reviewCountDelta: 14,
  reviewsScanned: 0,
  issueLanguageCount: 0,
  leadsRetained: 0,
}];

function radar(categories: PatchRadarData["categories"]): PatchRadarData {
  return {
    connected: true,
    patch: { version: "1.13.01", publishedAt: null },
    window: { newLeads24h: 0, newLeads7d: 0, reobservations24h: 0, reobservations7d: 0 },
    activeLeadClusters: 0,
    recurring: { recurringLeads: 0, trackedLeads: 4, maxSeenCount: 0 },
    categories,
    platforms: [],
    confidenceMix: { high: 0, medium: 0, low: 0 },
    funnel7d: { reviewed: 0, filtered: 0, kept: 0, reobserved: 0 },
    daily: [],
    weekly: [],
    recurrence: [],
    health: {
      lastScanAt: null,
      lastScanStatus: null,
      runs7d: { succeeded: 0, skipped: 0, failed: 0 },
      paused: false,
      cadenceMinutes: 60,
      nextEligibleAt: null,
    },
    dateCoverage: { withSourceDate: 0, tracked: 0 },
    eligibility: {
      current_patch: 0,
      fresh_source: 0,
      fresh_language: 0,
      unknown_source_freshness: 0,
      wrong_patch: 0,
      stale_source: 0,
    },
    evidence: { reports: 0, taps: 0 },
  };
}

function render(radarData: PatchRadarData | null) {
  return renderToStaticMarkup(createElement(HomeNumbers, { steam, radar: radarData, steamUnavailable: false }));
}

describe("HomeNumbers", () => {
  it("uses the short typed label for quest progression", () => {
    const markup = render(radar([
      { category: "performance", tracked: 1, new7d: 0 },
      { category: "quest_progression", tracked: 2, new7d: 0 },
      { category: "other", tracked: 1, new7d: 0 },
    ]));

    expect(markup).toContain(">Quests</text>");
    expect(markup).not.toContain(">quest_progression</text>");
  });

  it.each([null, radar([])])("marks an unavailable or empty radar layout as compact", (radarData) => {
    expect(render(radarData)).toContain('class="charts charts--compact-radar"');
  });

  it("reserves a shared daily-change readout and connects each bar to it", () => {
    const markup = render(radar([{ category: "performance", tracked: 4, new7d: 0 }]));

    expect(markup).toContain('id="home-review-readout" class="chart-readout" aria-live="polite"');
    expect(markup).toContain("Focus, hover, or tap a day to read its change.");
    expect(markup).toContain('aria-describedby="home-review-readout"');
    expect(markup).not.toContain('class="tooltip"');
  });
});
