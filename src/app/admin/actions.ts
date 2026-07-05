"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { countBy, rankClusters } from "@/lib/aggregates";
import { runAutomationMonitor } from "@/lib/automation/run";
import { CURRENT_PATCH, FIX_STATUSES } from "@/lib/constants";
import { requireAdmin } from "@/lib/adminGuard";
import { draftDossierWithAi } from "@/lib/ai";
import { externalIdHash } from "@/lib/crypto";
import { buildDeterministicDossier, type DossierCluster } from "@/lib/dossier";
import { features } from "@/lib/env";
import { classifySignal, summarize } from "@/lib/reddit";
import { fetchNewPosts, getRedditToken } from "@/lib/reddit.server";
import { createServiceClient } from "@/lib/supabase";

const DECISIONS = ["approved", "rejected", "spam"] as const;

export async function moderateReport(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const clusterId = String(formData.get("cluster_id") ?? "");
  const excerpt = String(formData.get("excerpt") ?? "").trim();
  if (!id || !(DECISIONS as readonly string[]).includes(decision)) throw new Error("bad input");

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("bug_reports")
    .update({ moderation_status: decision, cluster_id: clusterId || null })
    .eq("id", id);
  if (error) throw new Error(error.message);

  if (decision === "approved" && excerpt) {
    await supabase.from("approved_excerpts").insert({ report_id: id, excerpt_text: excerpt.slice(0, 500) });
  }

  revalidatePath("/admin");
  revalidatePath("/");
  revalidatePath("/issues");
}

export async function setClusterFixStatus(formData: FormData): Promise<void> {
  await requireAdmin();
  const clusterId = String(formData.get("cluster_id") ?? "");
  const fixStatus = String(formData.get("fix_status") ?? "");
  if (!clusterId || !(FIX_STATUSES as readonly string[]).includes(fixStatus)) throw new Error("bad input");

  const supabase = createServiceClient();
  const { error } = await supabase.from("issue_clusters").update({ fix_status: fixStatus }).eq("id", clusterId);
  if (error) throw new Error(error.message);

  revalidatePath("/admin");
  revalidatePath("/");
  revalidatePath("/issues");
}

export async function compileDossier(formData: FormData): Promise<void> {
  await requireAdmin();
  const useAi = formData.get("use_ai") === "on";
  const supabase = createServiceClient();

  const { data: reports } = await supabase
    .from("bug_reports")
    .select("category, platform, cluster_id, evidence_url, repro_steps, issue_title")
    .eq("moderation_status", "approved");
  const rows = reports ?? [];

  const { data: clusterData } = await supabase.from("issue_clusters").select("id, title, fix_status, confidence");

  const { count: pendingCount } = await supabase
    .from("bug_reports")
    .select("id", { count: "exact", head: true })
    .eq("moderation_status", "pending");

  const ranked = rankClusters(clusterData ?? [], rows);
  const clusters: DossierCluster[] = ranked.map((cluster) => {
    const clusterRows = rows.filter((report) => report.cluster_id === cluster.id);
    const platCounts = Object.entries(countBy(clusterRows, (report) => report.platform)).sort((a, b) => b[1] - a[1]);
    return {
      title: cluster.title,
      fixStatus: cluster.fix_status,
      confidence: cluster.confidence,
      count: cluster.count,
      topPlatform: platCounts[0]?.[0] ?? null,
    };
  });

  const deterministic = buildDeterministicDossier({
    generatedAt: new Date().toISOString(),
    patchVersion: CURRENT_PATCH,
    totalApproved: rows.length,
    pendingCount: pendingCount ?? 0,
    byCategory: countBy(rows, (report) => report.category),
    platforms: countBy(rows, (report) => report.platform),
    clusters,
    reproNotes: rows
      .filter((report) => report.repro_steps)
      .slice(0, 15)
      .map((report) => ({ title: report.issue_title, steps: String(report.repro_steps) })),
    evidenceUrls: [...new Set(rows.map((report) => report.evidence_url).filter((url): url is string => Boolean(url)))].slice(
      0,
      30,
    ),
  });

  let markdown = deterministic;
  let provider = "deterministic";
  if (useAi && features().ai) {
    const drafted = await draftDossierWithAi(deterministic);
    if (drafted) ({ markdown, provider } = drafted);
  }

  const { data: run, error } = await supabase
    .from("dossier_runs")
    .insert({ markdown, provider, stats: { totalApproved: rows.length, pendingCount: pendingCount ?? 0 } })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  redirect(`/admin/compile?run=${run.id}`);
}

export async function runRedditMonitor(formData: FormData): Promise<void> {
  await requireAdmin();
  if (!features().reddit) throw new Error("reddit monitor disabled: keys missing");

  const raw = String(formData.get("subreddits") ?? "");
  const subreddits = raw
    .split(",")
    .map((subreddit) => subreddit.trim().replace(/^r\//i, ""))
    .filter(Boolean)
    .slice(0, 5);
  if (subreddits.length === 0) throw new Error("no subreddits given");

  const token = await getRedditToken();
  const supabase = createServiceClient();
  const expires = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  for (const subreddit of subreddits) {
    const posts = await fetchNewPosts(subreddit, token);
    for (const post of posts) {
      const body = post.selftext ?? "";
      const text = `${post.title} ${body}`;
      const { category, confidence } = classifySignal(text);

      const { error } = await supabase.from("source_signals").upsert(
        {
          source: "reddit",
          source_url: `https://www.reddit.com${post.permalink}`,
          external_id_hash: externalIdHash("reddit", post.id),
          summary: summarize(post.title, body),
          extracted_facts: { subreddit, classified: category },
          category,
          confidence,
          observed_at: new Date(post.created_utc * 1000).toISOString(),
          raw_text: body.slice(0, 8000) || null,
          raw_expires_at: expires,
        },
        { onConflict: "external_id_hash", ignoreDuplicates: true },
      );
      if (error) throw new Error(`reddit monitor insert failed: ${error.message}`);
    }
  }

  revalidatePath("/admin/source-monitor");
}

export async function runAutomationDryScan(): Promise<void> {
  await requireAdmin();
  await runAutomationMonitor({ mode: "dry_run" });
  revalidatePath("/admin/source-monitor");
}

export async function runAutomationCappedScan(): Promise<void> {
  await requireAdmin();
  await runAutomationMonitor({ mode: "manual" });
  revalidatePath("/admin/source-monitor");
  revalidatePath("/");
  revalidatePath("/issues");
}
