import "server-only";

import { unstable_cache } from "next/cache";
import { buildDailySeries, countBy, rankClusters } from "@/lib/aggregates";
import { evaluateCurrentPatchEligibility } from "@/lib/automation/eligibility";
import { getAutomationControlState, type AutomationSettingsClient } from "@/lib/automation/settings";
import { PUBLIC_DASHBOARD_TAG, PUBLIC_ISSUES_TAG } from "@/lib/cacheTags";
import { getClaimedFixesForCurrentPatch, getCurrentPatchMetadata } from "@/lib/officialPatch.server";
import { createServiceClient, hasSupabaseServiceConfig } from "@/lib/supabase";

export type ClusterRow = {
  id: string;
  slug: string;
  title: string;
  category: string;
  description: string;
  fix_status: string;
  confidence: string;
  is_public: boolean;
};

type DashboardReportRow = {
  category: string | null;
  platform: string | null;
  created_at: string;
  cluster_id: string | null;
  hardware_specs?: string | null;
};

export type SignalRow = {
  id: string;
  cluster_id: string | null;
  source: string;
  source_url: string;
  title?: string | null;
  summary: string;
  category: string;
  confidence: "low" | "medium" | "high";
  observed_at: string;
  source_published_at?: string | null;
  public_status: "private" | "public" | "hidden";
};

export type AutomationRunRow = {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  mode: string;
  estimated_cost_usd: number;
  search_queries_used: number;
  llm_calls_used: number;
  signals_inserted: number;
  signals_deduped: number;
  clusters_promoted: number;
  intent: string | null;
  search_results_seen: number;
  reddit_posts_seen: number;
  signals_reobserved: number;
  stale_signals_hidden: number;
  candidates_rescued: number;
  skips: string[];
  errors: string[];
  funnel: Record<string, number> | null;
};

export type RejectedCandidateRow = {
  id: string;
  title: string;
  url: string;
  source_domain: string | null;
  source_published_at: string | null;
  reason: string;
  created_at: string;
  rescued_at: string | null;
};

export type PublicAutomationRunRow = {
  started_at: string;
  status: string;
  mode: string;
  search_queries_used: number;
  llm_calls_used: number;
  signals_inserted: number;
  clusters_promoted: number;
  search_results_seen: number;
  signals_reobserved: number;
  stale_signals_hidden: number;
  candidates_rescued: number;
  finished_at: string | null;
};

export type PublicScanMeta = {
  finishedAt: string | null;
  status: string;
  searchResultsSeen: number;
} | null;

export type AdminSignalRow = SignalRow & {
  title: string | null;
  source_type: string | null;
  source_domain: string | null;
  source_published_at: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  seen_count: number | null;
};

type RelatedReport<T> = T | T[] | null;

type ExcerptRow = {
  excerpt_text: string;
  created_at: string;
  bug_reports: RelatedReport<{ cluster_id: string | null; platform: string | null }>;
};

export type VerifiedReportClusterRow = {
  report_id: string;
  bug_reports: RelatedReport<{ cluster_id: string | null }>;
};

function countClusterIds(rows: { cluster_id: string | null }[]): Record<string, number> {
  return countBy(rows, (row) => row.cluster_id);
}

function filterPublicCurrentPatchSignals<T extends SignalRow>(
  rows: T[],
  currentPatch: { version: string; publishedAt: string | null },
): T[] {
  return rows.filter((row) =>
    evaluateCurrentPatchEligibility(
      { title: row.title ?? null, summary: row.summary, sourcePublishedAt: row.source_published_at ?? null },
      currentPatch,
    ).canPublish,
  );
}

/**
 * Count private (not-yet-independent) signals per cluster for public pages.
 * ONLY selects cluster_id — never select private summaries/urls onto a public page.
 */
