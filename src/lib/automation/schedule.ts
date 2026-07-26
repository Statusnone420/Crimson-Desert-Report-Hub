export type RecentRunLike = { mode: string; status: string; started_at?: string | null };

export type ScheduledScanDecision =
  | { run: true }
  | { run: false; skipReason: "paused" | "recent_run" | "scan_already_running" };

const DEFAULT_MIN_INTERVAL_MINUTES = 60;
const CRON_JITTER_GRACE_MS = 2 * 60 * 1000;
const PATCH_BURST_WINDOW_MS = 72 * 60 * 60 * 1000;
const PATCH_PUBLICATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type PatchBurstMetadata = {
  // resolveBurstState treats anything except "official" as no burst: a manual
  // override or the hardcoded fallback must never trigger patch-burst cadence.
  source?: "official" | "manual" | "fallback";
  observedAt?: string | null;
  publishedAt?: string | null;
};

function intervalMs(minIntervalMinutes: number): number {
  return (Number.isFinite(minIntervalMinutes) && minIntervalMinutes > 0 ? minIntervalMinutes : DEFAULT_MIN_INTERVAL_MINUTES) * 60 * 1000;
}

function isWithinWindow(value: string | null | undefined, now: Date, windowMs: number): boolean {
  if (!value) return false;
  const valueMs = new Date(value).getTime();
  const nowMs = now.getTime();
  if (!Number.isFinite(valueMs) || !Number.isFinite(nowMs)) return false;
  return valueMs >= nowMs - windowMs && valueMs <= nowMs;
}

export function resolveBurstState(currentPatch: PatchBurstMetadata | null, now: Date): boolean {
  if (!currentPatch || currentPatch.source !== "official") return false;
  if (!isWithinWindow(currentPatch.observedAt, now, PATCH_BURST_WINDOW_MS)) return false;
  return !currentPatch.publishedAt || isWithinWindow(currentPatch.publishedAt, now, PATCH_PUBLICATION_WINDOW_MS);
}

/** Dry runs preview only and skip markers are bookkeeping — neither blocks scheduled policy scans. */
export function blocksScheduledScan(run: RecentRunLike): boolean {
  return (run.mode === "scheduled" || run.mode === "manual") && run.status !== "skipped";
}

function isInsidePolicyWindow(run: RecentRunLike, now: Date, minIntervalMinutes: number, graceMs = 0): boolean {
  if (!run.started_at) return true;
  const startedAt = new Date(run.started_at).getTime();
  if (!Number.isFinite(startedAt)) return true;
  return startedAt >= now.getTime() - Math.max(0, intervalMs(minIntervalMinutes) - graceMs) && startedAt <= now.getTime();
}

export function scheduledScanDecision(
  paused: boolean,
  recentRuns: RecentRunLike[],
  now = new Date(),
  minIntervalMinutes = DEFAULT_MIN_INTERVAL_MINUTES,
): ScheduledScanDecision {
  if (paused) return { run: false, skipReason: "paused" };
  const blockingRuns = recentRuns.filter(blocksScheduledScan);
  if (blockingRuns.some((run) => run.status === "running" && isInsidePolicyWindow(run, now, minIntervalMinutes))) {
    return { run: false, skipReason: "scan_already_running" };
  }
  if (blockingRuns.some((run) => isInsidePolicyWindow(run, now, minIntervalMinutes, CRON_JITTER_GRACE_MS))) {
    return { run: false, skipReason: "recent_run" };
  }
  return { run: true };
}

export function nextScheduledScanAt(now: Date, minIntervalMinutes = DEFAULT_MIN_INTERVAL_MINUTES): Date {
  return new Date(now.getTime() + intervalMs(minIntervalMinutes));
}

export function nextEligibleScheduledScanAt(
  recentRuns: RecentRunLike[],
  now = new Date(),
  minIntervalMinutes = DEFAULT_MIN_INTERVAL_MINUTES,
): Date {
  const latestBlockingStartedAt = recentRuns
    .filter(blocksScheduledScan)
    .map((run) => (run.started_at ? new Date(run.started_at).getTime() : Number.NaN))
    .filter((startedAt) => Number.isFinite(startedAt) && startedAt <= now.getTime())
    .sort((a, b) => b - a)[0];

  if (latestBlockingStartedAt === undefined) return now;
  const eligibleAt = new Date(latestBlockingStartedAt + intervalMs(minIntervalMinutes));
  return eligibleAt > now ? eligibleAt : now;
}
