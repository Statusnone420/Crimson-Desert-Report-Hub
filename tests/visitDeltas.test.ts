import { describe, expect, it } from "vitest";
import { computeVisitDeltas } from "@/lib/visitDeltas";
import type { ActivityDay } from "@/lib/activitySeries";

const DAYS: ActivityDay[] = [
  { day: "2026-07-15", reports: 1, taps: 2, newLeads: 3, reobservations: 4 },
  { day: "2026-07-16", reports: 0, taps: 0, newLeads: 2, reobservations: 5 },
  { day: "2026-07-17", reports: 2, taps: 1, newLeads: 0, reobservations: 0 },
];

describe("computeVisitDeltas", () => {
  it("sums whole days strictly after the previous visit's day", () => {
    const deltas = computeVisitDeltas(DAYS, "2026-07-15T20:00:00Z", "2026-07-18T09:00:00Z");
    expect(deltas).toEqual({
      sinceDay: "2026-07-15",
      reports: 2,
      taps: 1,
      newLeads: 2,
      reobservations: 5,
      hasAnything: true,
    });
  });

  it("reports nothing new truthfully instead of hiding the memory", () => {
    const deltas = computeVisitDeltas(
      [{ day: "2026-07-16", reports: 0, taps: 0, newLeads: 0, reobservations: 0 }],
      "2026-07-15T20:00:00Z",
      "2026-07-18T09:00:00Z",
    );
    expect(deltas?.hasAnything).toBe(false);
  });

  it("returns null on a same-day return visit", () => {
    expect(computeVisitDeltas(DAYS, "2026-07-18T08:00:00Z", "2026-07-18T09:00:00Z")).toBeNull();
  });

  it("returns null for an unparseable stored timestamp", () => {
    expect(computeVisitDeltas(DAYS, "not-a-date", "2026-07-18T09:00:00Z")).toBeNull();
  });
});