async function getCandidateSignalCountsByCluster(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<Record<string, number>> {
  const { data } = await supabase.from("source_signals").select("cluster_id").eq("public_status", "private");
  return countClusterIds((data ?? []) as { cluster_id: string | null }[]);
}

function relatedReport<T>(value: RelatedReport<T>): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function excerptClusterId(excerpt: VerifiedReportClusterRow): string | null {
  const report = relatedReport(excerpt.bug_reports);
  return report?.cluster_id ?? null;
}

export function countDistinctVerifiedReportsByCluster(rows: VerifiedReportClusterRow[]): Record<string, number> {
  const seen = new Set<string>();
  const clusterRows: { cluster_id: string | null }[] = [];
  for (const row of rows) {
    if (seen.has(row.report_id)) continue;
    seen.add(row.report_id);
    const clusterId = excerptClusterId(row);
    if (clusterId) clusterRows.push({ cluster_id: clusterId });
  }
  return countClusterIds(clusterRows);
}

const GPU_PATTERN = /\b(rtx|gtx|rx|arc)\s*-?\s*(\d{3,4})\s*(ti|super|xt|xtx|gre)?\b/gi;

function countGpus(rows: DashboardReportRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (!row.hardware_specs) continue;
    const seen = new Set<string>();
    for (const match of row.hardware_specs.matchAll(GPU_PATTERN)) {
      const suffix = match[3] ? ` ${match[3].toUpperCase()}` : "";
      const label = `${match[1].toUpperCase()} ${match[2]}${suffix}`;
      if (seen.has(label)) continue;
      seen.add(label);
      counts[label] = (counts[label] ?? 0) + 1;
    }
  }
  return counts;
}

async function getDashboardDataUncached() {
  if (!hasSupabaseServiceConfig()) {
    return {
      total: 0,
      communitySignals: 0,
      directReports: 0,
      verifiedReports: 0,
      weekDelta: 0,
      byCategory: {},
      signalByCategory: {},
      platforms: {},
      gpus: {},
      series: buildDailySeries([], 30, new Date()),
      topClusters: [],
      pendingCount: 0,
      latestReportAt: null,
      scanner: { paused: false, updatedAt: null },
      latestAutomationRun: null,
      currentPatch: await getCurrentPatchMetadata(),
      claimedFixes: [],
    };
  }

  const supabase = createServiceClient();

  const { data: reports } = await supabase
    .from("bug_reports")
    .select("category, platform, created_at, cluster_id, hardware_specs")
    .eq("moderation_status", "approved");
  const rows = (reports ?? []) as DashboardReportRow[];

  const { data: clusterData } = await supabase
    .from("issue_clusters")
    .select("id, slug, title, category, description, fix_status, confidence, is_public")
    .eq("is_public", true);

  const { data: signals } = await supabase
    .from("source_signals")
    .select("id, cluster_id, source, source_url, title, summary, category, confidence, observed_at, source_published_at, public_status")
    .eq("public_status", "public");
  const rawSignalRows = (signals ?? []) as SignalRow[];

  const { data: verified } = await supabase
    .from("approved_excerpts")
    .select("report_id, bug_reports(cluster_id)")
    .limit(1000);
  const verifiedRows = (verified ?? []) as VerifiedReportClusterRow[];

  const { count: pendingCount } = await supabase
    .from("bug_reports")
    .select("id", { count: "exact", head: true })
    .eq("moderation_status", "pending");

  const { data: latest } = await supabase
    .from("bug_reports")
    .select("created_at")
    .in("moderation_status", ["approved", "pending"])
    .order("created_at", { ascending: false })
    .limit(1);

  const [scanner, latestAutomation, currentPatch, claimedFixes, candidateSignalCounts] = await Promise.all([
    getAutomationControlState(supabase as unknown as AutomationSettingsClient),
    supabase
      .from("automation_runs")
      .select(
        "started_at, status, mode, search_queries_used, llm_calls_used, signals_inserted, clusters_promoted, search_results_seen, signals_reobserved, stale_signals_hidden, candidates_rescued, finished_at",
      )
      .neq("mode", "dry_run")
      .in("status", ["success", "partial", "failed"])
      .order("started_at", { ascending: false })
      .limit(1),
    getCurrentPatchMetadata(supabase),
    getClaimedFixesForCurrentPatch(supabase),
    getCandidateSignalCountsByCluster(supabase),
  ]);
  const signalRows = filterPublicCurrentPatchSignals(rawSignalRows, currentPatch);

  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const directByCluster = countClusterIds(rows);
  const signalByCluster = countClusterIds(signalRows);
  const verifiedByCluster = countDistinctVerifiedReportsByCluster(verifiedRows);
  const verifiedReportCount = new Set(verifiedRows.map((row) => row.report_id)).size;
  const topClusters = rankClusters((clusterData ?? []) as ClusterRow[], rows)
    .map((cluster) => {
      const signalCount = signalByCluster[cluster.id] ?? 0;
      const directReportCount = directByCluster[cluster.id] ?? 0;
      const verifiedReportCount = verifiedByCluster[cluster.id] ?? 0;
      const candidateSignalCount = candidateSignalCounts[cluster.id] ?? 0;
      return {
        ...cluster,
        count: directReportCount,
        signalCount,
        directReportCount,
        verifiedReportCount,
        candidateSignalCount,
        strengthScore: signalCount + directReportCount * 3,
      };
    })
    .sort((a, b) => b.strengthScore - a.strengthScore);

  return {
    total: rows.length,
    communitySignals: signalRows.length,
    directReports: rows.length,
    verifiedReports: verifiedReportCount,
    weekDelta: rows.filter((row) => new Date(row.created_at).getTime() > weekAgo).length,
    byCategory: countBy(rows, (row) => row.category),
    signalByCategory: countBy(signalRows, (row) => row.category),
    platforms: countBy(rows, (row) => row.platform),
    gpus: countGpus(rows),
    series: buildDailySeries(rows, 30, new Date()),
    topClusters,
    pendingCount: pendingCount ?? 0,
    latestReportAt: latest?.[0]?.created_at ?? null,
    scanner,
    latestAutomationRun: ((latestAutomation.data ?? []) as PublicAutomationRunRow[])[0] ?? null,
    currentPatch,
    claimedFixes,
  };
}

