import "server-only";

import { unstable_cache } from "next/cache";
import { buildDailySeries, countBy, rankClusters } from "@/lib/aggregates";
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
  summary: string;
  category: string;
  confidence: "low" | "medium" | "high";
  observed_at: string;
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
  skips: string[];
  errors: string[];
  funnel: Record<string, number> | null;
};

export type RejectedCandidateRow = {
  id: string;
  title: string;
  url: string;
  source_domain: string | null;
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
    .select("id, cluster_id, source, source_url, summary, category, confidence, observed_at, public_status")
    .eq("public_status", "public");
  const signalRows = (signals ?? []) as SignalRow[];

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
        "started_at, status, mode, search_queries_used, llm_calls_used, signals_inserted, clusters_promoted, search_results_seen, finished_at",
      )
      .neq("mode", "dry_run")
      .order("started_at", { ascending: false })
      .limit(1),
    getCurrentPatchMetadata(supabase),
    getClaimedFixesForCurrentPatch(supabase),
    getCandidateSignalCountsByCluster(supabase),
  ]);

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
    .select("id, cluster_id, source, source_url, summary, category, confidence, observed_at, public_status")
    .eq("public_status", "public")
    .order("observed_at", { ascending: false });
  const signalRows = (signals ?? []) as SignalRow[];

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

export async function getAutomationAdminData() {
  const supabase = createServiceClient();

  const { data: signals } = await supabase
    .from("source_signals")
    .select(
      "id, cluster_id, source, source_type, source_url, title, source_domain, summary, category, confidence, observed_at, public_status",
    )
    .order("observed_at", { ascending: false })
    .limit(20);

  const { data: runs } = await supabase
    .from("automation_runs")
    .select(
      "id, started_at, finished_at, status, mode, estimated_cost_usd, search_queries_used, llm_calls_used, signals_inserted, signals_deduped, clusters_promoted, skips, errors, funnel",
    )
    .order("started_at", { ascending: false })
    .limit(10);

  const { data: rejectedCandidates } = await supabase
    .from("automation_rejected_candidates")
    .select("id, title, url, source_domain, reason, created_at, rescued_at")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(30);

  const control = await getAutomationControlState(supabase as unknown as AutomationSettingsClient);

  return {
    signals: (signals ?? []) as AdminSignalRow[],
    runs: (runs ?? []) as AutomationRunRow[],
    rejectedCandidates: (rejectedCandidates ?? []) as RejectedCandidateRow[],
    control,
  };
}
