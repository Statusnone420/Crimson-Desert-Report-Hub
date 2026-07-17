import { describe, expect, it } from "vitest";
import { assessClaims, uniqueClaimAttributions } from "@/lib/claims";

const clusters = [
  {
    id: "c1",
    slug: "map_open_crash_persistent",
    title: "Map-open crash after claimed fix",
    category: "crash_startup",
    strengthScore: 4,
    directReportCount: 1,
    signalCount: 1,
    postCurrentPatchEvidenceCount: 1,
  },
  {
    id: "c2",
    slug: "performance_regression",
    title: "FPS / performance regression since 1.13.00",
    category: "performance",
    strengthScore: 0,
    directReportCount: 0,
    signalCount: 0,
    postCurrentPatchEvidenceCount: 0,
  },
];

describe("uniqueClaimAttributions", () => {
  it("does not invent a claim for a manually locked lifecycle cluster", () => {
    const result = uniqueClaimAttributions([], [clusters[0]]);
    expect(result.size).toBe(0);
  });

  it("requires exactly one claim and one verifying cluster per category", () => {
    const claim = { fixText: "Fixed the map crash.", category: "crash_startup" };
    expect(uniqueClaimAttributions([claim], [clusters[0]]).get("crash_startup")?.id).toBe("c1");
    expect(uniqueClaimAttributions([claim, { ...claim, fixText: "Fixed another map crash." }], [clusters[0]])).toEqual(
      new Map(),
    );
    expect(uniqueClaimAttributions([claim], [clusters[0], { ...clusters[0], id: "c1-duplicate" }])).toEqual(
      new Map(),
    );
  });
});

describe("assessClaims", () => {
  it("marks a claim disputed when it routes to a cluster with evidence", () => {
    const result = assessClaims(
      [{ fixText: "Fixed an issue where opening the map caused the game to crash.", category: "crash_startup" }],
      clusters,
    );
    expect(result.total).toBe(1);
    expect(result.disputed).toHaveLength(1);
    expect(result.disputed[0]?.cluster?.id).toBe("c1");
  });

  it("keeps claims clean when the routed cluster has no evidence", () => {
    const result = assessClaims(
      [{ fixText: "Fixed an issue where FPS dropped in towns.", category: "performance" }],
      clusters,
    );
    expect(result.disputed).toHaveLength(0);
  });

  it("does not dispute a claimed fix from carried-over family evidence alone", () => {
    const result = assessClaims(
      [{ fixText: "Fixed an issue where opening the map caused the game to crash.", category: "crash_startup" }],
      [
        {
          ...clusters[0],
          strengthScore: 4,
          directReportCount: 1,
          signalCount: 1,
          postCurrentPatchEvidenceCount: 0,
        },
      ],
    );
    expect(result.all[0]?.cluster?.id).toBe("c1");
    expect(result.disputed).toHaveLength(0);
  });

  it("never disputes claims without a category", () => {
    const result = assessClaims([{ fixText: "Improved the Dye UI.", category: null }], clusters);
    expect(result.disputed).toHaveLength(0);
    expect(result.all[0]?.cluster).toBeNull();
  });

  it("leaves a claim unrouted when its category matches no keyword route", () => {
    const result = assessClaims(
      [{ fixText: "Improved the Dye UI.", category: "controls_gameplay" }],
      clusters,
    );
    expect(result.disputed).toHaveLength(0);
    expect(result.all[0]?.cluster).toBeNull();
  });
});
