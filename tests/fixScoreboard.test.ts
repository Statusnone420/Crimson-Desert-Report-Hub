import { describe, expect, it } from "vitest";
import { buildFixScoreboard, type ScoreboardClusterInput } from "@/lib/fixScoreboard";

function cluster(overrides: Partial<ScoreboardClusterInput> = {}): ScoreboardClusterInput {
  return {
    slug: "map-open-crash-persists",
    title: "Map-open crash persists after fix",
    fix_claimed_patch_version: "1.13.01",
    readout: {
      label: "Still happening",
      tone: "crimson",
      poll: { fixedCount: 1, stillCount: 2, escalated: true },
    },
    ...overrides,
  };
}

describe("buildFixScoreboard", () => {
  it("returns null when there are no claims and no fix-claimed clusters", () => {
    expect(
      buildFixScoreboard({
        claims: [],
        clusters: [cluster({ fix_claimed_patch_version: "1.12.00" })],
        patchVersion: "1.13.01",
      }),
    ).toBeNull();
  });

  it("counts claims by category, grouping null as general, sorted by count", () => {
    const board = buildFixScoreboard({
      claims: [
        { fixText: "Fixed a crash.", category: "crash_startup" },
        { fixText: "Fixed audio distortion.", category: null },
        { fixText: "Fixed another crash.", category: "crash_startup" },
      ],
      clusters: [],
      patchVersion: "1.13.01",
    });
    expect(board).not.toBeNull();
    expect(board?.totalClaims).toBe(3);
    expect(board?.categories).toEqual([
      ["crash_startup", 2],
      ["general", 1],
    ]);
  });

  it("only includes clusters whose fix claim the engine tied to the current patch", () => {
    const board = buildFixScoreboard({
      claims: [{ fixText: "Fixed a crash.", category: "crash_startup" }],
      clusters: [
        cluster(),
        cluster({ slug: "old-claim", fix_claimed_patch_version: "1.12.00" }),
        cluster({ slug: "no-claim", fix_claimed_patch_version: null }),
      ],
      patchVersion: "1.13.01",
    });
    expect(board?.verifying.map((row) => row.slug)).toEqual(["map-open-crash-persists"]);
  });

  it("passes the shared readout verdict through untouched, with poll counts", () => {
    const board = buildFixScoreboard({
      claims: [],
      clusters: [cluster()],
      patchVersion: "1.13.01",
    });
    expect(board?.verifying[0]).toMatchObject({
      label: "Still happening",
      tone: "crimson",
      fixedCount: 1,
      stillCount: 2,
    });
  });

  it("reads zero poll counts when no poll is active yet", () => {
    const board = buildFixScoreboard({
      claims: [],
      clusters: [
        cluster({
          readout: { label: "Fix claimed — unverified", tone: "amber", poll: null },
        }),
      ],
      patchVersion: "1.13.01",
    });
    expect(board?.verifying[0]).toMatchObject({ fixedCount: 0, stillCount: 0 });
  });
});
