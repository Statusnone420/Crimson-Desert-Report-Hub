import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OverviewScannerHealth } from "@/components/operator/OverviewScannerHealth";
import { collectionHealth } from "@/lib/collectionHealth";
import {
  buildOverviewScannerHealth,
  overviewHealthHeadline,
  retainedLeadShareLabel,
  type OverviewScannerHealthInput,
} from "@/lib/operatorHealth";
import { scannerScheduleStatus } from "@/lib/scannerScheduleStatus";

const now = new Date("2026-09-11T18:00:00.000Z");

function healthyCollection() {
  return collectionHealth({
    steamPulse: [{ collectedAt: "2026-09-11T14:00:00.000Z" }],
    platformContext: {
      capturedAt: "2026-09-11T17:30:00.000Z",
      igdbStatus: "ok",
      twitchStatus: "ok",
      twitchComplete: true,
      twitchHistory: [{ capturedAt: "2026-09-11T17:30:00.000Z" }],
    },
    pulseReadFailures: [],
    steamPulseEnabled: true,
    platformContextConfigured: true,
    scheduledCadenceMinutes: 60,
    now,
  });
}

function input(overrides: Partial<OverviewScannerHealthInput> = {}): OverviewScannerHealthInput {
  return {
    now,
    adminAvailable: true,
    radarAvailable: true,
    control: { paused: false, minIntervalMinutes: 60 },
    activeRun: null,
    runs: [{ mode: "scheduled", status: "success", started_at: "2026-09-11T17:30:00.000Z" }],
    lastScheduled: { status: "success", skips: [] },
    latestRealRun: { mode: "scheduled", status: "success", started_at: "2026-09-11T17:30:00.000Z", finished_at: "2026-09-11T17:32:00.000Z" },
    radarHealth: {
      lastScanAt: "2026-09-11T17:30:00.000Z",
      nextEligibleAt: "2026-09-11T18:30:00.000Z",
      paused: false,
      runs7d: { failed: 0 },
    },
    funnel7d: { reviewed: 15599, kept: 4 },
    dateCoverage: { withSourceDate: 117, tracked: 274 },
    awaiting: 12,
    collection: healthyCollection(),
    attention: { count: 0, items: [] },
    ...overrides,
  };
}

describe("scannerScheduleStatus", () => {
  it("marks a standing schedule active and a credit-cap skip capped", () => {
    expect(scannerScheduleStatus({ paused: false }, null, { status: "success", skips: [] })).toEqual({
      label: "ACTIVE",
      tone: "green",
      toneClass: "is-green",
    });
    expect(
      scannerScheduleStatus({ paused: false }, null, { status: "skipped", skips: ["tavily_credit_cap"] }),
    ).toMatchObject({ label: "CAPPED", tone: "red" });
  });
});

describe("retainedLeadShareLabel", () => {
  it("does not treat an unread radar as a zero share", () => {
    expect(retainedLeadShareLabel(false, 0, 0)).toBe("Unknown");
    expect(retainedLeadShareLabel(true, 0, 0)).toBe("0 / 0");
    expect(retainedLeadShareLabel(true, 15599, 4)).toBe("4 / 15599 (0.0%)");
  });
});

