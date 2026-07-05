import "server-only";

import { buildDailySeries, countBy, rankClusters } from "@/lib/aggregates";
import { createServiceClient } from "@/lib/supabase";

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
};

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

export async function getDashboardData() {
  const supabase = createServiceClient();

  const { data: reports } = await supabase
    .from("bug_reports")
    .select("category, platform, created_at, cluster_id")
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
      return {
        ...cluster,
        count: directReportCount,
        signalCount,
        directReportCount,
        verifiedReportCount,
        strengthScore: signalCount + directReportCount * 3,
      };
    })
    .filter((cluster) => cluster.directReportCount > 0 || cluster.signalCount > 0)
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
    series: buildDailySeries(rows, 30, new Date()),
    topClusters,
    pendingCount: pendingCount ?? 0,
    latestReportAt: latest?.[0]?.created_at ?? null,
  };
}

export async function getIssuesData() {
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

  const directByCluster = countClusterIds(reportRows);
  const signalByCluster = countClusterIds(signalRows);
  const clusters = rankClusters((clusterData ?? []) as ClusterRow[], reportRows)
    .map((cluster) => {
      const signalCount = signalByCluster[cluster.id] ?? 0;
      const directReportCount = directByCluster[cluster.id] ?? 0;
      return {
        ...cluster,
        count: directReportCount,
        signalCount,
        directReportCount,
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
      "id, started_at, finished_at, status, mode, estimated_cost_usd, search_queries_used, llm_calls_used, signals_inserted, signals_deduped, clusters_promoted, skips, errors",
    )
    .order("started_at", { ascending: false })
    .limit(10);

  return {
    signals: (signals ?? []) as AdminSignalRow[],
    runs: (runs ?? []) as AutomationRunRow[],
  };
}
