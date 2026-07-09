export const CONFIRMATION_KINDS = ["have_it", "still_happening", "fixed_for_me"] as const;
export type ConfirmationKind = (typeof CONFIRMATION_KINDS)[number];

export type ConfirmationRow = {
  cluster_id: string;
  platform: string;
  kind: ConfirmationKind;
  voter_ip_hash: string;
  created_at: string;
};

export type ClusterConfirmations = {
  affectedCount: number;
  affectedNetworks: number;
  pollFixedCount: number;
  pollFixedNetworks: number;
  pollStillCount: number;
  pollStillNetworks: number;
  byPlatform: Record<string, { count: number; networks: number }>;
};

export const EMPTY_CLUSTER_CONFIRMATIONS: ClusterConfirmations = {
  affectedCount: 0,
  affectedNetworks: 0,
  pollFixedCount: 0,
  pollFixedNetworks: 0,
  pollStillCount: 0,
  pollStillNetworks: 0,
  byPlatform: {},
};

function timeOf(iso: string): number | null {
  const time = new Date(iso).getTime();
  return Number.isFinite(time) ? time : null;
}

/**
 * Aggregate one cluster's confirmation rows into display tallies.
 * Affected = voters whose current stance is have_it or still_happening.
 * Poll = fixed_for_me / still_happening votes cast at or after the claim clock.
 * Hashes are consumed here for distinct-network counts and never leave the output.
 */
export function computeClusterConfirmations(rows: ConfirmationRow[], fixClaimedAt: string | null): ClusterConfirmations {
  const claimTime = fixClaimedAt ? timeOf(fixClaimedAt) : null;
  const affectedHashes = new Set<string>();
  const pollFixedHashes = new Set<string>();
  const pollStillHashes = new Set<string>();
  const platformHashes: Record<string, Set<string>> = {};
  let affectedCount = 0;
  let pollFixedCount = 0;
  let pollStillCount = 0;
  const byPlatform: Record<string, { count: number; networks: number }> = {};

  for (const row of rows) {
    const affected = row.kind === "have_it" || row.kind === "still_happening";
    if (affected) {
      affectedCount += 1;
      affectedHashes.add(row.voter_ip_hash);
      (byPlatform[row.platform] ??= { count: 0, networks: 0 }).count += 1;
      (platformHashes[row.platform] ??= new Set()).add(row.voter_ip_hash);
    }
    if (claimTime !== null && row.kind !== "have_it") {
      const votedAt = timeOf(row.created_at);
      if (votedAt !== null && votedAt >= claimTime) {
        if (row.kind === "fixed_for_me") {
          pollFixedCount += 1;
          pollFixedHashes.add(row.voter_ip_hash);
        } else {
          pollStillCount += 1;
          pollStillHashes.add(row.voter_ip_hash);
        }
      }
    }
  }

  for (const [platform, hashes] of Object.entries(platformHashes)) {
    byPlatform[platform].networks = hashes.size;
  }

  return {
    affectedCount,
    affectedNetworks: affectedHashes.size,
    pollFixedCount,
    pollFixedNetworks: pollFixedHashes.size,
    pollStillCount,
    pollStillNetworks: pollStillHashes.size,
    byPlatform,
  };
}
