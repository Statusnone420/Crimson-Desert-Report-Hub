import { describe, expect, it, vi } from "vitest";
import {
  composePatchRadarData,
  emptyPatchRadarData,
  type RadarRunRow,
  type RadarSignalRow,
} from "@/lib/radar.server";

vi.mock("server-only", () => ({}));

const NOW = new Date("2026-07-19T12:00:00Z");
const PATCH = { version: "1.14.00", publishedAt: "2026-07-16T09:00:00Z" };

function signal(overrides: Partial<RadarSignalRow> = {}): RadarSignalRow {
  return {
    cluster_id: "cluster-a",
    category: "performance",
    confidence: "medium",
    public_status: "private",
    first_seen_at: "2026-07-18T10:00:00Z",
    last_seen_at: "2026-07-19T10:00:00Z",
    observed_at: "2026-07-18T10:00:00Z",
    seen_count: 1,
    source_published_at: null,
    title: "SENTINEL_TITLE patch 1.14.00 fps drops",
    summary: "SENTINEL_SUMMARY user reports stutter after patch 1.14.00",
    source_url: "https://sentinel-domain.example/thread/123",
    extracted_facts: { platform: "pc_steam" },
    ...overrides,
  };
}

function run(overrides: Partial<RadarRunRow> = {}): RadarRunRow {
  return {
    started_at: "2026-07-19T08:00:00Z",
    status: "success",
    mode: "scheduled",
    intent: "broad_discovery",
    search_queries_used: 1,
    search_results_seen: 5,
    reddit_posts_seen: 0,
    signals_inserted: 1,
    signals_reobserved: 2,
    ...overrides,
  };
}

function compose(input: Partial<Parameters<typeof composePatchRadarData>[0]> = {}) {
  return composePatchRadarData({
    signals: [],
    runs: [],
    patch: PATCH,
    paused: false,
    cadenceMinutes: 60,
    evidence: { reports: 0, taps: 0 },
    now: NOW,
    ...input,
  });
}

describe("composePatchRadarData windows", () => {
  it("counts new leads by first_seen_at in 24h and 7d windows", () => {
    const data = compose({
      signals: [
        signal({ first_seen_at: "2026-07-19T06:00:00Z" }), // 24h + 7d
        signal({ first_seen_at: "2026-07-14T06:00:00Z" }), // 7d only
        signal({ first_seen_at: "2026-07-01T06:00:00Z" }), // older
      ],
    });
    expect(data.window.newLeads24h).toBe(1);
    expect(data.window.newLeads7d).toBe(2);
  });

  it("counts re-observations from per-run counters, excluding failed runs", () => {
    const data = compose({
      runs: [
        run({ started_at: "2026-07-19T08:00:00Z", signals_reobserved: 3 }),
        run({ started_at: "2026-07-15T08:00:00Z", signals_reobserved: 4 }),
        run({ started_at: "2026-07-19T09:00:00Z", signals_reobserved: 9, status: "failed" }),
      ],
    });
    expect(data.window.reobservations24h).toBe(3);
    expect(data.window.reobservations7d).toBe(7);
  });

  it("excludes zero-query rescue runs from intake counts", () => {
    const data = compose({
      runs: [
        run({
          mode: "manual",
          intent: "rescue_candidate",
          search_queries_used: 0,
          search_results_seen: 0,
          signals_inserted: 1,
          signals_reobserved: 0,
        }),
      ],
    });
    expect(data.funnel7d.kept).toBe(0);
    expect(data.window.reobservations7d).toBe(0);
  });
});

describe("composePatchRadarData buckets and recurrence", () => {
  it("excludes hidden signals from every tracked-lead aggregate", () => {
    const data = compose({
      signals: [signal(), signal({ public_status: "hidden", seen_count: 18 })],
    });
    expect(data.recurring.trackedLeads).toBe(1);
    expect(data.recurring.maxSeenCount).toBe(1);
    expect(data.categories).toEqual([{ category: "performance", tracked: 1, new7d: 1 }]);
  });

  it("maps unknown categories to other and counts new7d per bucket", () => {
    const data = compose({
      signals: [
        signal({ category: "made_up_category", first_seen_at: "2026-07-01T00:00:00Z" }),
        signal({ category: "crash_startup" }),
      ],
    });
    expect(data.categories).toContainEqual({ category: "other", tracked: 1, new7d: 0 });
    expect(data.categories).toContainEqual({ category: "crash_startup", tracked: 1, new7d: 1 });
  });

  it("only counts strict enum platforms, never LLM free text", () => {
    const data = compose({
      signals: [
        signal({ extracted_facts: { platform: "pc_steam" } }),
        signal({ extracted_facts: { platform: "SENTINEL_FREE_TEXT PlayStation five" } }),
        signal({ extracted_facts: null }),
      ],
    });
    expect(data.platforms).toEqual([{ platform: "pc_steam", tracked: 1 }]);
  });

  it("computes recurrence points without any text fields", () => {
    const data = compose({
      signals: [signal({ first_seen_at: "2026-07-16T12:00:00Z", seen_count: 5, public_status: "public" })],
    });
    expect(data.recurrence).toEqual([
      { daysTracked: 3, daysSinceSeen: 0, seenCount: 5, isPublic: true, category: "performance" },
    ]);
    expect(data.recurring.recurringLeads).toBe(1);
  });

  it("measures recency from last_seen_at as scanner time", () => {
    const data = compose({
      signals: [
        signal({ first_seen_at: "2026-07-10T12:00:00Z", last_seen_at: "2026-07-15T12:00:00Z" }),
        signal({ first_seen_at: "2026-07-18T12:00:00Z", last_seen_at: null, observed_at: "2026-07-18T12:00:00Z" }),
      ],
    });
    expect(data.recurrence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ daysTracked: 9, daysSinceSeen: 4 }),
        expect.objectContaining({ daysTracked: 1, daysSinceSeen: 1 }),
      ]),
    );
  });

  it("caps recurrence points on the freshest observations deterministically", () => {
    const stale = signal({ last_seen_at: "2026-07-01T12:00:00Z" });
    const fresh = signal({ last_seen_at: "2026-07-19T11:00:00Z" });
    const data = compose({ signals: [stale, fresh] });

    expect(data.recurrence.map((point) => point.daysSinceSeen)).toEqual([0, 18]);
  });
});

