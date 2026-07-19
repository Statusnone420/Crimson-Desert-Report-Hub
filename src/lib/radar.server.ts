import "server-only";

import { unstable_cache } from "next/cache";
import { PUBLIC_DASHBOARD_TAG } from "@/lib/cacheTags";
import { CATEGORIES, PLATFORMS } from "@/lib/constants";
import {
  evaluateCurrentPatchEligibility,
  type CurrentPatchEligibilityReason,
} from "@/lib/automation/eligibility";
import { nextEligibleScheduledScanAt } from "@/lib/automation/schedule";
import { getAutomationControlState, type AutomationSettingsClient } from "@/lib/automation/settings";
import { getCurrentPatchMetadata } from "@/lib/officialPatch.server";
import { createServiceClient, hasSupabaseServiceConfig } from "@/lib/supabase";

/**
 * Patch Radar read model — the scanner-intelligence aggregate for public
 * surfaces and the operator desk.
 *
 * Privacy contract (same boundary as getPublicScannerData / telemetry.server):
 * signal title, summary, URL, and domain are read server-side ONLY to evaluate
 * current-patch eligibility; none of them appear in PatchRadarData. Everything
 * returned is a count, an enum bucket, a day key, or a scanner timestamp.
 * Scanner first/last-seen times are scanner observations — never presented as
 * source publication time.
 */

export type RadarSignalRow = {
  cluster_id: string | null;
  category: string;
  confidence: "low" | "medium" | "high";
  public_status: "private" | "public" | "hidden";
  first_seen_at: string | null;
  last_seen_at: string | null;
  observed_at: string;
  seen_count: number | null;
  source_published_at: string | null;
  /** Read for eligibility + platform-enum matching only; never returned. */
  title: string | null;
  summary: string;
  source_url: string;
  extracted_facts: { platform?: unknown } | null;
};

export type RadarRunRow = {
  started_at: string;
  status: string;
  mode: string;
  intent: string | null;
  search_queries_used: number | null;
  search_results_seen: number | null;
  reddit_posts_seen: number | null;
  signals_inserted: number | null;
  signals_reobserved: number | null;
};

export type RadarDailyPoint = { day: string; newLeads: number; reobservations: number };

export type RadarRecurrencePoint = {
  /** Whole days since the scanner first saw this lead. */
  daysTracked: number;
  seenCount: number;
  isPublic: boolean;
  category: string;
};

