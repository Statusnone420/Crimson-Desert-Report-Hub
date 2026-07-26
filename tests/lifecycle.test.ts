import { describe, expect, it } from "vitest";
import { computeClusterLifecycle, LIFECYCLE_LABELS } from "@/lib/lifecycle";

const now = new Date("2026-07-15T12:00:00.000Z");

function lifecycleInput(overrides: Partial<Parameters<typeof computeClusterLifecycle>[0]> = {}) {
  return {
    currentStatus: "reported",
    fixClaimedAt: null,
    fixClaimedPatchVersion: null,
    currentPatchVersion: "1.13.01",
    adminOverride: false,
    now,
    ...overrides,
  };
}

describe("computeClusterLifecycle", () => {
  it("labels statuses for admin surfaces without a green silence verdict", () => {
    expect(LIFECYCLE_LABELS).toMatchObject({
      reported: "Open",
      fix_claimed: "Fix claimed — unverified",
      verified_fixed: "Marked fixed by maintainer",
      persists: "Still happening",
    });
  });

  it("stamps the claim date when an LLM-sure PA claim matches", () => {
    const result = computeClusterLifecycle(lifecycleInput({
      claimDecision: { matchKind: "llm_sure", claimText: "Improved FPS drops." },
    }));

    expect(result).toMatchObject({
      status: "fix_claimed",
      primaryLabel: "Fix claimed — unverified",
      needsHuman: false,
    });
    expect(result.fixClaimedAt).toBe(now.toISOString());
    expect(result.fixClaimedPatchVersion).toBe("1.13.01");
  });

  it("never ages a claimed fix by silence — 30 quiet days stay fix_claimed", () => {
    const result = computeClusterLifecycle(lifecycleInput({
      currentStatus: "fix_claimed",
      fixClaimedAt: "2026-06-15T12:00:00.000Z",
      fixClaimedPatchVersion: "1.13.01",
    }));

    expect(result.status).toBe("fix_claimed");
    expect(result.fixClaimedAt).toBe("2026-06-15T12:00:00.000Z");
  });

  it("does not carry an older hotfix claim into the current patch", () => {
    const result = computeClusterLifecycle(lifecycleInput({
      currentStatus: "fix_claimed",
      fixClaimedAt: "2026-06-15T12:00:00.000Z",
      fixClaimedPatchVersion: "1.13.00",
    }));

    expect(result).toMatchObject({
      status: "reported",
      fixClaimedAt: null,
      fixClaimedPatchVersion: null,
    });
  });

  it("starts a fresh clock when the current patch has a new sure claim", () => {
    const result = computeClusterLifecycle(lifecycleInput({
      currentStatus: "fix_claimed",
      fixClaimedAt: "2026-06-15T12:00:00.000Z",
      fixClaimedPatchVersion: "1.13.00",
      claimDecision: { matchKind: "llm_sure" },
    }));

    expect(result).toMatchObject({
      status: "fix_claimed",
      fixClaimedAt: now.toISOString(),
      fixClaimedPatchVersion: "1.13.01",
    });
  });

  it("normalizes same-family legacy verdict rows back to the claim date", () => {
    const fixed = computeClusterLifecycle(lifecycleInput({
      currentStatus: "verified_fixed",
      fixClaimedAt: "2026-07-01T12:00:00.000Z",
      fixClaimedPatchVersion: "1.13.01",
    }));
    expect(fixed.status).toBe("fix_claimed");
    expect(fixed.fixClaimedAt).toBe("2026-07-01T12:00:00.000Z");

    const persisted = computeClusterLifecycle(lifecycleInput({
      currentStatus: "persists",
      fixClaimedAt: null,
      fixClaimedPatchVersion: null,
    }));
    expect(persisted.status).toBe("reported");
    expect(persisted.fixClaimedAt).toBeNull();
  });

  it("normalizes legacy acknowledged rows to reported when no claim exists", () => {
    const result = computeClusterLifecycle(lifecycleInput({
      currentStatus: "acknowledged",
    }));
    expect(result.status).toBe("reported");
    expect(result.needsHuman).toBe(false);
  });

  it("flags an unsure LLM result for a human without writing lifecycle", () => {
    const result = computeClusterLifecycle(lifecycleInput({
      claimDecision: { matchKind: "llm_unsure", reason: "Needs review: possible FPS wording." },
    }));

    expect(result).toMatchObject({
      status: "reported",
      needsHuman: true,
      fixClaimedAt: null,
    });
    expect(result.detail).toContain("Needs review:");
  });

  it("keeps keyword-only proposals as human exceptions, never claim starts", () => {
    const result = computeClusterLifecycle(lifecycleInput({
      claimDecision: { matchKind: "keyword_proposal", reason: "Needs review: keyword match only." },
    }));

    expect(result).toMatchObject({
      status: "reported",
      needsHuman: true,
      fixClaimedAt: null,
    });
  });

  it("keeps admin overrides locked while exposing the system read", () => {
    const result = computeClusterLifecycle(lifecycleInput({
      adminOverride: true,
      claimDecision: { matchKind: "llm_sure" },
    }));

    expect(result).toMatchObject({
      status: "reported",
      primaryLabel: "Locked by you",
      fixClaimedAt: null,
      fixClaimedPatchVersion: null,
      needsHuman: false,
    });
    expect(result.detail).toContain("System would show: Fix claimed — unverified.");
  });
});
