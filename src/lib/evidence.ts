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

export function countUnverifiedPersistentWatchlistClusters(clusters: EvidenceCluster[]): number {
  return clusters.filter((cluster) => cluster.fix_status === "persists" && isUnverifiedWatchlistCluster(cluster)).length;
}
