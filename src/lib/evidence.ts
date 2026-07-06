export type EvidenceCluster = {
  confidence: string;
  fix_status: string;
  strengthScore: number;
};

export function hasClusterEvidence(cluster: EvidenceCluster): boolean {
  return cluster.strengthScore > 0;
}

export function isUnverifiedWatchlistCluster(cluster: EvidenceCluster): boolean {
  return cluster.confidence === "seed_unverified" && !hasClusterEvidence(cluster);
}

export function countEvidenceBackedPersistentClusters(clusters: EvidenceCluster[]): number {
  return clusters.filter((cluster) => cluster.fix_status === "persists" && hasClusterEvidence(cluster)).length;
}

export function countUnverifiedClaimedFixWatchlistClusters(clusters: EvidenceCluster[]): number {
  return clusters.filter(
    (cluster) =>
      (cluster.fix_status === "fix_claimed" || cluster.fix_status === "persists") && isUnverifiedWatchlistCluster(cluster),
  ).length;
}

export function splitWatchlistByCandidates<T extends { candidateSignalCount: number }>(
  watchlist: T[],
): { candidates: T[]; monitored: T[] } {
  return {
    candidates: watchlist.filter((cluster) => cluster.candidateSignalCount > 0),
    monitored: watchlist.filter((cluster) => cluster.candidateSignalCount === 0),
  };
}

export function monitoredAreasNote(count: number): string {
  return `Monitoring ${count} more known problem ${count === 1 ? "area" : "areas"} — no player reports or public sources yet.`;
}

export function unconfirmedMentionsNote(count: number): string {
  return `${count} unconfirmed ${count === 1 ? "mention" : "mentions"} — not enough separate sources to back it yet`;
}
