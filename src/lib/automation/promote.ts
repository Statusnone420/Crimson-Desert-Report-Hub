/**
 * Separate player threads, each opened by a different player, that publish an
 * issue on their own, even when every thread is on one site. One site is weaker
 * backing than several, and a player can post under a second name, so this
 * takes the bar of the three-site rule.
 */
export const MIN_DISTINCT_PLAYER_THREADS = 3;

export type PromotionInput = {
  /** Count of distinct source domains observed in the last 14 days. */
  independentDomainCount: number;
  /** Of those domains, how many are tier "trusted". */
  trustedDomainCount: number;
  /** Threads observed in the last 14 days with a different known author each (see countDistinctPlayerThreads). */
  distinctPlayerThreadCount: number;
  directReportCount: number;
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
  if (input.independentDomainCount >= 2 && input.trustedDomainCount >= 1) {
    return { publicStatus: "public", reason: "two_independent_domains_trusted" };
  }
  if (input.independentDomainCount >= 3) {
    return { publicStatus: "public", reason: "three_independent_domains" };
  }
  if (input.distinctPlayerThreadCount >= MIN_DISTINCT_PLAYER_THREADS) {
    return { publicStatus: "public", reason: "distinct_player_threads" };
  }
  return { publicStatus: "private", reason: "below_threshold" };
}

/**
 * How many threads can count, one per author: a thread with no known author
 * never counts, a thread seen twice counts once, and an author with several
 * threads counts once. A thread stored with two keys keeps the smaller one, so
 * one thread never stands for two authors.
 */
export function countDistinctPlayerThreads(threads: { threadKey: string | null; authorKey: string | null }[]): number {
  const authorByThread = new Map<string, string>();
  for (const { threadKey, authorKey } of threads) {
    if (!threadKey || !authorKey) continue;
    const known = authorByThread.get(threadKey);
    if (known === undefined || authorKey < known) authorByThread.set(threadKey, authorKey);
  }
  return new Set(authorByThread.values()).size;
}

/**
 * Resolve the per-signal `public_status` from a cluster-level promotion decision.
 * A cluster with an approved user report is public via `direct_report_match`, but
 * that alone must NOT publish an individual scanner signal as standalone public
 * evidence: a lone untrusted single-domain signal has no corroboration of its own.
 * Such a signal stays `private`/`below_threshold` (it still counts toward the
 * cluster). Only `direct_report_match` is gated here — every other reason
 * (admin forces, domain-corroboration reasons, below_threshold) passes through
 * unchanged.
 */
export function resolveSignalPublicStatus(input: {
  decision: PromotionDecision;
  signalTrusted: boolean;
  corroboratedByDomains: boolean;
}): { publicStatus: "public" | "private" | "hidden"; reason: string } {
  if (input.decision.publicStatus !== "public") {
    // Preserve the decision verbatim: a force-hidden cluster's publishable signal
    // must stay `hidden` (not leak back into the private-signal targeting pool),
    // and a below-threshold decision stays `private`.
    return { publicStatus: input.decision.publicStatus, reason: input.decision.reason };
  }
  if (input.decision.reason === "direct_report_match" && !input.signalTrusted && !input.corroboratedByDomains) {
    return { publicStatus: "private", reason: "below_threshold" };
  }
  return { publicStatus: "public", reason: input.decision.reason };
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
