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
    expect(scheduledScanDecision(true, [], new Date("2026-07-06T12:00:00Z"))).toEqual({
      run: false,
      skipReason: "paused",
    });
  });
  it("skips when a real run is inside the default hourly policy window", () => {
    expect(
      scheduledScanDecision(
        false,
        [{ mode: "manual", status: "success", started_at: "2026-07-06T11:30:00.000Z" }],
        new Date("2026-07-06T12:00:00Z"),
      ),
    ).toEqual({
      run: false,
      skipReason: "recent_run",
    });
  });
  it("runs when a real run is outside the policy window", () => {
    expect(
      scheduledScanDecision(
        false,
        [{ mode: "scheduled", status: "success", started_at: "2026-07-06T10:59:59.000Z" }],
        new Date("2026-07-06T12:00:00Z"),
      ),
    ).toEqual({ run: true });
  });
  it("honors a custom scanner policy interval", () => {
    expect(
      scheduledScanDecision(
        false,
        [{ mode: "manual", status: "success", started_at: "2026-07-06T10:30:00.000Z" }],
        new Date("2026-07-06T12:00:00Z"),
        120,
      ),
    ).toEqual({ run: false, skipReason: "recent_run" });
  });
  it("skips with a running reason when a scan is still running", () => {
    expect(
      scheduledScanDecision(
        false,
        [{ mode: "manual", status: "running", started_at: "2026-07-06T11:55:00.000Z" }],
        new Date("2026-07-06T12:00:00Z"),
      ),
    ).toEqual({ run: false, skipReason: "scan_already_running" });
  });
  it("runs when only dry runs are recent", () => {
    expect(
      scheduledScanDecision(
        false,
        [{ mode: "dry_run", status: "success", started_at: "2026-07-06T11:30:00.000Z" }],
        new Date("2026-07-06T12:00:00Z"),
      ),
    ).toEqual({ run: true });
  });
  it("runs when only skipped rows are recent", () => {
    expect(
      scheduledScanDecision(
        false,
        [{ mode: "scheduled", status: "skipped", started_at: "2026-07-06T11:30:00.000Z" }],
        new Date("2026-07-06T12:00:00Z"),
      ),
    ).toEqual({ run: true });
  });
});

describe("nextScheduledScanAt", () => {
  it("returns the next hourly scan by default", () => {
    expect(nextScheduledScanAt(new Date("2026-07-06T05:15:00Z")).toISOString()).toBe("2026-07-06T06:15:00.000Z");
  });
  it("returns the next scan using the policy interval", () => {
    expect(nextScheduledScanAt(new Date("2026-07-06T14:00:00Z"), 120).toISOString()).toBe(
      "2026-07-06T16:00:00.000Z",
    );
  });
});
