export function hasClusterEvidence(cluster: { directReportCount: number }): boolean {
  return cluster.directReportCount > 0;
}

export function needsFullIssueCard(cluster: {
  strengthScore: number;
  directReportCount: number;
  confirmations: { totalCount: number };
  readout: { poll: unknown; state?: string };
}): boolean {
  return (
    hasClusterEvidence(cluster) ||
    cluster.strengthScore > 0 ||
    cluster.confirmations.totalCount > 0 ||
    cluster.readout.poll !== null ||
    cluster.readout.state === "public_sources_unavailable"
  );
}

const PIPELINE_NOTE = /\s*\(body retained for 48h moderator review\)\s*$/i;

export function displayDescription(
  title: string,
  description: string | null | undefined,
): string | null {
  const cleaned = (description ?? "").replace(PIPELINE_NOTE, "").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  if (cleaned.toLowerCase() === title.replace(/\s+/g, " ").trim().toLowerCase()) return null;
  return cleaned;
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
  return `Monitoring ${count} more on the watchlist — no player reports or public sources yet.`;
}