describe("buildOverviewScannerHealth", () => {
  it.each(["scheduled", "manual"])("uses the independently read %s scan when ten skips hide it", (mode) => {
    const health = buildOverviewScannerHealth(input({
      control: { paused: false, minIntervalMinutes: 1440 },
      runs: Array.from({ length: 10 }, (_, index) => ({ mode: "scheduled", status: "skipped", started_at: new Date(now.getTime() - (index + 1) * 3_600_000).toISOString() })),
      latestRealRun: { mode, status: "success", started_at: "2026-09-11T06:00:00.000Z", finished_at: "2026-09-11T06:02:00.000Z" },
    }));
    expect(health.schedule.find((fact) => fact.id === "next-run")).toMatchObject({ value: "in 12h", detail: "Sep 12, 2026, 2:00:00 AM EDT" });
  });

  it("uses the completion instant for both last-completed-run labels", () => {
    const health = buildOverviewScannerHealth(input());
    expect(health.schedule.find((fact) => fact.id === "last-run")).toMatchObject({ value: "28m ago", detail: "Sep 11, 2026, 1:32:00 PM EDT" });
  });

  it("surfaces last run, next eligible attempt, providers, and core counters", () => {
    const health = buildOverviewScannerHealth(input());

    expect(health.headline).toBe("No named health checks require action.");
    expect(health.statusLabel).toBe("ACTIVE");
    expect(health.schedule).toEqual([
      expect.objectContaining({
        id: "last-run",
        value: "28m ago",
        detail: "Sep 11, 2026, 1:32:00 PM EDT",
      }),
      expect.objectContaining({
        id: "next-run",
        value: "in 30m",
        detail: "Sep 11, 2026, 2:30:00 PM EDT",
      }),
    ]);
    expect(health.providers.map((lane) => [lane.label, lane.value])).toEqual([
      ["Steam reviews", "Current"],
      ["Twitch audience", "Current"],
      ["IGDB platform metadata", "Current"],
    ]);
    expect(health.counters).toEqual([
      expect.objectContaining({ id: "screened-7d", value: "15599" }),
      expect.objectContaining({ id: "awaiting", value: "12" }),
      expect.objectContaining({ id: "retained-share", value: "4 / 15599 (0.0%)" }),
      expect.objectContaining({ id: "date-coverage", value: "117 / 274" }),
      expect.objectContaining({ id: "failed-runs", value: "0", tone: "ok" }),
    ]);
    expect(health.diagnosticsHref).toBe("/operator?view=scanner#health");
    expect(health.collectionHref).toBe("/operator?view=scanner&section=collection#collection-health");
  });

  it("says paused instead of inventing a next eligible time", () => {
    const health = buildOverviewScannerHealth(input({
      control: { paused: true, minIntervalMinutes: 60 },
    }));
    expect(health.statusLabel).toBe("PAUSED");
    expect(health.schedule.find((fact) => fact.id === "next-run")).toMatchObject({
      value: "Paused",
      tone: "caution",
    });
  });

  it("keeps unread counters and schedule unknown instead of zero", () => {
    const health = buildOverviewScannerHealth(input({
      adminAvailable: false,
      radarAvailable: false,
      control: null,
      latestRealRun: null,
      radarHealth: null,
      funnel7d: null,
      dateCoverage: null,
      awaiting: null,
      attention: {
        count: null,
        items: [{ id: "scanner-health-unavailable", label: "Scanner health unavailable", detail: "The run-health read did not complete." }],
      },
    }));

    expect(health.statusLabel).toBe("UNVERIFIED");
    expect(health.headline).toBe("A required health read is unavailable.");
    expect(health.schedule.map((fact) => fact.value)).toEqual(["Unknown", "Unknown"]);
    expect(health.counters.map((fact) => fact.value)).toEqual([
      "Unknown",
      "Unknown",
      "Unknown",
      "Unknown",
      "Unknown",
    ]);
  });

  it("falls back to radar schedule when the admin record failed", () => {
    const health = buildOverviewScannerHealth(input({
      adminAvailable: false,
      control: null,
      latestRealRun: null,
      lastScheduled: null,
      runs: [],
    }));

    expect(health.statusLabel).toBe("UNVERIFIED");
    expect(health.schedule.find((fact) => fact.id === "last-run")).toMatchObject({
      value: "30m ago",
      tone: "unknown",
    });
    expect(health.schedule.find((fact) => fact.id === "next-run")?.value).toBe("in 30m");
  });

  it("keeps AI unavailability on the status badge", () => {
    const health = buildOverviewScannerHealth(input({
      aiHealth: {
        state: "unavailable",
        code: "openrouter_no_route",
        message: "No AI provider matches the selected route and price limit.",
        lastSuccessAt: null,
      },
      attention: {
        count: 1,
        items: [{ id: "ai-processing", label: "AI processing unavailable", detail: "No AI provider matches the selected route and price limit." }],
      },
    }));
    expect(health.statusLabel).toBe("AI UNAVAILABLE");
    expect(overviewHealthHeadline(health.attention)).toBe("1 named health check needs attention.");
  });
});

describe("OverviewScannerHealth", () => {
  it("renders the glanceable facts and the diagnostics path", () => {
    const markup = renderToStaticMarkup(
      createElement(OverviewScannerHealth, { health: buildOverviewScannerHealth(input()) }),
    );
    expect(markup).toContain("Last completed run");
    expect(markup).toContain("28m ago");
    expect(markup).toContain("Next eligible run");
    expect(markup).toContain("in 30m");
    expect(markup).toContain("Steam reviews");
    expect(markup).toContain("Twitch audience");
    expect(markup).toContain("IGDB platform metadata");
    expect(markup).toContain("Automated screening events · 7d");
    expect(markup).toContain("href=\"/operator?view=scanner#health\"");
    expect(markup).toContain("href=\"/operator?view=scanner&amp;section=collection#collection-health\"");
    expect(markup).not.toContain("No recorded health checks need action");
    expect(markup).not.toContain("Collection totals are available inside Scanner");
  });
});