describe("composePatchRadarData weekly composition", () => {
  it("buckets still-tracked leads by first-seen week and category, filling gap weeks", () => {
    const data = compose({
      signals: [
        signal({ first_seen_at: "2026-07-01T10:00:00Z" }), // week of Mon 2026-06-29
        signal({ first_seen_at: "2026-07-02T10:00:00Z", category: "crash_startup" }),
        signal({ first_seen_at: "2026-07-17T10:00:00Z" }), // week of Mon 2026-07-13
        signal({ first_seen_at: "2026-07-17T11:00:00Z", category: "made_up" }),
        signal({ first_seen_at: "2026-07-10T10:00:00Z", public_status: "hidden" }), // excluded
      ],
    });
    expect(data.weekly.map((w) => w.weekStart)).toEqual(["2026-06-29", "2026-07-06", "2026-07-13"]);
    expect(data.weekly[0]?.counts).toEqual({ performance: 1, crash_startup: 1 });
    expect(data.weekly[1]?.counts).toEqual({});
    expect(data.weekly[2]?.counts).toEqual({ performance: 1, other: 1 });
  });

  it("returns an empty weekly series when nothing is tracked", () => {
    expect(compose().weekly).toEqual([]);
  });
});

describe("composePatchRadarData daily series", () => {
  it("starts the series at the patch publish day", () => {
    const data = compose({
      runs: [run({ started_at: "2026-07-17T08:00:00Z", signals_inserted: 4, signals_reobserved: 1 })],
    });
    expect(data.daily[0]?.day).toBe("2026-07-16");
    expect(data.daily[data.daily.length - 1]?.day).toBe("2026-07-19");
    expect(data.daily.find((d) => d.day === "2026-07-17")).toEqual({
      day: "2026-07-17",
      newLeads: 4,
      reobservations: 1,
    });
    expect(data.daily.find((d) => d.day === "2026-07-18")).toEqual({
      day: "2026-07-18",
      newLeads: 0,
      reobservations: 0,
    });
  });

  it("keeps failed-run inserts out of the daily series", () => {
    const data = compose({
      runs: [run({ started_at: "2026-07-18T08:00:00Z", status: "failed", signals_inserted: 7 })],
    });
    expect(data.daily.find((d) => d.day === "2026-07-18")).toEqual({
      day: "2026-07-18",
      newLeads: 0,
      reobservations: 0,
    });
  });
});

describe("composePatchRadarData health and observability", () => {
  it("summarizes run health and next eligible scan", () => {
    const data = compose({
      runs: [
        run({ started_at: "2026-07-19T11:30:00Z", status: "success" }),
        run({ started_at: "2026-07-19T10:00:00Z", status: "skipped" }),
        run({ started_at: "2026-07-18T10:00:00Z", status: "failed" }),
      ],
    });
    expect(data.health.lastScanAt).toBe("2026-07-19T11:30:00Z");
    expect(data.health.lastScanStatus).toBe("success");
    expect(data.health.runs7d).toEqual({ succeeded: 1, skipped: 1, failed: 1 });
    expect(data.health.nextEligibleAt).not.toBeNull();
  });

  it("reports no next eligible scan while paused", () => {
    const data = compose({ paused: true });
    expect(data.health.nextEligibleAt).toBeNull();
    expect(data.health.paused).toBe(true);
  });

  it("reports source-date coverage truthfully instead of inventing dates", () => {
    const data = compose({
      signals: [
        signal({ source_published_at: "2026-07-17T00:00:00Z" }),
        signal({ source_published_at: null }),
        signal({ source_published_at: null }),
      ],
    });
    expect(data.dateCoverage).toEqual({ withSourceDate: 1, tracked: 3 });
  });

  it("distributes current-patch eligibility reasons over tracked leads", () => {
    const data = compose({
      signals: [
        signal(), // mentions 1.14.00 -> current_patch
        signal({
          title: "old patch complaint",
          summary: "since patch 1.12.00 everything broke",
        }), // wrong_patch
        signal({ title: "vague complaint", summary: "game stutters sometimes" }), // unknown freshness
      ],
    });
    expect(data.eligibility.current_patch).toBe(1);
    expect(data.eligibility.wrong_patch).toBe(1);
    expect(data.eligibility.unknown_source_freshness).toBe(1);
  });
});

describe("PatchRadarData privacy boundary", () => {
  it("never returns signal title, summary, url, or domain text", () => {
    const data = compose({
      signals: [
        signal(),
        signal({ public_status: "hidden" }),
        signal({ public_status: "public", extracted_facts: { platform: "SENTINEL_FREE_TEXT" } }),
      ],
      runs: [run()],
    });
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain("SENTINEL_TITLE");
    expect(serialized).not.toContain("SENTINEL_SUMMARY");
    expect(serialized).not.toContain("SENTINEL_FREE_TEXT");
    expect(serialized).not.toContain("sentinel-domain");
    expect(serialized).not.toContain("http");
    expect(serialized).not.toContain("cluster-a");
  });

  it("keeps the empty shape aggregate-only too", () => {
    const serialized = JSON.stringify(emptyPatchRadarData(PATCH));
    expect(serialized).not.toContain("http");
  });
});
