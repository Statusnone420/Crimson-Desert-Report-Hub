import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Observatory } from "@/components/newspaper/Observatory";
import { composePatchRadarData, type RadarRunRow } from "@/lib/radar.server";
import type { PublicScannerData } from "@/lib/queries";

const data: PublicScannerData = {
  reviewedThisWeek: 0, filteredThisWeek: 0, keptThisWeek: 0, awaiting: 0, published: 0,
  lastCheckedAt: null, scannerActive: false, scannerConnected: true, llmPaused: false,
  readFailures: [], steamPulse: [], platformContext: null, pulseReadFailures: [],
};

describe("Observatory candidate outcomes", () => {
  it.each([
    { status: "failed", inserted: 0, funnel: { candidatesSeen: 10 }, residual: 10 },
    { status: "partial", inserted: 1, funnel: { candidatesSeen: 10 }, residual: 9 },
    { status: "success", inserted: 1, funnel: null, residual: 9 },
  ] as const)("does not label $status residual work as completed filtering", ({ status, inserted, funnel, residual }) => {
    const run: RadarRunRow = {
      started_at: "2026-07-19T08:00:00Z", status, mode: "scheduled", intent: "broad_discovery", search_queries_used: 1,
      search_results_seen: 10, reddit_posts_seen: 0,
      signals_inserted: inserted, signals_reobserved: 0, funnel,
    };
    const radar = composePatchRadarData({
      signals: [], runs: [run], patch: { version: "1.14.00", publishedAt: "2026-07-16T09:00:00Z" },
      paused: false, cadenceMinutes: 60, evidence: { reports: 0, taps: 0 },
      now: new Date("2026-07-19T12:00:00Z"),
    });
    expect(radar.funnel7d).toMatchObject({ reviewed: 10, filtered: residual });
    const markup = renderToStaticMarkup(createElement(Observatory, {
      data, radar: { ...radar, categories: [{ category: "performance", tracked: 0, new7d: 0 }] },
      players: { availability: "empty", checkedAt: "2026-07-19T12:00:00Z", points: [] },
    }));
    const start = markup.indexOf('class="obs-scan"');
    expect(start).toBeGreaterThan(-1);
    const weekly = markup.slice(start, markup.indexOf('class="obs-method"', start));
    expect(weekly).toContain("10 candidates recorded");
    expect(weekly).toContain("Not retained");
    expect(weekly).toContain("including incomplete processing");
    expect(weekly).toContain(`${residual} not retained`);
    expect(weekly).not.toMatch(/candidates processed|filtered\./i);
  });
});