export type PatchRadarData = {
  connected: boolean;
  patch: { version: string; publishedAt: string | null };
  window: {
    newLeads24h: number;
    newLeads7d: number;
    reobservations24h: number;
    reobservations7d: number;
  };
  /** Distinct clusters holding at least one tracked (non-hidden) lead. */
  activeLeadClusters: number;
  recurring: { recurringLeads: number; trackedLeads: number; maxSeenCount: number };
  categories: { category: string; tracked: number; new7d: number }[];
  /** Only strict PLATFORMS enum values extracted from leads; empty when none match. */
  platforms: { platform: string; tracked: number }[];
  confidenceMix: { high: number; medium: number; low: number };
  funnel7d: { reviewed: number; filtered: number; kept: number; reobserved: number };
  daily: RadarDailyPoint[];
  recurrence: RadarRecurrencePoint[];
  health: {
    lastScanAt: string | null;
    lastScanStatus: string | null;
    runs7d: { succeeded: number; skipped: number; failed: number };
    paused: boolean;
    cadenceMinutes: number;
    nextEligibleAt: string | null;
  };
  /** Source-date observability: how many tracked leads carry a real publication date. */
  dateCoverage: { withSourceDate: number; tracked: number };
  eligibility: Record<CurrentPatchEligibilityReason, number>;
  evidence: { reports: number; taps: number };
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DAILY_WINDOW_DAYS = 30;
const RECURRENCE_POINT_CAP = 200;

function emptyEligibility(): Record<CurrentPatchEligibilityReason, number> {
  return {
    current_patch: 0,
    fresh_source: 0,
    fresh_language: 0,
    unknown_source_freshness: 0,
    wrong_patch: 0,
    stale_source: 0,
  };
}

export function emptyPatchRadarData(patch: { version: string; publishedAt: string | null }): PatchRadarData {
  return {
    connected: false,
    patch,
    window: { newLeads24h: 0, newLeads7d: 0, reobservations24h: 0, reobservations7d: 0 },
    activeLeadClusters: 0,
    recurring: { recurringLeads: 0, trackedLeads: 0, maxSeenCount: 0 },
    categories: [],
    platforms: [],
    confidenceMix: { high: 0, medium: 0, low: 0 },
    funnel7d: { reviewed: 0, filtered: 0, kept: 0, reobserved: 0 },
    daily: [],
    recurrence: [],
    health: {
      lastScanAt: null,
      lastScanStatus: null,
      runs7d: { succeeded: 0, skipped: 0, failed: 0 },
      paused: false,
      cadenceMinutes: 60,
      nextEligibleAt: null,
    },
    dateCoverage: { withSourceDate: 0, tracked: 0 },
    eligibility: emptyEligibility(),
    evidence: { reports: 0, taps: 0 },
  };
}

/**
 * Same intake rule as daily_signal_rollup and getPublicScannerData: an admin
 * rescue re-screens one stored candidate without searching, so counting it
 * would inflate intake.
 */
function isIntakeRun(run: RadarRunRow): boolean {
  return !(run.mode === "manual" && run.intent === "rescue_candidate" && (run.search_queries_used ?? 0) === 0);
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

const PLATFORM_SET = new Set<string>(PLATFORMS);
const CATEGORY_SET = new Set<string>(CATEGORIES);

/** A tracked lead is a retained, non-hidden signal — the radar's working set. */
function isTrackedLead(row: RadarSignalRow): boolean {
  return row.public_status !== "hidden";
}

export function composePatchRadarData(input: {
  signals: RadarSignalRow[];
  runs: RadarRunRow[];
  patch: { version: string; publishedAt: string | null };
  paused: boolean;
  cadenceMinutes: number;
  evidence: { reports: number; taps: number };
  now?: Date;
}): PatchRadarData {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const dayAgo = nowMs - DAY_MS;
  const weekAgo = nowMs - 7 * DAY_MS;

  const tracked = input.signals.filter(isTrackedLead);
  const intakeRuns = input.runs.filter(isIntakeRun);

  // --- Windows ---
  const firstSeenMs = (row: RadarSignalRow) => parseTime(row.first_seen_at) ?? parseTime(row.observed_at) ?? 0;
  const newLeads24h = tracked.filter((row) => firstSeenMs(row) >= dayAgo).length;
  const newLeads7d = tracked.filter((row) => firstSeenMs(row) >= weekAgo).length;
  // Re-observations come from per-run counters: seen_count on a signal cannot
  // be windowed by time, but signals_reobserved is recorded per run.
  const reobsInWindow = (cutoff: number) =>
    intakeRuns
      .filter((run) => run.status !== "failed" && (parseTime(run.started_at) ?? 0) >= cutoff)
      .reduce((sum, run) => sum + (run.signals_reobserved ?? 0), 0);
  const reobservations24h = reobsInWindow(dayAgo);
  const reobservations7d = reobsInWindow(weekAgo);

  // --- Recurrence ---
  const trackedLeads = tracked.length;
  const recurringLeads = tracked.filter((row) => (row.seen_count ?? 1) > 1).length;
  const maxSeenCount = tracked.reduce((max, row) => Math.max(max, row.seen_count ?? 1), 0);
  const recurrence: RadarRecurrencePoint[] = tracked.slice(0, RECURRENCE_POINT_CAP).map((row) => ({
    daysTracked: Math.max(0, Math.floor((nowMs - firstSeenMs(row)) / DAY_MS)),
    seenCount: Math.max(1, row.seen_count ?? 1),
    isPublic: row.public_status === "public",
    category: CATEGORY_SET.has(row.category) ? row.category : "other",
  }));

  // --- Buckets ---
  const categoryTotals = new Map<string, { tracked: number; new7d: number }>();
  for (const row of tracked) {
    const key = CATEGORY_SET.has(row.category) ? row.category : "other";
    const bucket = categoryTotals.get(key) ?? { tracked: 0, new7d: 0 };
    bucket.tracked += 1;
    if (firstSeenMs(row) >= weekAgo) bucket.new7d += 1;
    categoryTotals.set(key, bucket);
  }
  const categories = [...categoryTotals.entries()]
    .map(([category, counts]) => ({ category, ...counts }))
    .sort((a, b) => b.tracked - a.tracked);

  const platformTotals = new Map<string, number>();
  for (const row of tracked) {
    const platform = row.extracted_facts?.platform;
    // Only strict enum values may become public aggregate keys — an
    // LLM-extracted free-text platform must never leak into a bucket name.
    if (typeof platform === "string" && PLATFORM_SET.has(platform)) {
      platformTotals.set(platform, (platformTotals.get(platform) ?? 0) + 1);
    }
  }
  const platforms = [...platformTotals.entries()]
    .map(([platform, count]) => ({ platform, tracked: count }))
    .sort((a, b) => b.tracked - a.tracked);

  const confidenceMix = { high: 0, medium: 0, low: 0 };
  for (const row of tracked) confidenceMix[row.confidence] += 1;

  // --- Funnel (7d) ---
  const weekRuns = intakeRuns.filter((run) => (parseTime(run.started_at) ?? 0) >= weekAgo);
  const reviewed = weekRuns.reduce(
    (sum, run) => sum + (run.search_results_seen ?? 0) + (run.reddit_posts_seen ?? 0),
    0,
  );
  const kept = weekRuns.reduce(
    (sum, run) => (run.status === "failed" ? sum : sum + (run.signals_inserted ?? 0)),
    0,
  );
  const reobserved = weekRuns.reduce(
    (sum, run) => (run.status === "failed" ? sum : sum + (run.signals_reobserved ?? 0)),
    0,
  );
  const funnel7d = {
    reviewed,
    filtered: Math.max(0, reviewed - kept - reobserved),
    kept,
    reobserved,
  };

  // --- Daily series (since patch publish, capped at DAILY_WINDOW_DAYS) ---
  const publishedMs = parseTime(input.patch.publishedAt);
  const windowStartMs = Math.max(
    nowMs - (DAILY_WINDOW_DAYS - 1) * DAY_MS,
    publishedMs ?? nowMs - (DAILY_WINDOW_DAYS - 1) * DAY_MS,
  );
  const byDay = new Map<string, { newLeads: number; reobservations: number }>();
  for (const run of intakeRuns) {
    if (run.status === "failed") continue;
    const startedMs = parseTime(run.started_at);
    if (startedMs === null || startedMs < windowStartMs) continue;
    const key = dayKey(run.started_at);
    const point = byDay.get(key) ?? { newLeads: 0, reobservations: 0 };
    point.newLeads += run.signals_inserted ?? 0;
    point.reobservations += run.signals_reobserved ?? 0;
    byDay.set(key, point);
  }
  const daily: RadarDailyPoint[] = [];
  for (let ms = windowStartMs; dayKey(new Date(ms).toISOString()) <= dayKey(now.toISOString()); ms += DAY_MS) {
    const key = dayKey(new Date(ms).toISOString());
    daily.push({ day: key, ...(byDay.get(key) ?? { newLeads: 0, reobservations: 0 }) });
  }

  // --- Health ---
  const realRuns = input.runs
    .filter((run) => run.mode !== "dry_run")
    .sort((a, b) => (parseTime(b.started_at) ?? 0) - (parseTime(a.started_at) ?? 0));
  const lastTerminal = realRuns.find((run) => ["success", "partial", "failed"].includes(run.status)) ?? null;
  const weekReal = realRuns.filter((run) => (parseTime(run.started_at) ?? 0) >= weekAgo);
  const runs7d = {
    succeeded: weekReal.filter((run) => run.status === "success" || run.status === "partial").length,
    skipped: weekReal.filter((run) => run.status === "skipped").length,
    failed: weekReal.filter((run) => run.status === "failed").length,
  };
  const nextEligible = input.paused
    ? null
    : nextEligibleScheduledScanAt(input.runs, now, input.cadenceMinutes).toISOString();

  // --- Source-date observability ---
  const withSourceDate = tracked.filter((row) => parseTime(row.source_published_at) !== null).length;
  const eligibility = emptyEligibility();
  for (const row of tracked) {
    const verdict = evaluateCurrentPatchEligibility(
      { title: row.title, summary: row.summary, sourcePublishedAt: row.source_published_at },
      input.patch,
    );
    eligibility[verdict.reason] += 1;
  }

  // --- Active lead clusters ---
  const activeLeadClusters = new Set(
    tracked.filter((row) => row.cluster_id !== null).map((row) => row.cluster_id as string),
  ).size;

  return {
    connected: true,
    patch: input.patch,
    window: { newLeads24h, newLeads7d, reobservations24h, reobservations7d },
    activeLeadClusters,
    recurring: { recurringLeads, trackedLeads, maxSeenCount },
    categories,
    platforms,
    confidenceMix,
    funnel7d,
    daily,
    recurrence,
    health: {
      lastScanAt: lastTerminal?.started_at ?? null,
      lastScanStatus: lastTerminal?.status ?? null,
      runs7d,
      paused: input.paused,
      cadenceMinutes: input.cadenceMinutes,
      nextEligibleAt: nextEligible,
    },
    dateCoverage: { withSourceDate, tracked: trackedLeads },
    eligibility,
    evidence: input.evidence,
  };
}

/** Narrow patch metadata to exactly the declared shape so no extra fields ride along. */
async function radarPatchContext(
  supabase?: ReturnType<typeof createServiceClient>,
): Promise<{ version: string; publishedAt: string | null }> {
  const patch = await getCurrentPatchMetadata(supabase);
  return { version: patch.version, publishedAt: patch.publishedAt };
}

async function getPatchRadarDataUncached(): Promise<PatchRadarData> {
  if (!hasSupabaseServiceConfig()) {
    return emptyPatchRadarData(await radarPatchContext());
  }
  try {
    const supabase = createServiceClient();
    const currentPatch = await radarPatchContext(supabase);

    const [signalsRes, runsRes, control, reportsRes, tapsRes] = await Promise.all([
      supabase
        .from("source_signals")
        .select(
          "cluster_id, category, confidence, public_status, first_seen_at, last_seen_at, observed_at, seen_count, source_published_at, title, summary, source_url, extracted_facts",
        ),
      supabase
        .from("automation_runs")
        .select(
          "started_at, status, mode, intent, search_queries_used, search_results_seen, reddit_posts_seen, signals_inserted, signals_reobserved",
        )
        .gte("started_at", new Date(Date.now() - DAILY_WINDOW_DAYS * DAY_MS).toISOString())
        .order("started_at", { ascending: false }),
      getAutomationControlState(supabase as unknown as AutomationSettingsClient),
      supabase
        .from("bug_reports")
        .select("id", { count: "exact", head: true })
        .eq("moderation_status", "approved"),
      supabase.from("issue_confirmations").select("id", { count: "exact", head: true }),
    ]);
    if (signalsRes.error || runsRes.error) return emptyPatchRadarData(currentPatch);

    return composePatchRadarData({
      signals: (signalsRes.data ?? []) as RadarSignalRow[],
      runs: (runsRes.data ?? []) as RadarRunRow[],
      patch: currentPatch,
      paused: control.paused,
      cadenceMinutes: control.minIntervalMinutes,
      evidence: { reports: reportsRes.count ?? 0, taps: tapsRes.count ?? 0 },
    });
  } catch {
    return emptyPatchRadarData(await radarPatchContext());
  }
}

export const getPatchRadarData = unstable_cache(getPatchRadarDataUncached, ["patch-radar-data"], {
  revalidate: 300,
  tags: [PUBLIC_DASHBOARD_TAG],
});
