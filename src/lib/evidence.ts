export function hasClusterEvidence(cluster: { directReportCount: number }): boolean {
  return cluster.directReportCount > 0;
}

export function needsFullIssueCard(cluster: {
  strengthScore: number;
  directReportCount: number;
  confirmations: { affectedCount: number };
  earlierCheckinCount?: number;
  readout: { poll: unknown; state?: string; hasCurrentClaim?: boolean };
}): boolean {
  return (
    hasClusterEvidence(cluster) ||
    cluster.strengthScore > 0 ||
    cluster.confirmations.affectedCount > 0 ||
    (cluster.earlierCheckinCount ?? 0) > 0 ||
    cluster.readout.hasCurrentClaim === true ||
    cluster.readout.poll !== null ||
    cluster.readout.state === "public_sources_unavailable"
  );
}

const PIPELINE_NOTE = /\s*\(body retained for 48h moderator review\)\s*$/i;
const LEGACY_WATCHLIST_NOTE = /^Watchlist item for (.+?) after patch (\d+\.\d+\.\d+)\./i;

export function displayDescription(
  title: string,
  description: string | null | undefined,
): string | null {
  const cleaned = (description ?? "").replace(PIPELINE_NOTE, "").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  if (cleaned.toLowerCase() === title.replace(/\s+/g, " ").trim().toLowerCase()) return null;
  // Keep the original seed's patch context explicit when its issue later moves
  // onto a newer patch's board. This changes display copy, never stored evidence.
  return cleaned.replace(LEGACY_WATCHLIST_NOTE, "Historical watchlist note (Patch $2): $1.");
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
  return `Monitoring ${count} additional watchlist issue${count === 1 ? "" : "s"}.`;
}
