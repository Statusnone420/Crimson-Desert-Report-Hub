import { describe, expect, it } from "vitest";
import { computeClusterLifecycle, LIFECYCLE_LABELS } from "@/lib/lifecycle";

const now = new Date("2026-07-15T12:00:00.000Z");

describe("computeClusterLifecycle", () => {
  it("uses compact HCI labels for lifecycle statuses", () => {
    expect(LIFECYCLE_LABELS).toMatchObject({
      reported: "Open",
      fix_claimed: "Watching fix",
      verified_fixed: "No fresh reports",
      persists: "Still happening",
    });
  });

  it("starts the watch clock when an LLM-sure PA claim matches", () => {
    const result = computeClusterLifecycle({
      currentStatus: "reported",
      fixClaimedAt: null,
      adminOverride: false,
      publicPostHotfixEvidenceCount: 0,
      now,
      claimDecision: { matchKind: "llm_sure", claimText: "Improved FPS drops." },
    });

    expect(result).toMatchObject({
      status: "fix_claimed",
      primaryLabel: "Watching fix",
      needsHuman: false,
    });
    expect(result.fixClaimedAt).toBe(now.toISOString());
  });

  it("does not auto-write lifecycle from an unsure LLM result", () => {
    const result = computeClusterLifecycle({
      currentStatus: "reported",
      fixClaimedAt: null,
      adminOverride: false,
      publicPostHotfixEvidenceCount: 0,
      now,
      claimDecision: { matchKind: "llm_unsure", reason: "Needs review: possible FPS wording." },
    });

    expect(result).toMatchObject({
      status: "reported",
      primaryLabel: "Open",
      needsHuman: true,
      fixClaimedAt: null,
    });
  });

  it("does not auto-write lifecycle from a keyword-only proposal", () => {
    const result = computeClusterLifecycle({
      currentStatus: "reported",
      fixClaimedAt: null,
      adminOverride: false,
      publicPostHotfixEvidenceCount: 0,
      now,
      claimDecision: { matchKind: "keyword_proposal", reason: "Needs review: keyword match only." },
    });

    expect(result).toMatchObject({
      status: "reported",
      primaryLabel: "Open",
      needsHuman: true,
      fixClaimedAt: null,
    });
  });

  it("ages a watched fix to no fresh reports after seven public-silent days", () => {
    const result = computeClusterLifecycle({
      currentStatus: "fix_claimed",
      fixClaimedAt: "2026-07-08T12:00:00.000Z",
      adminOverride: false,
      publicPostHotfixEvidenceCount: 0,
      now,
    });

    expect(result).toMatchObject({
      status: "verified_fixed",
      primaryLabel: "No fresh reports",
    });
  });

  it("marks a watched fix as still happening when public post-hotfix evidence appears", () => {
    const result = computeClusterLifecycle({
      currentStatus: "fix_claimed",
      fixClaimedAt: "2026-07-12T12:00:00.000Z",
      adminOverride: false,
      publicPostHotfixEvidenceCount: 1,
      now,
    });

    expect(result).toMatchObject({
      status: "persists",
      primaryLabel: "Still happening",
    });
  });

  it("does not let private-only candidates force persistence", () => {
    const result = computeClusterLifecycle({
      currentStatus: "fix_claimed",
      fixClaimedAt: "2026-07-12T12:00:00.000Z",
      adminOverride: false,
      publicPostHotfixEvidenceCount: 0,
      now,
    });

    expect(result.status).toBe("fix_claimed");
  });

  it("keeps admin overrides locked while exposing the system read", () => {
    const result = computeClusterLifecycle({
      currentStatus: "reported",
      fixClaimedAt: null,
      adminOverride: true,
      publicPostHotfixEvidenceCount: 0,
      now,
      claimDecision: { matchKind: "llm_sure" },
    });

    expect(result).toMatchObject({
      status: "reported",
      primaryLabel: "Locked by you",
      fixClaimedAt: null,
    });
    expect(result.detail).toContain("System would show: Watching fix.");
  });
});
