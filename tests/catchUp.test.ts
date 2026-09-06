import { describe, expect, it } from "vitest";
import {
  catchUpDate,
  catchUpHash,
  catchUpSelectionLabel,
  parseCatchUpHash,
  selectCatchUpMilestones,
  type CatchUpSelection,
} from "@/lib/catchUp";
import { CATCH_UP_HIGHLIGHTS_START, CATCH_UP_MILESTONES, type CatchUpMilestone } from "@/lib/catchUpContent";

const NOW = new Date("2026-09-06T12:00:00.000Z");

describe("catch-up selection URLs", () => {
  it.each<[CatchUpSelection, string]>([
    [{ kind: "highlights" }, ""],
    [{ kind: "all" }, "#history=all"],
    [{ kind: "patch", value: "2.00.01" }, "#patch=2.00.01"],
    [{ kind: "since", value: "2026-08-28T00:00:00.000Z" }, "#since=2026-08-28T00%3A00%3A00.000Z"],
  ])("round-trips %j", (selection, hash) => {
    expect(catchUpHash(selection)).toBe(hash);
    expect(parseCatchUpHash(hash, NOW)).toEqual(selection);
  });

  it.each([
    "#patch=unknown",
    "#since=not-a-date",
    "#since=2026-02-30",
    "#since=2026-09-07",
    "#since=2026-09-06T12:00:00.001Z",
    "#since=2026-09-05T12:00:00+02:00",
    "#anything=else",
  ])("falls back to highlights for malformed, unsupported, or future input: %s", (hash) => {
    expect(parseCatchUpHash(hash, NOW)).toEqual({ kind: "highlights" });
  });

  it("prefers a valid patch when the hash also carries a date", () => {
    expect(parseCatchUpHash("#since=2026-09-01&patch=2.00.01", NOW)).toEqual({ kind: "patch", value: "2.00.01" });
  });
});

describe("catch-up milestone selection", () => {
  it("returns all 18 milestones for full history", () => {
    expect(selectCatchUpMilestones({ kind: "all" })).toEqual(CATCH_UP_MILESTONES);
    expect(selectCatchUpMilestones({ kind: "all" })).toHaveLength(18);
  });

  it("retains the full history when a direct caller supplies an unknown patch", () => {
    expect(selectCatchUpMilestones({ kind: "patch", value: "1.00.00" })).toEqual(CATCH_UP_MILESTONES);
  });

  it("keeps the default highlights at the five entries from patch 2.00.00 onward", () => {
    const highlights = CATCH_UP_MILESTONES.filter((item) => Date.parse(item.publishedAt) >= Date.parse(CATCH_UP_HIGHLIGHTS_START));
    expect(CATCH_UP_HIGHLIGHTS_START).toBe(CATCH_UP_MILESTONES.find((item) => item.patch === "2.00.00")?.publishedAt);
    expect(highlights).toHaveLength(5);
    expect(selectCatchUpMilestones({ kind: "highlights" })).toEqual(highlights);
  });

  it("includes the full July history for an explicit early date", () => {
    const selected = selectCatchUpMilestones({ kind: "since", value: "2026-07-03T00:00:00.000Z" });
    expect(selected).toHaveLength(18);
    expect(selected[0].patch).toBe("1.13.00");
  });

  it("starts after patch 1.13.00 and keeps every later milestone", () => {
    const selected = selectCatchUpMilestones({ kind: "patch", value: "1.13.00" });
    expect(selected).toHaveLength(17);
    expect(selected[0].patch).toBe("1.13.01");
    expect(selected.some((item) => item.patch === "1.13.00")).toBe(false);
  });

  it("starts strictly after the selected patch, including a later same-day patch", () => {
    const selected = selectCatchUpMilestones({ kind: "patch", value: "2.00.01" });
    expect(selected.map((item) => item.patch ?? item.id)).toEqual([
      "2.00.02",
      "charting-the-unknown-announcement",
      "2.01.00",
    ]);
    const selectedPatch = CATCH_UP_MILESTONES.find((item) => item.patch === "2.00.01");
    expect(selectedPatch).toBeDefined();
    expect(selected[0].publishedAt).toBe(selectedPatch?.publishedAt);
  });

  it("uses exact instants for date selections", () => {
    const milestones: CatchUpMilestone[] = [
      { ...CATCH_UP_MILESTONES[0], id: "before", publishedAt: "2026-08-28T00:00:00.000Z" },
      { ...CATCH_UP_MILESTONES[1], id: "after", publishedAt: "2026-08-28T00:00:00.001Z" },
    ];
    expect(selectCatchUpMilestones({ kind: "since", value: "2026-08-28T00:00:00.000Z" }, milestones).map((item) => item.id)).toEqual(["after"]);
  });
});

describe("catch-up labels", () => {
  it("formats UTC dates and selection labels consistently", () => {
    expect(catchUpDate("2026-09-03T23:30:00-04:00")).toBe("September 4");
    expect(catchUpDate("2026-09-03T23:30:00-04:00", true)).toBe("September 4, 2026");
    expect(catchUpSelectionLabel({ kind: "highlights" })).toBe("The recent highlights");
    expect(catchUpSelectionLabel({ kind: "all" })).toBe("Full history");
    expect(catchUpSelectionLabel({ kind: "patch", value: "2.00.01" })).toBe("After patch 2.00.01");
    expect(catchUpSelectionLabel({ kind: "since", value: "2026-09-03T23:30:00-04:00" })).toBe("Since September 4");
  });
});
