import "server-only";

import { unstable_cache } from "next/cache";
import { countBy } from "@/lib/aggregates";
import { PUBLIC_DASHBOARD_TAG } from "@/lib/cacheTags";
import { createServiceClient, hasSupabaseServiceConfig } from "@/lib/supabase";

/**
 * Aggregate-only scanner observatory data for the public front page.
 *
 * Full-transparency boundary (user decision 2026-07-17): volume, cadence, model
 * calls, spend, and rejection-reason counts are public — but ONLY as aggregates.
 * No title, URL, snippet, or per-candidate row ever leaves this module.
 */

export type ObservatoryDailyPoint = {
  date: string;
  reviewed: number;
  kept: number;
  reobserved: number;
  llmCalls: number;
};

export type ObservatoryDomain = {
  domain: string;
  kept: number;
  filtered: number;
  totalSeen: number;
};

export type ObservatoryPatch = {
  version: string;
  publishedAt: string | null;
  isCurrent: boolean;
  claimedFixes: number;
  fixCategories: { category: string | null; count: number }[];
  /**
   * Confirmations are one mutable row per (cluster, patch family, voter) whose
   * patch_version is overwritten when a player re-taps on a later hotfix. This
   * is each player's CURRENT verdict attributed to their latest tap — never an
   * immutable per-patch history. UI copy must say "current", not "confirmed on".
   */
  currentFixedVerdicts: number;
};

export type ObservatoryData = {
  totals: {
    scans: number;
    reviewed: number;
    kept: number;
    tracked: number;
    reobservations: number;
    filtered: number;
    filterRatePct: number;
    llmCalls: number;
    costUsd: number;
    firstRunAt: string | null;
    scansPerDay: number;
  };
  daily: ObservatoryDailyPoint[];
  /**
   * Sourced from the rescue-memory table, which expires rows after ~7 days —
   * this is a rolling recent window, never an all-time total. UI copy must
   * label it as recent; durable filtered totals come from `totals.filtered`.
   */
  rejectionReasons: { reason: string; label: string; count: number }[];
  domains: ObservatoryDomain[];
  signalCategories: Record<string, number>;
  confidenceMix: { high: number; medium: number; low: number };
  patches: ObservatoryPatch[];
};

export const REJECTION_REASON_LABELS: Record<string, string> = {
  source_not_issue_report: "Not an issue report",
  category_other: "Off-category chatter",
  wrong_patch: "Wrong patch window",
};

function rejectionReasonLabel(reason: string): string {
  return REJECTION_REASON_LABELS[reason] ?? reason.replaceAll("_", " ");
}

type RunRow = {
  started_at: string;
  status: string;
  mode: string;
  intent: string | null;
  search_queries_used: number | null;
  search_results_seen: number | null;
  reddit_posts_seen: number | null;
  signals_inserted: number | null;
  signals_reobserved: number | null;
  funnel: { candidatesSeen: number | null } | null;
  llm_calls_used: number | null;
  estimated_cost_usd: number | null;
};

/**
 * Admin rescue ledger rows record one candidate in the funnel even when the
 * rescue fails, while both source counters stay zero. Counting those rows as
 * intake inflates scanner count/cadence and can show a daily intake event even
 * though no source was scanned. Query count alone cannot discriminate: a
 * normal manual rescue-candidate scan can have zero paid-search queries while
 * still ingesting Reddit posts. Spend and model-call totals still count every
 * run.
 */
export function isIntakeRun(run: RunRow): boolean {
  return !(
    run.mode === "manual" &&
    run.intent === "rescue_candidate" &&
    (run.search_results_seen ?? 0) === 0 &&
    (run.reddit_posts_seen ?? 0) === 0 &&
    run.funnel?.candidatesSeen === 1
  );
}

const DAILY_WINDOW_DAYS = 30;

