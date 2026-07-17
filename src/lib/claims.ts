import { routeToWatchlistCluster } from "@/lib/automation/route";
import type { Category } from "@/lib/constants";

export type ClaimLike = { fixText: string; category: string | null };

/**
 * Join official claims to lifecycle clusters only when both sides are unique
 * within a category. A category alone is not a claim-to-cluster foreign key.
 */
export function uniqueClaimAttributions<T extends { id: string; category: string }>(
  claims: ClaimLike[],
  clusters: T[],
): Map<string, T> {
  const claimCounts = new Map<string, number>();
  for (const claim of claims) {
    if (claim.category === null) continue;
    claimCounts.set(claim.category, (claimCounts.get(claim.category) ?? 0) + 1);
  }

  const attributions = new Map<string, T>();
  for (const cluster of clusters) {
    const clusterMatches = clusters.filter((candidate) => candidate.category === cluster.category);
    if (claimCounts.get(cluster.category) === 1 && clusterMatches.length === 1) {
      attributions.set(cluster.category, cluster);
    }
  }
  return attributions;
}

export type ClaimClusterLike = {
  id: string;
  slug: string;
  title: string;
  category: string;
  description?: string;
  fix_status?: string;
  strengthScore: number;
  directReportCount: number;
  signalCount: number;
  candidateSignalCount?: number;
  postCurrentPatchEvidenceCount?: number;
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

/** Route each official claimed fix to a watchlist cluster; post-hotfix evidence there disputes the claim. */
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
    return { fixText: claim.fixText, disputed: (cluster?.postCurrentPatchEvidenceCount ?? 0) > 0, cluster };
  });
  return { total: all.length, disputed: all.filter((claim) => claim.disputed), all };
}
