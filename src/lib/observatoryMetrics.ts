/**
 * Share of screened candidates that became a unique tracked lead.
 * This is a selectivity metric, not an accuracy or evidence score.
 */
export function radarYieldPct(tracked: number, reviewed: number): number {
  return reviewed > 0 ? (tracked / reviewed) * 100 : 0;
}

type CandidateCountRun = {
  funnel?: Record<string, number> | null;
  search_results_seen?: number | null;
  reddit_posts_seen?: number | null;
};

/**
 * Candidate count shown in scanner readouts.
 *
 * Current runs persist the screened total in the funnel, which includes
 * keyless Steam Pulse intake. Older rows do not, so they retain the legacy
 * web-search + Reddit fallback. A real zero in the funnel is authoritative.
 */
export function displayCandidateCount(run: CandidateCountRun): number {
  const screened = run.funnel?.candidatesSeen;
  if (typeof screened === "number" && Number.isFinite(screened) && screened >= 0) {
    return screened;
  }
  return Math.max(0, Number(run.search_results_seen ?? 0)) + Math.max(0, Number(run.reddit_posts_seen ?? 0));
}