export const getDashboardData = unstable_cache(getDashboardDataUncached, ["dashboard-data"], {
  revalidate: 300,
  tags: [PUBLIC_DASHBOARD_TAG],
});

async function getIssuesDataUncached() {
  if (!hasSupabaseServiceConfig()) {
    return { clusters: [], excerptsByCluster: {}, signalsByCluster: {} };
  }

  const supabase = createServiceClient();

  const { data: clusterData } = await supabase
    .from("issue_clusters")
    .select("id, slug, title, category, description, fix_status, confidence, is_public")
    .eq("is_public", true);

  const { data: reports } = await supabase
    .from("bug_reports")
    .select("cluster_id, platform")
    .eq("moderation_status", "approved");
  const reportRows = (reports ?? []) as { cluster_id: string | null; platform: string }[];

  const { data: signals } = await supabase
    .from("source_signals")
    .select("id, cluster_id, source, source_url, title, summary, category, confidence, observed_at, source_published_at, public_status")
    .eq("public_status", "public")
    .order("observed_at", { ascending: false });
  const currentPatch = await getCurrentPatchMetadata(supabase);
  const signalRows = filterPublicCurrentPatchSignals((signals ?? []) as SignalRow[], currentPatch);

  const { data: excerpts } = await supabase
    .from("approved_excerpts")
    .select("excerpt_text, created_at, bug_reports(cluster_id, platform)")
    .order("created_at", { ascending: false })
    .limit(100);

  const candidateSignalCounts = await getCandidateSignalCountsByCluster(supabase);

  const directByCluster = countClusterIds(reportRows);
  const signalByCluster = countClusterIds(signalRows);
  const clusters = rankClusters((clusterData ?? []) as ClusterRow[], reportRows)
    .map((cluster) => {
      const signalCount = signalByCluster[cluster.id] ?? 0;
      const directReportCount = directByCluster[cluster.id] ?? 0;
      const candidateSignalCount = candidateSignalCounts[cluster.id] ?? 0;
      return {
        ...cluster,
        count: directReportCount,
        signalCount,
        directReportCount,
        candidateSignalCount,
        strengthScore: signalCount + directReportCount * 3,
      };
    })
    .sort((a, b) => b.strengthScore - a.strengthScore);

  const signalsByCluster: Record<string, SignalRow[]> = {};
  for (const signal of signalRows) {
    const key = signal.cluster_id ?? "unclustered";
    (signalsByCluster[key] ??= []).push(signal);
  }

  const excerptsByCluster: Record<string, { text: string; platform: string }[]> = {};
  for (const excerpt of (excerpts ?? []) as ExcerptRow[]) {
    const report = relatedReport(excerpt.bug_reports);
    const key = report?.cluster_id ?? "unclustered";
    (excerptsByCluster[key] ??= []).push({
      text: excerpt.excerpt_text,
      platform: report?.platform ?? "other",
    });
  }

  return { clusters, excerptsByCluster, signalsByCluster };
}

export const getIssuesData = unstable_cache(getIssuesDataUncached, ["issues-data"], {
  revalidate: 300,
  tags: [PUBLIC_ISSUES_TAG],
});

