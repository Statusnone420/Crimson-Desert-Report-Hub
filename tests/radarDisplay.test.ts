import { describe, expect, it } from "vitest";
import {
  classifyRadarRecency,
  layoutRadarPoints,
  radarPointDescription,
  type RadarDisplayPoint,
} from "@/lib/radarDisplay";

const NOW = new Date("2026-07-23T12:00:00.000Z");
const LATEST_SCAN = "2026-07-23T11:30:00.000Z";

function point(overrides: Partial<RadarDisplayPoint> = {}): RadarDisplayPoint {
  return {
    category: "performance",
    recencyBand: "under_6h",
    hoursSinceSeen: 2,
    hoursTracked: 7 * 24,
    seenCount: 16,
    isPublic: false,
    ...overrides,
  };
}

describe("radar recency bands", () => {
  it("uses the latest successful scan before elapsed-time bands", () => {
    expect(classifyRadarRecency({
      lastSeenAt: "2026-07-23T11:31:00.000Z",
      latestScanAt: LATEST_SCAN,
      now: NOW,
    })).toBe("latest_scan");
    expect(classifyRadarRecency({
      lastSeenAt: "2026-07-23T11:29:00.000Z",
      latestScanAt: LATEST_SCAN,
      now: NOW,
    })).toBe("under_6h");
  });

  it("keeps the semantic boundaries exact instead of flooring to days", () => {
    expect(classifyRadarRecency({
      lastSeenAt: "2026-07-23T06:00:00.001Z",
      latestScanAt: null,
      now: NOW,
    })).toBe("under_6h");
    expect(classifyRadarRecency({
      lastSeenAt: "2026-07-23T06:00:00.000Z",
      latestScanAt: null,
      now: NOW,
    })).toBe("6_24h");
    expect(classifyRadarRecency({
      lastSeenAt: "2026-07-22T12:00:00.000Z",
      latestScanAt: null,
      now: NOW,
    })).toBe("1_3d");
    expect(classifyRadarRecency({
      lastSeenAt: "2026-07-19T12:00:00.000Z",
      latestScanAt: null,
      now: NOW,
    })).toBe("4_7d");
    expect(classifyRadarRecency({
      lastSeenAt: "2026-07-15T12:00:00.000Z",
      latestScanAt: null,
      now: NOW,
    })).toBe("8d_plus");
  });
});

describe("radar point layout", () => {
  it("deterministically separates points that share a sector and recency band", () => {
    const points = [
      point({ seenCount: 9 }),
      point({ seenCount: 6 }),
      point({ seenCount: 3 }),
      point({ seenCount: 1 }),
    ];

    const first = layoutRadarPoints(points, ["performance"]);
    const second = layoutRadarPoints(points, ["performance"]);
    const positions = new Set(first.map((item) => `${item.angleFraction}:${item.radiusFraction}`));

    expect(first).toEqual(second);
    expect(positions.size).toBe(points.length);
    expect(first.every((item) => item.radiusFraction > 1 / 6 && item.radiusFraction < 2 / 6)).toBe(true);
  });

  it("formats a readable, non-hover-only description", () => {
    expect(radarPointDescription(point({ recencyBand: "latest_scan" }))).toBe(
      "Seen in latest scan · observed 16× · tracked for 7 days.",
    );
  });
});
