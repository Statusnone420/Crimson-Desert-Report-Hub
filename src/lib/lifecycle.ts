import { FIX_STATUSES, type FixStatus } from "@/lib/constants";

// Admin-facing labels. Automation only ever WRITES reported/fix_claimed; the other
// values remain valid for admin locks and legacy rows, and the readout composer
// derives every public display state from counts at read time (src/lib/readout.ts).
export const LIFECYCLE_LABELS: Record<FixStatus, string> = {
  reported: "Open",
  acknowledged: "Acknowledged",
  fix_claimed: "Fix claimed — unverified",
  verified_fixed: "Marked fixed by maintainer",
  persists: "Still happening",
};

export const ADMIN_OVERRIDE_LABEL = "Locked by you";

export type LifecycleClaimDecision =
  | { matchKind: "llm_sure"; claimText?: string | null; reason?: string | null }
  | { matchKind: "llm_unsure"; claimText?: string | null; reason?: string | null }
  | { matchKind: "keyword_proposal"; claimText?: string | null; reason?: string | null }
  | { matchKind: "none"; claimText?: string | null; reason?: string | null };

export type ClusterLifecycleInput = {
  currentStatus: string;
  fixClaimedAt: string | null;
  fixClaimedPatchVersion: string | null;
  currentPatchVersion: string;
  adminOverride: boolean;
  now: Date;
  claimDecision?: LifecycleClaimDecision | null;
};

export type ClusterLifecycleResult = {
  status: FixStatus;
  primaryLabel: string;
  detail: string;
  reasons: string[];
  needsHuman: boolean;
  fixClaimedAt: string | null;
  fixClaimedPatchVersion: string | null;
};

function normalizeStatus(status: string): FixStatus {
  return (FIX_STATUSES as readonly string[]).includes(status) ? (status as FixStatus) : "reported";
}

function hasCurrentClaimContext(input: ClusterLifecycleInput): boolean {
  return input.fixClaimedAt !== null && input.fixClaimedPatchVersion === input.currentPatchVersion;
}

function result(
  status: FixStatus,
  detail: string,
  options: { needsHuman?: boolean; fixClaimedAt?: string | null; fixClaimedPatchVersion?: string | null } = {},
): ClusterLifecycleResult {
  return {
    status,
    primaryLabel: LIFECYCLE_LABELS[status],
    detail,
    reasons: [detail],
    needsHuman: options.needsHuman ?? false,
    fixClaimedAt: options.fixClaimedAt ?? null,
    fixClaimedPatchVersion: options.fixClaimedPatchVersion ?? null,
  };
}

function computeUnlockedLifecycle(input: ClusterLifecycleInput): ClusterLifecycleResult {
  const decision = input.claimDecision ?? { matchKind: "none" as const };
  const hasSureClaim = decision.matchKind === "llm_sure";
  const currentPatchClaim = hasCurrentClaimContext(input);
  const nextClaimDate = currentPatchClaim ? input.fixClaimedAt : hasSureClaim ? input.now.toISOString() : null;

  // A sure current-patch claim stamps a claim date; an existing exact
  // current-patch date is preserved. Legacy, null-version, and older-patch dates
  // do not carry. Nothing elapses — only player answers move the displayed state.
  if (hasSureClaim || currentPatchClaim) {
    return result("fix_claimed", "Pearl Abyss claims a fix; players verify from here.", {
      fixClaimedAt: nextClaimDate,
      fixClaimedPatchVersion: input.currentPatchVersion,
    });
  }

  if (decision.matchKind === "llm_unsure") {
    return result("reported", decision.reason ?? "Needs review: PA claim was not confidently matched.", {
      needsHuman: true,
    });
  }

  if (decision.matchKind === "keyword_proposal") {
    return result("reported", decision.reason ?? "Needs review: keyword match is only a proposal.", {
      needsHuman: true,
    });
  }

  // Legacy acknowledged (or unknown) rows normalize to reported.
  return result("reported", LIFECYCLE_LABELS.reported);
}

export function computeClusterLifecycle(input: ClusterLifecycleInput): ClusterLifecycleResult {
  if (!input.adminOverride) return computeUnlockedLifecycle(input);

  const system = computeUnlockedLifecycle({ ...input, adminOverride: false });
  const status = normalizeStatus(input.currentStatus);
  const detail = `Locked by you. System would show: ${system.primaryLabel}.`;
  return {
    status,
    primaryLabel: ADMIN_OVERRIDE_LABEL,
    detail,
    reasons: [detail, ...system.reasons],
    needsHuman: false,
    fixClaimedAt: input.fixClaimedAt,
    fixClaimedPatchVersion: input.fixClaimedPatchVersion,
  };
}