/** Latest non-dry-run scan metadata for the public scanner heartbeat. Never throws — safe fallback is null. */
export async function getLatestPublicScanMeta(): Promise<PublicScanMeta> {
  if (!hasSupabaseServiceConfig()) return null;
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("automation_runs")
      .select("finished_at, status, search_results_seen")
      .neq("mode", "dry_run")
      .in("status", ["success", "partial", "failed"])
      .order("started_at", { ascending: false })
      .limit(1);
    if (error) return null;
    const row = (data ?? [])[0] as { finished_at: string | null; status: string; search_results_seen: number } | undefined;
    if (!row) return null;
    return { finishedAt: row.finished_at, status: row.status, searchResultsSeen: row.search_results_seen };
  } catch {
    return null;
  }
}

const RUN_COLUMNS =
  "id, started_at, finished_at, status, mode, estimated_cost_usd, search_queries_used, search_results_seen, reddit_posts_seen, llm_calls_used, signals_inserted, signals_deduped, signals_reobserved, stale_signals_hidden, candidates_rescued, clusters_promoted, intent, skips, errors, funnel";

export async function getAutomationAdminData() {
  const supabase = createServiceClient();

  const { data: signals } = await supabase
    .from("source_signals")
    .select(
      "id, cluster_id, source, source_type, source_url, title, source_domain, source_published_at, first_seen_at, last_seen_at, seen_count, summary, category, confidence, observed_at, public_status",
    )
    .order("observed_at", { ascending: false })
    .limit(20);

  const { data: runs } = await supabase
    .from("automation_runs")
    .select(
      RUN_COLUMNS,
    )
    .order("started_at", { ascending: false })
    .limit(10);

  const { data: rejectedCandidates } = await supabase
    .from("automation_rejected_candidates")
    .select("id, title, url, source_domain, source_published_at, reason, created_at, rescued_at")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(30);

  const control = await getAutomationControlState(supabase as unknown as AutomationSettingsClient);

  const { data: activeRunRows } = await supabase
    .from("automation_runs")
    .select("id, status, mode, started_at")
    .eq("status", "running")
    .order("started_at", { ascending: false })
    .limit(1);

  // Fetched unbounded (not from the 10-row `runs` slice): during a paused/capped
  // stretch, hourly skip rows can fill that slice and hide the real last scan.
  const { data: latestRealRows } = await supabase
    .from("automation_runs")
    .select(RUN_COLUMNS)
    .neq("mode", "dry_run")
    .in("status", ["success", "partial", "failed"])
    .order("started_at", { ascending: false })
    .limit(1);
  // success/partial only: signalsInserted is bumped during screening (before
  // persistSignals writes to the DB), so a failed run can report inserts that never
  // landed — it must not pose as the most recent find.
  const { data: latestFindRows } = await supabase
    .from("automation_runs")
    .select(RUN_COLUMNS)
    .neq("mode", "dry_run")
    .in("status", ["success", "partial"])
    .or("signals_inserted.gt.0,signals_reobserved.gt.0,clusters_promoted.gt.0")
    .order("started_at", { ascending: false })
    .limit(1);

  return {
    signals: (signals ?? []) as AdminSignalRow[],
    runs: (runs ?? []) as AutomationRunRow[],
    rejectedCandidates: (rejectedCandidates ?? []) as RejectedCandidateRow[],
    control,
    activeRun: ((activeRunRows ?? []) as { id: string; status: string; mode: string; started_at: string }[])[0] ?? null,
    latestRealRun: ((latestRealRows ?? []) as AutomationRunRow[])[0] ?? null,
    latestFind: ((latestFindRows ?? []) as AutomationRunRow[])[0] ?? null,
  };
}

export type PublicScannerData = {
  reviewedThisWeek: number;
  filteredThisWeek: number;
  keptThisWeek: number;
  awaiting: number;
  published: number;
  lastCheckedAt: string | null;
  scannerActive: boolean;
};

/**
 * Aggregate-only scanner counts for the public /scanner tab. Selects ONLY numeric
 * columns, cluster_id, and public_status — never a title, url, summary, or reject
 * reason. This is the public privacy boundary: raw content never leaves this query.
 */
