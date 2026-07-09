export function hasClusterEvidence(cluster: { strengthScore: number }): boolean {
  return cluster.strengthScore > 0;
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
