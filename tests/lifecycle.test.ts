import { describe, expect, it } from "vitest";
import { computeClusterLifecycle, LIFECYCLE_LABELS } from "@/lib/lifecycle";

const now = new Date("2026-07-15T12:00:00.000Z");

describe("computeClusterLifecycle", () => {
  it("labels statuses for admin surfaces without a green silence verdict", () => {
    expect(LIFECYCLE_LABELS).toMatchObject({
      reported: "Open",
      fix_claimed: "Fix claimed — unverified",
      verified_fixed: "Marked fixed by maintainer",
      persists: "Still happening",
    });
  });

  it("starts the claim clock when an LLM-sure PA claim matches", () => {
    const result = computeClusterLifecycle({
      currentStatus: "reported",
      fixClaimedAt: null,
      adminOverride: false,
      now,
      claimDecision: { matchKind: "llm_sure", claimText: "Improved FPS drops." },
    });

    expect(result).toMatchObject({
      status: "fix_claimed",
      primaryLabel: "Fix claimed — unverified",
      needsHuman: false,
    });
    expect(result.fixClaimedAt).toBe(now.toISOString());
  });

  it("never ages a claimed fix by silence — 30 quiet days stay fix_claimed", () => {
    const result = computeClusterLifecycle({
      currentStatus: "fix_claimed",
      fixClaimedAt: "2026-06-15T12:00:00.000Z",
      adminOverride: false,
      now,
    });

    expect(result.status).toBe("fix_claimed");
    expect(result.fixClaimedAt).toBe("2026-06-15T12:00:00.000Z");
  });

  it("normalizes legacy verdict rows back to the claim clock", () => {
    const fixed = computeClusterLifecycle({
      currentStatus: "verified_fixed",
      fixClaimedAt: "2026-07-01T12:00:00.000Z",
      adminOverride: false,
      now,
    });
    expect(fixed.status).toBe("fix_claimed");
    expect(fixed.fixClaimedAt).toBe("2026-07-01T12:00:00.000Z");

    const persisted = computeClusterLifecycle({
      currentStatus: "persists",
      fixClaimedAt: null,
      adminOverride: false,
      now,
    });
    expect(persisted.status).toBe("fix_claimed");
  });

  it("normalizes legacy acknowledged rows to reported when no claim exists", () => {
    const result = computeClusterLifecycle({
      currentStatus: "acknowledged",
      fixClaimedAt: null,
      adminOverride: false,
      now,
    });
    expect(result.status).toBe("reported");
    expect(result.needsHuman).toBe(false);
  });

  it("flags an unsure LLM result for a human without writing lifecycle", () => {
    const result = computeClusterLifecycle({
      currentStatus: "reported",
      fixClaimedAt: null,
      adminOverride: false,
      now,
      claimDecision: { matchKind: "llm_unsure", reason: "Needs review: possible FPS wording." },
    });

    expect(result).toMatchObject({
      status: "reported",
      needsHuman: true,
      fixClaimedAt: null,
    });
    expect(result.detail).toContain("Needs review:");
  });

  it("keeps keyword-only proposals as human exceptions, never claim starts", () => {
    const result = computeClusterLifecycle({
      currentStatus: "reported",
      fixClaimedAt: null,
      adminOverride: false,
      now,
      claimDecision: { matchKind: "keyword_proposal", reason: "Needs review: keyword match only." },
    });

    expect(result).toMatchObject({
      status: "reported",
      needsHuman: true,
      fixClaimedAt: null,
    });
  });

  it("keeps admin overrides locked while exposing the system read", () => {
    const result = computeClusterLifecycle({
      currentStatus: "reported",
      fixClaimedAt: null,
      adminOverride: true,
      now,
      claimDecision: { matchKind: "llm_sure" },
    });

    expect(result).toMatchObject({
      status: "reported",
      primaryLabel: "Locked by you",
      fixClaimedAt: null,
      needsHuman: false,
    });
    expect(result.detail).toContain("System would show: Fix claimed — unverified.");
  });
});
