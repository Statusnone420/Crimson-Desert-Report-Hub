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
  if (memory.stalePublicSignals > 0) return "quarantine";
  if (memory.rejectedCandidates > 0) return "rescue_candidate";
  if (memory.privateSignals > 0) return "corroborate_cluster";
  if (memory.recentRuns.some(previousRunKeptNoSignals)) return "corroborate_cluster";
  return rotationOffset % 2 === 0 ? "broad_discovery" : "forum_discovery";
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
    const target = options.targetClusterTitles?.[0]?.trim();
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
