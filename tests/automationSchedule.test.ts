import { describe, expect, it } from "vitest";
import {
  blocksScheduledScan,
  nextEligibleScheduledScanAt,
  nextScheduledScanAt,
  resolveBurstState,
  scheduledScanDecision,
} from "@/lib/automation/schedule";

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
  it("allows normal hourly cron jitter", () => {
    expect(
      scheduledScanDecision(
        false,
        [{ mode: "scheduled", status: "success", started_at: "2026-07-06T21:00:09.723Z" }],
        new Date("2026-07-06T22:00:08.983Z"),
      ),
    ).toEqual({ run: true });
  });
  it("still blocks a running scan during the full policy window", () => {
    expect(
      scheduledScanDecision(
        false,
        [{ mode: "scheduled", status: "running", started_at: "2026-07-06T21:00:09.723Z" }],
        new Date("2026-07-06T22:00:08.983Z"),
      ),
    ).toEqual({ run: false, skipReason: "scan_already_running" });
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

describe("nextEligibleScheduledScanAt", () => {
  it("returns now when no real run blocks the schedule", () => {
    expect(
      nextEligibleScheduledScanAt(
        [{ mode: "scheduled", status: "skipped", started_at: "2026-07-06T11:30:00.000Z" }],
        new Date("2026-07-06T12:00:00Z"),
      ).toISOString(),
    ).toBe("2026-07-06T12:00:00.000Z");
  });

  it("returns the last real run plus the policy interval when still inside the window", () => {
    expect(
      nextEligibleScheduledScanAt(
        [{ mode: "manual", status: "success", started_at: "2026-07-06T11:30:00.000Z" }],
        new Date("2026-07-06T12:00:00Z"),
        120,
      ).toISOString(),
    ).toBe("2026-07-06T13:30:00.000Z");
  });
});

describe("resolveBurstState", () => {
  const now = new Date("2026-07-05T12:00:00.000Z");

  it("activates for a current patch observed inside the 72-hour window", () => {
    expect(
      resolveBurstState(
        {
          source: "official",
          observedAt: "2026-07-02T12:01:00.000Z",
          publishedAt: "2026-07-04T12:00:00.000Z",
        },
        now,
      ),
    ).toBe(true);
  });

  it("expires after 72 hours from observation", () => {
    expect(
      resolveBurstState(
        {
          source: "official",
          observedAt: "2026-07-02T11:59:59.000Z",
          publishedAt: "2026-07-04T12:00:00.000Z",
        },
        now,
      ),
    ).toBe(false);
  });

  it("rejects a recently observed patch whose publication is older than seven days", () => {
    expect(
      resolveBurstState(
        {
          source: "official",
          observedAt: "2026-07-05T11:00:00.000Z",
          publishedAt: "2026-06-28T11:59:59.000Z",
        },
        now,
      ),
    ).toBe(false);
  });

  it("allows a current patch with no publication timestamp", () => {
    expect(resolveBurstState({ source: "official", observedAt: "2026-07-05T11:00:00.000Z", publishedAt: null }, now)).toBe(
      true,
    );
  });

  it("stays idle when there is no current patch", () => {
    expect(resolveBurstState(null, now)).toBe(false);
  });

  it("does not burst from the hardcoded fallback patch metadata", () => {
    expect(
      resolveBurstState(
        { source: "fallback", observedAt: "2026-07-05T11:00:00.000Z", publishedAt: null },
        now,
      ),
    ).toBe(false);
  });

  it("fails closed when patch metadata has no exact official source", () => {
    expect(resolveBurstState({ observedAt: "2026-07-05T11:00:00.000Z", publishedAt: null }, now)).toBe(false);
  });

  it("rejects future, malformed, and out-of-window timestamps", () => {
    expect(
      resolveBurstState(
        { source: "official", observedAt: "2026-07-05T13:00:00.000Z", publishedAt: "2026-07-05T14:00:00.000Z" },
        now,
      ),
    ).toBe(false);
    expect(resolveBurstState({ source: "official", observedAt: "not-a-date", publishedAt: null }, now)).toBe(false);
    expect(resolveBurstState({ source: "official", observedAt: "2026-07-05T11:00:00.000Z", publishedAt: "not-a-date" }, now)).toBe(false);
  });

  it("keeps both burst windows inclusive at their exact boundaries", () => {
    expect(
      resolveBurstState(
        {
          source: "official",
          observedAt: "2026-07-02T12:00:00.000Z",
          publishedAt: "2026-06-28T12:00:00.000Z",
        },
        now,
      ),
    ).toBe(true);
  });
});
