import { routeToWatchlistCluster } from "@/lib/automation/route";
import type { Category } from "@/lib/constants";

export type ClaimLike = { fixText: string; category: string | null };

export type ClaimClusterLike = {
  id: string;
  slug: string;
  title: string;
  category: string;
  strengthScore: number;
  directReportCount: number;
  signalCount: number;
};

export type AssessedClaim = {
  fixText: string;
  disputed: boolean;
  cluster: ClaimClusterLike | null;
};

export type ClaimsAssessment = {
  total: number;
  disputed: AssessedClaim[];
  all: AssessedClaim[];
};

/** Route each official claimed fix to a watchlist cluster; evidence there disputes the claim. */
export function assessClaims(claims: ClaimLike[], clusters: ClaimClusterLike[]): ClaimsAssessment {
  const all = claims.map((claim) => {
    if (!claim.category) return { fixText: claim.fixText, disputed: false, cluster: null };
    const matched = routeToWatchlistCluster(
      {
        issueTitle: claim.fixText,
        summary: claim.fixText,
        category: claim.category as Category,
        llmClusterSlug: null,
      },
      clusters,
    );
    const cluster = matched ? (clusters.find((candidate) => candidate.id === matched.id) ?? null) : null;
    return { fixText: claim.fixText, disputed: (cluster?.strengthScore ?? 0) > 0, cluster };
  });
  return { total: all.length, disputed: all.filter((claim) => claim.disputed), all };
}