async function getPublicScannerDataUncached(): Promise<PublicScannerData> {
  const empty: PublicScannerData = {
    reviewedThisWeek: 0,
    filteredThisWeek: 0,
    keptThisWeek: 0,
    awaiting: 0,
    published: 0,
    lastCheckedAt: null,
    scannerActive: false,
  };
  if (!hasSupabaseServiceConfig()) return empty;

  const supabase = createServiceClient();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: runData } = await supabase
    .from("automation_runs")
    .select("search_results_seen, reddit_posts_seen, signals_inserted, status, finished_at, started_at")
    .neq("mode", "dry_run")
    .in("status", ["success", "partial", "failed"])
    .gte("started_at", weekAgo)
    .order("started_at", { ascending: false });
  const runs = (runData ?? []) as {
    search_results_seen: number;
    reddit_posts_seen: number;
    signals_inserted: number;
    status: string;
    finished_at: string | null;
    started_at: string;
  }[];
  const reviewedThisWeek = runs.reduce(
    (sum, run) => sum + (run.search_results_seen ?? 0) + (run.reddit_posts_seen ?? 0),
    0,
  );
  // Only success/partial runs actually persisted signals — a failed run can carry a
  // non-zero signals_inserted from screening that never landed in the DB.
  const keptThisWeek = runs.reduce(
    (sum, run) => (run.status === "failed" ? sum : sum + (run.signals_inserted ?? 0)),
    0,
  );
  const filteredThisWeek = Math.max(0, reviewedThisWeek - keptThisWeek);

  // Heartbeat is independent of the weekly counters: a quiet or paused week must not
  // erase the real "last checked" time when older runs exist. Unbounded latest lookup.
  const { data: latestRows } = await supabase
    .from("automation_runs")
    .select("finished_at, started_at")
    .neq("mode", "dry_run")
    .in("status", ["success", "partial", "failed"])
    .order("started_at", { ascending: false })
    .limit(1);
  const latest = (latestRows ?? [])[0] as { finished_at: string | null; started_at: string } | undefined;
  const lastCheckedAt = latest?.finished_at ?? latest?.started_at ?? null;

  // Match /issues' evidence rule exactly: a public cluster is "live" when it has a
  // public signal OR an approved player report (hasClusterEvidence = strengthScore > 0).
  // Report-only launch clusters must count as published, not just signal-backed ones.
  // Aggregate-only — selects nothing but cluster_id / public_status / is_public.
  // Public clusters must pass the same current-patch eligibility filter /issues uses,
  // so a stale or wrong-patch public signal isn't counted as live evidence. The
  // title/summary/published fields are selected server-side only to run that filter —
  // they are never returned from this function.
  const currentPatch = await getCurrentPatchMetadata(supabase);
  const { data: publicSignalData } = await supabase
    .from("source_signals")
    .select("cluster_id, title, summary, source_published_at")
    .eq("public_status", "public");
  const publicSignalClusters = new Set<string>();
  for (const signal of filterPublicCurrentPatchSignals((publicSignalData ?? []) as SignalRow[], currentPatch)) {
    if (signal.cluster_id) publicSignalClusters.add(signal.cluster_id);
  }
  // Private candidates: only cluster_id is selected — private content never leaves here.
  const { data: privateSignalData } = await supabase
    .from("source_signals")
    .select("cluster_id")
    .eq("public_status", "private");
  const privateSignalClusters = new Set<string>();
  for (const signal of (privateSignalData ?? []) as { cluster_id: string | null }[]) {
    if (signal.cluster_id) privateSignalClusters.add(signal.cluster_id);
  }

  const { data: reportData } = await supabase
    .from("bug_reports")
    .select("cluster_id")
    .eq("moderation_status", "approved");
  const approvedReportClusters = new Set<string>();
  for (const report of (reportData ?? []) as { cluster_id: string | null }[]) {
    if (report.cluster_id) approvedReportClusters.add(report.cluster_id);
  }

  const { data: clusterData } = await supabase.from("issue_clusters").select("id").eq("is_public", true);
  let published = 0;
  for (const cluster of (clusterData ?? []) as { id: string }[]) {
    if (publicSignalClusters.has(cluster.id) || approvedReportClusters.has(cluster.id)) published += 1;
  }

  // Awaiting = every cluster with a private candidate signal that is not yet live
  // evidence, INCLUDING brand-new candidates whose cluster is still is_public=false
  // (createCluster starts private). That not-yet-public case is the common pending-
  // corroboration state, so it must not be filtered out by an is_public check.
  let awaiting = 0;
  for (const id of privateSignalClusters) {
    if (!publicSignalClusters.has(id) && !approvedReportClusters.has(id)) awaiting += 1;
  }

  const control = await getAutomationControlState(supabase as unknown as AutomationSettingsClient);

  return {
    reviewedThisWeek,
    filteredThisWeek,
    keptThisWeek,
    awaiting,
    published,
    lastCheckedAt,
    scannerActive: !control.paused,
  };
}

export const getPublicScannerData = unstable_cache(getPublicScannerDataUncached, ["public-scanner-data"], {
  revalidate: 300,
  tags: [PUBLIC_DASHBOARD_TAG],
});
