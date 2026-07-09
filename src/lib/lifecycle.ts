import { FIX_STATUSES, type FixStatus } from "@/lib/constants";

export const LIFECYCLE_LABELS: Record<FixStatus, string> = {
  reported: "Open",
  acknowledged: "Acknowledged",
  fix_claimed: "Watching fix",
  verified_fixed: "No fresh reports",
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
  adminOverride: boolean;
  publicPostHotfixEvidenceCount: number;
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
};

const SILENCE_WINDOW_DAYS = 7;

function normalizeStatus(status: string): FixStatus {
  return (FIX_STATUSES as readonly string[]).includes(status) ? (status as FixStatus) : "reported";
}

function daysSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const started = new Date(iso).getTime();
  if (!Number.isFinite(started)) return null;
  return Math.floor((now.getTime() - started) / (24 * 60 * 60 * 1000));
}

function result(
  status: FixStatus,
  detail: string,
  options: {
    needsHuman?: boolean;
    fixClaimedAt?: string | null;
    reasons?: string[];
  } = {},
): ClusterLifecycleResult {
  return {
    status,
    primaryLabel: LIFECYCLE_LABELS[status],
    detail,
    reasons: options.reasons ?? [detail],
    needsHuman: options.needsHuman ?? false,
    fixClaimedAt: options.fixClaimedAt ?? null,
  };
}

function computeUnlockedLifecycle(input: ClusterLifecycleInput): ClusterLifecycleResult {
  const currentStatus = normalizeStatus(input.currentStatus);
  const decision = input.claimDecision ?? { matchKind: "none" as const };
  const hasSureClaim = decision.matchKind === "llm_sure";
  const existingClaimClock = input.fixClaimedAt;
  const nextClaimClock = existingClaimClock ?? (hasSureClaim ? input.now.toISOString() : null);
  const hasClaimContext =
    Boolean(nextClaimClock) || currentStatus === "fix_claimed" || currentStatus === "verified_fixed" || currentStatus === "persists";

  if (hasClaimContext && input.publicPostHotfixEvidenceCount > 0) {
    return result("persists", "Fresh public evidence appeared after the claimed fix.", {
      fixClaimedAt: nextClaimClock,
    });
  }

  const quietDays = daysSince(nextClaimClock, input.now);
  if (nextClaimClock && quietDays !== null && quietDays >= SILENCE_WINDOW_DAYS) {
    return result("verified_fixed", "No fresh public reports for 7 days after the fix claim.", {
      fixClaimedAt: nextClaimClock,
    });
  }

  if (hasSureClaim || currentStatus === "fix_claimed") {
    return result("fix_claimed", "PA claim matched this issue; watching for fresh reports.", {
      fixClaimedAt: nextClaimClock,
    });
  }

  if (currentStatus === "verified_fixed") {
    return result("verified_fixed", "No fresh public reports are attached right now.", {
      fixClaimedAt: nextClaimClock,
    });
  }

  if (currentStatus === "persists") {
    return result("persists", "This is still marked active after a claimed fix.", {
      fixClaimedAt: nextClaimClock,
    });
  }

  if (decision.matchKind === "llm_unsure") {
    return result(currentStatus, decision.reason ?? "Needs review: PA claim was not confidently matched.", {
      needsHuman: true,
      fixClaimedAt: nextClaimClock,
    });
  }

  if (decision.matchKind === "keyword_proposal") {
    return result(currentStatus, decision.reason ?? "Needs review: keyword match is only a proposal.", {
      needsHuman: true,
      fixClaimedAt: nextClaimClock,
    });
  }

  return result(currentStatus, LIFECYCLE_LABELS[currentStatus], {
    fixClaimedAt: nextClaimClock,
  });
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
  };
}
