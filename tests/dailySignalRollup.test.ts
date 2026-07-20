import { describe, expect, it } from "vitest";
import { composeDailySignalRollup, fetchAllDailySignalRollupRows } from "@/lib/queries";

describe("fetchAllDailySignalRollupRows", () => {
  it("continues past a full page before returning the complete input", async () => {
    const ranges: [number, number][] = [];
    const rows = await fetchAllDailySignalRollupRows("test rollup", async (from, to) => {
      ranges.push([from, to]);
      return { data: from === 0 ? Array.from({ length: 1000 }, (_, index) => index) : [1000], error: null };
    });

    expect(rows).toHaveLength(1001);
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });
});

describe("composeDailySignalRollup", () => {
  it("matches the previous view semantics without exposing raw tables", () => {
    const rollup = composeDailySignalRollup({
      today: "2026-07-20",
      currentPatch: { version: "1.13.2", publishedAt: "2026-07-18T09:00:00.000Z" },
      reports: [
        { created_at: "2026-07-18T12:00:00.000Z", patch_version: "1.13.0" },
        { created_at: "2026-07-19T12:00:00.000Z", patch_version: "1.12.9" },
      ],
      taps: [
        { created_at: "2026-07-18T13:00:00.000Z", patch_family: "1.13" },
        { created_at: "2026-07-20T13:00:00.000Z", patch_family: "1.12" },
      ],
      runs: [
        {
          started_at: "2026-07-19T14:00:00.000Z",
          signals_inserted: 3,
          mode: "scheduled",
          intent: null,
          search_queries_used: 4,
        },
        {
          started_at: "2026-07-20T14:00:00.000Z",
          signals_inserted: 8,
          mode: "manual",
          intent: "rescue_candidate",
          search_queries_used: 0,
        },
        {
          started_at: "2026-07-20T15:00:00.000Z",
          signals_inserted: 5,
          mode: "dry_run",
          intent: null,
          search_queries_used: 5,
        },
      ],
    });

    expect(rollup).toEqual([
      { day: "2026-07-18", reports: 1, taps: 1, keptLeads: 0 },
      { day: "2026-07-19", reports: 0, taps: 0, keptLeads: 3 },
      { day: "2026-07-20", reports: 0, taps: 0, keptLeads: 0 },
    ]);
  });
});
