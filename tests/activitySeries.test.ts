import { describe, expect, it } from "vitest";
import { mergeActivitySeries } from "@/lib/activitySeries";

describe("mergeActivitySeries", () => {
  it("merges evidence and radar series over the union of days, sorted", () => {
    const merged = mergeActivitySeries(
      [
        { day: "2026-07-16", reports: 2, taps: 1, keptLeads: 5 },
        { day: "2026-07-17", reports: 0, taps: 0, keptLeads: 0 },
      ],
      [
        { day: "2026-07-17", newLeads: 3, reobservations: 4 },
        { day: "2026-07-18", newLeads: 1, reobservations: 0 },
      ],
    );
    expect(merged.evidenceAvailable).toBe(true);
    expect(merged.radarAvailable).toBe(true);
    expect(merged.days).toEqual([
      { day: "2026-07-16", reports: 2, taps: 1, newLeads: 0, reobservations: 0 },
      { day: "2026-07-17", reports: 0, taps: 0, newLeads: 3, reobservations: 4 },
      { day: "2026-07-18", reports: 0, taps: 0, newLeads: 1, reobservations: 0 },
    ]);
  });

  it("flags an unreadable evidence rollup instead of faking zeros", () => {
    const merged = mergeActivitySeries(null, [{ day: "2026-07-18", newLeads: 1, reobservations: 2 }]);
    expect(merged.evidenceAvailable).toBe(false);
    expect(merged.radarAvailable).toBe(true);
    expect(merged.days).toHaveLength(1);
  });

  it("flags a missing radar series", () => {
    const merged = mergeActivitySeries([{ day: "2026-07-18", reports: 1, taps: 0, keptLeads: 0 }], null);
    expect(merged.radarAvailable).toBe(false);
    expect(merged.days[0]).toEqual({ day: "2026-07-18", reports: 1, taps: 0, newLeads: 0, reobservations: 0 });
  });

  it("keeps evidence and radar counts in separate fields, never summed", () => {
    const merged = mergeActivitySeries(
      [{ day: "2026-07-18", reports: 2, taps: 3, keptLeads: 9 }],
      [{ day: "2026-07-18", newLeads: 5, reobservations: 7 }],
    );
    const day = merged.days[0];
    expect(day.reports).toBe(2);
    expect(day.taps).toBe(3);
    expect(day.newLeads).toBe(5);
    expect(day.reobservations).toBe(7);
  });
});
