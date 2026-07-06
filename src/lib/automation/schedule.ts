export type RecentRunLike = { mode: string; status: string; started_at?: string | null };

export type ScheduledScanDecision =
  | { run: true }
  | { run: false; skipReason: "paused" | "recent_run" | "scan_already_running" };

const DEFAULT_MIN_INTERVAL_MINUTES = 60;

function intervalMs(minIntervalMinutes: number): number {
  return (Number.isFinite(minIntervalMinutes) && minIntervalMinutes > 0 ? minIntervalMinutes : DEFAULT_MIN_INTERVAL_MINUTES) * 60 * 1000;
}

/** Dry runs preview only and skip markers are bookkeeping — neither blocks the daily scan. */
export function blocksScheduledScan(run: RecentRunLike): boolean {
  return (run.mode === "scheduled" || run.mode === "manual") && run.status !== "skipped";
}

function isInsidePolicyWindow(run: RecentRunLike, now: Date, minIntervalMinutes: number): boolean {
  if (!run.started_at) return true;
  const startedAt = new Date(run.started_at).getTime();
  if (!Number.isFinite(startedAt)) return true;
  return startedAt >= now.getTime() - intervalMs(minIntervalMinutes) && startedAt <= now.getTime();
}

export function scheduledScanDecision(
  paused: boolean,
  recentRuns: RecentRunLike[],
  now = new Date(),
  minIntervalMinutes = DEFAULT_MIN_INTERVAL_MINUTES,
): ScheduledScanDecision {
  if (paused) return { run: false, skipReason: "paused" };
  const blockingRuns = recentRuns.filter((run) => blocksScheduledScan(run) && isInsidePolicyWindow(run, now, minIntervalMinutes));
  if (blockingRuns.some((run) => run.status === "running")) return { run: false, skipReason: "scan_already_running" };
  if (blockingRuns.length > 0) return { run: false, skipReason: "recent_run" };
  return { run: true };
}

export function nextScheduledScanAt(now: Date, minIntervalMinutes = DEFAULT_MIN_INTERVAL_MINUTES): Date {
  return new Date(now.getTime() + intervalMs(minIntervalMinutes));
}
