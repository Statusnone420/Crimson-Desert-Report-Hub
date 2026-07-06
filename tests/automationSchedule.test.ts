import { describe, expect, it } from "vitest";
import { blocksScheduledScan, nextScheduledScanAt, scheduledScanDecision } from "@/lib/automation/schedule";

describe("blocksScheduledScan", () => {
  it("counts real scheduled and manual runs", () => {
    expect(blocksScheduledScan({ mode: "scheduled", status: "success" })).toBe(true);
    expect(blocksScheduledScan({ mode: "manual", status: "running" })).toBe(true);
  });
  it("ignores dry runs and skip markers", () => {
    expect(blocksScheduledScan({ mode: "dry_run", status: "success" })).toBe(false);
    expect(blocksScheduledScan({ mode: "scheduled", status: "skipped" })).toBe(false);
  });
});

describe("scheduledScanDecision", () => {
  it("skips when paused", () => {
    expect(scheduledScanDecision(true, [])).toEqual({ run: false, skipReason: "paused" });
  });
  it("skips when a real run is recent", () => {
    expect(scheduledScanDecision(false, [{ mode: "manual", status: "success" }])).toEqual({
      run: false,
      skipReason: "recent_run",
    });
  });
  it("runs when only dry runs are recent", () => {
    expect(scheduledScanDecision(false, [{ mode: "dry_run", status: "success" }])).toEqual({ run: true });
  });
});

describe("nextScheduledScanAt", () => {
  it("returns today 09:00 UTC when before 09:00", () => {
    expect(nextScheduledScanAt(new Date("2026-07-06T05:00:00Z")).toISOString()).toBe("2026-07-06T09:00:00.000Z");
  });
  it("returns tomorrow 09:00 UTC when after 09:00", () => {
    expect(nextScheduledScanAt(new Date("2026-07-06T14:00:00Z")).toISOString()).toBe("2026-07-07T09:00:00.000Z");
  });
});
