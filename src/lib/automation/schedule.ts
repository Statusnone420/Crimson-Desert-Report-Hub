export type RecentRunLike = { mode: string; status: string };

export type ScheduledScanDecision = { run: true } | { run: false; skipReason: "paused" | "recent_run" };

/** Dry runs preview only and skip markers are bookkeeping — neither blocks the daily scan. */
export function blocksScheduledScan(run: RecentRunLike): boolean {
  return (run.mode === "scheduled" || run.mode === "manual") && run.status !== "skipped";
}

export function scheduledScanDecision(paused: boolean, recentRuns: RecentRunLike[]): ScheduledScanDecision {
  if (paused) return { run: false, skipReason: "paused" };
  if (recentRuns.some(blocksScheduledScan)) return { run: false, skipReason: "recent_run" };
  return { run: true };
}

const SCHEDULED_SCAN_UTC_HOUR = 9;

export function nextScheduledScanAt(now: Date): Date {
  const todayAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), SCHEDULED_SCAN_UTC_HOUR));
  if (now.getTime() < todayAt.getTime()) return todayAt;
  return new Date(todayAt.getTime() + 24 * 60 * 60 * 1000);
}
