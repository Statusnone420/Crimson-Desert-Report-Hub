import { buildSearchQueries } from "@/lib/automation/search";

export type ScanIntent =
  | "broad_discovery"
  | "forum_discovery"
  | "corroborate_cluster"
  | "rescue_candidate"
  // "quarantine" is a legacy/historical intent, never produced by chooseScanIntent
  // anymore (staleness is handled by the always-on quarantine step in run.ts). Kept
  // so older automation_runs.intent records still typecheck.
  | "quarantine";

export type RecentRunMemory = {
  status?: string | null;
  mode?: string | null;
  signals_inserted?: number | null;
  search_results_seen?: number | null;
  funnel?: { kept?: number; candidatesSeen?: number; prefilterRejected?: number } | null;
};

export type ScanMemory = {
  stalePublicSignals: number;
  privateSignals: number;
  rejectedCandidates: number;
  targetClusterTitles: string[];
  recentRuns: RecentRunMemory[];
};

function previousRunKeptNoSignals(run: RecentRunMemory): boolean {
  if (run.status === "skipped" || run.mode === "dry_run") return false;
  const kept = Number(run.signals_inserted ?? run.funnel?.kept ?? 0);
  const candidatesSeen = Number(run.funnel?.candidatesSeen ?? run.search_results_seen ?? 0);
  return kept === 0 && candidatesSeen > 0;
}

// Staleness is handled by the always-on quarantine step in run.ts, so the
// intent never returns "quarantine" (which would suppress all searching).
// A discovery lane is always in the rotation so discovery keeps running on a
// regular cadence even when a rescue/corroborate backlog exists; the eligible
// lanes interleave rather than any single backlog monopolizing every run.
function eligibleLanes(memory: ScanMemory, rotationOffset: number): ScanIntent[] {
  const corroborateEligible =
    memory.privateSignals > 0 ||
    memory.targetClusterTitles.length > 0 ||
    memory.recentRuns.some(previousRunKeptNoSignals);
  const rescueEligible = memory.rejectedCandidates > 0;
  const laneCount = 1 + (corroborateEligible ? 1 : 0) + (rescueEligible ? 1 : 0);
  // Broad vs forum advances per DISCOVERY TURN (offset / laneCount), not per raw offset
  // parity. Otherwise, when a single backlog makes laneCount 2, the discovery slot only
  // lands on even offsets — all "broad" under a parity rule — and forum_discovery (the
  // site:reddit / site:steam lane) would never fire while the backlog persists.
  const discoveryTurn = Math.floor(rotationOffset / laneCount);
  const discoveryLane: ScanIntent = discoveryTurn % 2 === 0 ? "broad_discovery" : "forum_discovery";
  const lanes: ScanIntent[] = [discoveryLane];
  if (corroborateEligible) lanes.push("corroborate_cluster");
  if (rescueEligible) lanes.push("rescue_candidate");
  return lanes;
}

export function chooseScanIntent(memory: ScanMemory, rotationOffset = 0): ScanIntent {
  const lanes = eligibleLanes(memory, rotationOffset);
  // Negative-safe modulo, matching the rotation convention in search.ts.
  const laneIndex = ((rotationOffset % lanes.length) + lanes.length) % lanes.length;
  return lanes[laneIndex];
}

// Number of eligible lanes at a given offset — lets the corroborate title
// rotation advance once per corroborate TURN (offset / laneCount) rather than
// per raw offset, so gcd(lanes, titles) > 1 no longer strands half the watchlist.
export function eligibleLaneCount(memory: ScanMemory, rotationOffset = 0): number {
  return eligibleLanes(memory, rotationOffset).length;
}

export function buildMemorySearchQueries(
  maxQueries: number,
  patchVersion: string,
  intent: ScanIntent,
  options: { rotationOffset?: number; targetClusterTitles?: string[]; laneCount?: number } = {},
): string[] {
  const count = Math.max(0, Math.trunc(maxQueries));
  if (count === 0) return [];

  if (intent === "quarantine") return [];

  const rotationOffset = options.rotationOffset ?? 0;
  const laneCount = Math.max(1, options.laneCount ?? 1);
  // Advance one "turn" per full lane cycle, not per raw offset: each lane fires on only
  // a residue class of offsets, so keying sub-rotations (which title to corroborate,
  // which broad query pack) off the turn sweeps the whole set instead of stranding a
  // residue class. laneCount defaults to 1 (turn === offset) so direct callers keep prior behavior.
  const turn = Math.floor(rotationOffset / laneCount);

  if (intent === "corroborate_cluster") {
    const titles = options.targetClusterTitles ?? [];
    // Negative-safe modulo, matching the rotation convention in search.ts.
    const titleIndex = titles.length > 0 ? ((turn % titles.length) + titles.length) % titles.length : 0;
    const target = titles.length > 0 ? titles[titleIndex]?.trim() : undefined;
    const targetText = target ? `${target} ` : "";
    return [`Crimson Desert patch ${patchVersion} ${targetText}player reports corroborate crash stutter FPS issues`].slice(0, count);
  }

  if (intent === "rescue_candidate") {
    return [`site:reddit.com OR site:steamcommunity.com Crimson Desert patch ${patchVersion} player reports bug issue`].slice(0, count);
  }

  if (intent === "forum_discovery") {
    const forumQueries = [
      `site:reddit.com Crimson Desert patch ${patchVersion} crash freeze stutter issue`,
      `site:steamcommunity.com Crimson Desert patch ${patchVersion} stutter low FPS issue`,
    ];
    return forumQueries.slice(0, count);
  }

  // broad_discovery: rotate the query pack by TURN so successive broad-discovery turns
  // cycle the whole pack instead of being pinned to a residue class of raw offsets.
  return buildSearchQueries(count, patchVersion, { rotationOffset: turn });
}
