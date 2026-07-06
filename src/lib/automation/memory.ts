import { buildSearchQueries } from "@/lib/automation/search";

export type ScanIntent =
  | "broad_discovery"
  | "forum_discovery"
  | "corroborate_cluster"
  | "rescue_candidate"
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

export function chooseScanIntent(memory: ScanMemory, rotationOffset = 0): ScanIntent {
  // Staleness is handled by the always-on quarantine step in run.ts, so the
  // intent never returns "quarantine" (which would suppress all searching).
  // A discovery lane is always in the rotation so discovery keeps running on a
  // regular cadence even when a rescue/corroborate backlog exists; the eligible
  // lanes interleave rather than any single backlog monopolizing every run.
  const discoveryLane: ScanIntent = rotationOffset % 2 === 0 ? "broad_discovery" : "forum_discovery";
  const corroborateEligible =
    memory.privateSignals > 0 ||
    memory.targetClusterTitles.length > 0 ||
    memory.recentRuns.some(previousRunKeptNoSignals);
  const rescueEligible = memory.rejectedCandidates > 0;

  const lanes: ScanIntent[] = [discoveryLane];
  if (corroborateEligible) lanes.push("corroborate_cluster");
  if (rescueEligible) lanes.push("rescue_candidate");
  return lanes[rotationOffset % lanes.length];
}

export function buildMemorySearchQueries(
  maxQueries: number,
  patchVersion: string,
  intent: ScanIntent,
  options: { rotationOffset?: number; targetClusterTitles?: string[] } = {},
): string[] {
  const count = Math.max(0, Math.trunc(maxQueries));
  if (count === 0) return [];

  if (intent === "quarantine") return [];

  if (intent === "corroborate_cluster") {
    const titles = options.targetClusterTitles ?? [];
    const rotationOffset = options.rotationOffset ?? 0;
    const target = titles.length > 0 ? titles[rotationOffset % titles.length]?.trim() : undefined;
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

  return buildSearchQueries(count, patchVersion, { rotationOffset: options.rotationOffset });
}
