export type PromotionInput = {
  independentSourceCount: number;
  directReportCount: number;
  highestConfidence: "low" | "medium" | "high";
  hasAdminForcePublic: boolean;
  hasAdminForceHidden: boolean;
};

export type PromotionDecision = {
  publicStatus: "private" | "public" | "hidden";
  reason: string;
};

export function shouldPromoteSignalCluster(input: PromotionInput): PromotionDecision {
  if (input.hasAdminForceHidden) return { publicStatus: "hidden", reason: "admin_force_hidden" };
  if (input.hasAdminForcePublic) return { publicStatus: "public", reason: "admin_force_public" };
  if (input.directReportCount > 0) return { publicStatus: "public", reason: "direct_report_match" };
  if (input.independentSourceCount >= 2) return { publicStatus: "public", reason: "two_independent_sources" };
  if (input.highestConfidence === "high" && input.independentSourceCount >= 1) {
    return { publicStatus: "public", reason: "single_high_confidence_source" };
  }
  return { publicStatus: "private", reason: "below_threshold" };
}

export function weightedClusterScore(input: {
  publicSignalCount: number;
  directReportCount: number;
  verifiedReportCount: number;
  lastSignalAt: string | null;
}): number {
  const recency = input.lastSignalAt ? Math.max(0, 14 - (Date.now() - new Date(input.lastSignalAt).getTime()) / 86400000) : 0;
  return input.publicSignalCount + input.directReportCount * 3 + input.verifiedReportCount * 5 + recency / 10;
}
