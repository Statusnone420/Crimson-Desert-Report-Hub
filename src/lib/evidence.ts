export function hasClusterEvidence(cluster: { directReportCount: number }): boolean {
  return cluster.directReportCount > 0;
}

export function needsFullIssueCard(cluster: {
  strengthScore: number;
  directReportCount: number;
  confirmations: { totalCount: number };
  readout: { poll: unknown };
}): boolean {
  return (
    hasClusterEvidence(cluster) ||
    cluster.strengthScore > 0 ||
    cluster.confirmations.totalCount > 0 ||
    cluster.readout.poll !== null
  );
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
