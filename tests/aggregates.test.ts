import { describe, expect, it } from "vitest";
import { buildDailySeries, countBy, rankClusters } from "@/lib/aggregates";

describe("countBy", () => {
  it("counts by key and ignores null keys", () => {
    const rows = [{ k: "a" }, { k: "b" }, { k: "a" }, { k: null }];
    expect(countBy(rows, (r) => r.k)).toEqual({ a: 2, b: 1 });
  });
});

describe("buildDailySeries", () => {
  it("returns one bucket per day for the window, zero-filled, oldest first", () => {
    const today = new Date("2026-07-05T12:00:00Z");
    const rows = [
      { created_at: "2026-07-05T01:00:00Z" },
      { created_at: "2026-07-05T02:00:00Z" },
      { created_at: "2026-07-03T09:00:00Z" },
      { created_at: "2026-06-01T00:00:00Z" },
    ];
    const series = buildDailySeries(rows, 3, today);
    expect(series).toEqual([
      { date: "2026-07-03", count: 1 },
      { date: "2026-07-04", count: 0 },
      { date: "2026-07-05", count: 2 },
    ]);
  });
});

describe("rankClusters", () => {
  it("attaches counts and sorts descending, keeping zero-count clusters", () => {
    const clusters = [
      { id: "c1", title: "One" },
      { id: "c2", title: "Two" },
    ];
    const reports = [{ cluster_id: "c2" }, { cluster_id: "c2" }, { cluster_id: null }];
    const ranked = rankClusters(clusters, reports);
    expect(ranked.map((c) => c.id)).toEqual(["c2", "c1"]);
    expect(ranked[0].count).toBe(2);
    expect(ranked[1].count).toBe(0);
  });
});
