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
  return {
    total: rows.length,
    weekDelta: rows.filter((row) => new Date(row.created_at).getTime() > weekAgo).length,
    byCategory: countBy(rows, (row) => row.category),
    platforms: countBy(rows, (row) => row.platform),
    series: buildDailySeries(rows, 30, new Date()),
    topClusters: rankClusters((clusterData ?? []) as ClusterRow[], rows),
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

  const { data: excerpts } = await supabase
    .from("approved_excerpts")
    .select("excerpt_text, created_at, bug_reports(cluster_id, platform)")
    .order("created_at", { ascending: false })
    .limit(100);

  const clusters = rankClusters((clusterData ?? []) as ClusterRow[], reports ?? []);
  const excerptsByCluster: Record<string, { text: string; platform: string }[]> = {};
  for (const excerpt of excerpts ?? []) {
    const report = excerpt.bug_reports as unknown as { cluster_id: string | null; platform: string } | null;
    const key = report?.cluster_id ?? "unclustered";
    (excerptsByCluster[key] ??= []).push({
      text: excerpt.excerpt_text,
      platform: report?.platform ?? "other",
    });
  }

  return { clusters, excerptsByCluster };
}