function emptyObservatoryData(): ObservatoryData {
  return {
    totals: {
      scans: 0,
      reviewed: 0,
      kept: 0,
      tracked: 0,
      reobservations: 0,
      filtered: 0,
      filterRatePct: 0,
      llmCalls: 0,
      costUsd: 0,
      firstRunAt: null,
      scansPerDay: 0,
    },
    daily: [],
    rejectionReasons: [],
    domains: [],
    signalCategories: {},
    confidenceMix: { high: 0, medium: 0, low: 0 },
    patches: [],
  };
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

export function buildObservatoryDaily(rows: RunRow[], today: Date): ObservatoryDailyPoint[] {
  const byDay: Record<string, ObservatoryDailyPoint> = {};
  for (const row of rows) {
    const key = dayKey(row.started_at);
    const point = (byDay[key] ??= { date: key, reviewed: 0, kept: 0, reobserved: 0, llmCalls: 0 });
    point.reviewed += (row.search_results_seen ?? 0) + (row.reddit_posts_seen ?? 0);
    point.llmCalls += row.llm_calls_used ?? 0;
    // Failed runs can carry phantom insert counts from screening that never
    // persisted — same rule the scanner tab applies.
    if (row.status !== "failed") {
      point.kept += row.signals_inserted ?? 0;
      point.reobserved += row.signals_reobserved ?? 0;
    }
  }
  const series: ObservatoryDailyPoint[] = [];
  for (let i = DAILY_WINDOW_DAYS - 1; i >= 0; i--) {
    const key = dayKey(new Date(today.getTime() - i * 24 * 60 * 60 * 1000).toISOString());
    series.push(byDay[key] ?? { date: key, reviewed: 0, kept: 0, reobserved: 0, llmCalls: 0 });
  }
  return series;
}

const PAGE_SIZE = 1000;

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

/** Exhaustive paged read: totals labeled "all patches" must never silently truncate. */
async function fetchAllRows<T>(label: string, page: (from: number, to: number) => PromiseLike<PageResult<T>>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${label} read failed: ${error.message}`);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
}

type SignalRow = {
  source_domain: string | null;
  category: string;
  confidence: "low" | "medium" | "high";
  seen_count: number | null;
};

async function getObservatoryDataUncached(): Promise<ObservatoryData> {
  if (!hasSupabaseServiceConfig()) return emptyObservatoryData();

  try {
    const supabase = createServiceClient();

    const [runs, rejected, signals, notesRes, fixes, confirmations] = await Promise.all([
      fetchAllRows<RunRow>("automation runs", (from, to) =>
        supabase
          .from("automation_runs")
          .select(
            "started_at, status, mode, intent, search_queries_used, search_results_seen, reddit_posts_seen, signals_inserted, signals_reobserved, funnel, llm_calls_used, estimated_cost_usd",
          )
          .neq("mode", "dry_run")
          .in("status", ["success", "partial", "failed"])
          .order("started_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      ),
      fetchAllRows<{ reason: string; source_domain: string | null }>("rejected candidates", (from, to) =>
        supabase
          .from("automation_rejected_candidates")
          .select("reason, source_domain")
          .order("id", { ascending: true })
          .range(from, to),
      ),
      fetchAllRows<SignalRow>("source signals", (from, to) =>
        supabase
          .from("source_signals")
          .select("source_domain, category, confidence, seen_count")
          .order("id", { ascending: true })
          .range(from, to),
      ),
      supabase.from("official_patch_notes").select("board_no, patch_version, published_at, is_current"),
      fetchAllRows<{ board_no: string; category: string | null }>("claimed fixes", (from, to) =>
        supabase
          .from("official_patch_claimed_fixes")
          .select("board_no, category")
          .order("id", { ascending: true })
          .range(from, to),
      ),
      fetchAllRows<{ patch_version: string | null; kind: string }>("confirmations", (from, to) =>
        supabase
          .from("issue_confirmations")
          .select("patch_version, kind")
          .order("id", { ascending: true })
          .range(from, to),
      ),
    ]);

    const notes = (notesRes.data ?? []) as {
      board_no: string;
      patch_version: string;
      published_at: string | null;
      is_current: boolean;
    }[];

    const intakeRuns = runs.filter(isIntakeRun);
    const reviewed = intakeRuns.reduce(
      (sum, run) => sum + (run.search_results_seen ?? 0) + (run.reddit_posts_seen ?? 0),
      0,
    );
    // Failed runs can carry phantom insert counts from screening that never persisted.
    const kept = intakeRuns.reduce((sum, run) => (run.status === "failed" ? sum : sum + (run.signals_inserted ?? 0)), 0);
    // Re-encounters of already-tracked signals pass screening too — they land in
    // signals_reobserved instead of signals_inserted. They belong on the surviving
    // side of the funnel, or repeat-only runs would read as 100% filtered.
    const survivedRepeats = intakeRuns.reduce(
      (sum, run) => (run.status === "failed" ? sum : sum + (run.signals_reobserved ?? 0)),
      0,
    );
    const llmCalls = runs.reduce((sum, run) => sum + (run.llm_calls_used ?? 0), 0);
    const costUsd = runs.reduce((sum, run) => sum + (run.estimated_cost_usd ?? 0), 0);
    const tracked = signals.length;
    // Durable all-time filtered total: derived from runs (which never expire),
    // not from the rescue table (whose rows are deleted after ~7 days).
    const filtered = Math.max(0, reviewed - kept - survivedRepeats);
    // seen_count includes the first sighting; only repeats count as re-observations.
    const reobservations = signals.reduce((sum, signal) => sum + Math.max(0, (signal.seen_count ?? 0) - 1), 0);
    const firstRunAt = intakeRuns[0]?.started_at ?? null;
    const activeDays = firstRunAt
      ? Math.max(1, Math.ceil((Date.now() - new Date(firstRunAt).getTime()) / (24 * 60 * 60 * 1000)))
      : 1;

    const reasonCounts = countBy(rejected, (row) => row.reason);
    const rejectionReasons = Object.entries(reasonCounts)
      .map(([reason, count]) => ({ reason, label: rejectionReasonLabel(reason), count }))
      .sort((a, b) => b.count - a.count);

    const keptByDomain = countBy(signals, (row) => row.source_domain ?? "unknown");
    const filteredByDomain = countBy(rejected, (row) => row.source_domain ?? "unknown");
    const seenByDomain: Record<string, number> = {};
    for (const signal of signals) {
      const key = signal.source_domain ?? "unknown";
      seenByDomain[key] = (seenByDomain[key] ?? 0) + (signal.seen_count ?? 0);
    }
    const domains = [...new Set([...Object.keys(keptByDomain), ...Object.keys(filteredByDomain)])]
      .map((domain) => ({
        domain,
        kept: keptByDomain[domain] ?? 0,
        filtered: filteredByDomain[domain] ?? 0,
        totalSeen: seenByDomain[domain] ?? 0,
      }))
      .sort((a, b) => b.kept + b.filtered - (a.kept + a.filtered));

    const confidenceCounts = countBy(signals, (row) => row.confidence);
    const fixesByBoard: Record<string, { category: string | null }[]> = {};
    for (const fix of fixes) {
      (fixesByBoard[fix.board_no] ??= []).push({ category: fix.category });
    }
    const confirmedByPatch = countBy(
      confirmations.filter((row) => row.kind === "fixed_for_me"),
      (row) => row.patch_version,
    );

    // A manual current-patch override leaves a non-current note row behind and
    // the next official sync inserts another row for the same version — collapse
    // to one row per version (current wins, then latest published) so the ledger
    // never lists a patch twice or double-counts its verdicts.
    const noteByVersion = new Map<string, (typeof notes)[number]>();
    for (const note of notes) {
      const existing = noteByVersion.get(note.patch_version);
      const preferNote =
        !existing ||
        (note.is_current && !existing.is_current) ||
        (!note.is_current &&
          !existing.is_current &&
          new Date(note.published_at ?? 0).getTime() > new Date(existing.published_at ?? 0).getTime());
      if (preferNote) noteByVersion.set(note.patch_version, note);
    }

    const patches = [...noteByVersion.values()]
      .sort((a, b) => new Date(a.published_at ?? 0).getTime() - new Date(b.published_at ?? 0).getTime())
      .map((note) => {
        const patchFixes = fixesByBoard[note.board_no] ?? [];
        const categoryCounts = countBy(patchFixes, (fix) => fix.category ?? "general");
        return {
          version: note.patch_version,
          publishedAt: note.published_at,
          isCurrent: note.is_current,
          claimedFixes: patchFixes.length,
          fixCategories: Object.entries(categoryCounts)
            .map(([category, count]) => ({ category: category === "general" ? null : category, count }))
            .sort((a, b) => b.count - a.count),
          currentFixedVerdicts: confirmedByPatch[note.patch_version] ?? 0,
        };
      });

    return {
      totals: {
        scans: intakeRuns.length,
        reviewed,
        kept,
        tracked,
        reobservations,
        filtered,
        filterRatePct: reviewed > 0 ? Math.round((filtered / reviewed) * 100) : 0,
        llmCalls,
        costUsd,
        firstRunAt,
        scansPerDay: Math.round((intakeRuns.length / activeDays) * 10) / 10,
      },
      daily: buildObservatoryDaily(intakeRuns, new Date()),
      rejectionReasons,
      domains,
      signalCategories: countBy(signals, (row) => row.category),
      confidenceMix: {
        high: confidenceCounts.high ?? 0,
        medium: confidenceCounts.medium ?? 0,
        low: confidenceCounts.low ?? 0,
      },
      patches,
    };
  } catch {
    return emptyObservatoryData();
  }
}

export const getObservatoryData = unstable_cache(getObservatoryDataUncached, ["public-observatory-data"], {
  revalidate: 300,
  tags: [PUBLIC_DASHBOARD_TAG],
});
