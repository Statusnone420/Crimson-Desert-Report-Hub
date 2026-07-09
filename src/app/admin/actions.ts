"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { countBy } from "@/lib/aggregates";
import { rescueCandidateSignal } from "@/lib/automation/run";
import {
  scannerPolicyFromFormData,
  setAutomationPaused as setAutomationPausedState,
  setScannerPolicy as setScannerPolicyState,
  type AutomationSettingsClient,
} from "@/lib/automation/settings";
import { FIX_STATUSES } from "@/lib/constants";
import { requireAdmin } from "@/lib/adminGuard";
import { draftDossierWithAi } from "@/lib/ai";
import { externalIdHash } from "@/lib/crypto";
import { buildDeterministicDossier, type DossierCluster, type DossierVerifiedReport } from "@/lib/dossier";
import { features } from "@/lib/env";
import { LIFECYCLE_LABELS } from "@/lib/lifecycle";
import { getCurrentPatchMetadata } from "@/lib/officialPatch.server";
import { assertProductionWriteAllowed } from "@/lib/previewGuard";
import { revalidatePublicSurfaces } from "@/lib/revalidate";
import { classifySignal, summarize } from "@/lib/reddit";
import { fetchNewPosts, getRedditToken } from "@/lib/reddit.server";
import { ADMIN_COOKIE } from "@/lib/session";
import { createServiceClient } from "@/lib/supabase";

const DECISIONS = ["approved", "rejected", "spam"] as const;

export async function signOutAdmin() {
  const store = await cookies();
  store.set(ADMIN_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  redirect("/admin/login");
}

type CompileReportRow = {
  category: string | null;
  platform: string | null;
  cluster_id: string | null;
  evidence_url: string | null;
  repro_steps: string | null;
  issue_title: string;
};

type CompileClusterRow = {
  id: string;
  title: string;
  fix_status: string;
  confidence: string;
};

type CompileSignalRow = {
  cluster_id: string | null;
  source: string;
  source_url: string;
  title: string | null;
  summary: string;
  category: string;
  observed_at: string;
};

type RelatedReport<T> = T | T[] | null;

type CompileVerifiedRow = {
  report_id: string;
  excerpt_text: string;
  bug_reports: RelatedReport<{ cluster_id: string | null; issue_title: string | null; platform: string | null }>;
};

function relatedReport<T>(value: RelatedReport<T>): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function throwReadError(label: string, error: { message: string } | null): void {
  if (error) throw new Error(`${label} read failed: ${error.message}`);
}

function distinctVerifiedReports(rows: CompileVerifiedRow[]): DossierVerifiedReport[] {
  const reports = new Map<string, DossierVerifiedReport>();
  for (const row of rows) {
    if (reports.has(row.report_id)) continue;
    const report = relatedReport(row.bug_reports);
    reports.set(row.report_id, {
      reportId: row.report_id,
      title: report?.issue_title ?? "Verified report",
      excerpt: row.excerpt_text,
      platform: report?.platform ?? null,
    });
  }
  return [...reports.values()];
}

function distinctVerifiedClusterRows(rows: CompileVerifiedRow[]): { cluster_id: string | null }[] {
  const clustersByReport = new Map<string, { cluster_id: string | null }>();
  for (const row of rows) {
    if (clustersByReport.has(row.report_id)) continue;
    clustersByReport.set(row.report_id, { cluster_id: relatedReport(row.bug_reports)?.cluster_id ?? null });
  }
  return [...clustersByReport.values()];
}

export async function moderateReport(formData: FormData): Promise<void> {
  await requireAdmin();
  assertProductionWriteAllowed();
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
    const { error: excerptError } = await supabase
      .from("approved_excerpts")
      .insert({ report_id: id, excerpt_text: excerpt.slice(0, 500) });
    if (excerptError) throw new Error(`approved excerpt insert failed: ${excerptError.message}`);
  }

  revalidatePath("/admin");
  revalidatePublicSurfaces();
}

export async function setClusterFixStatus(formData: FormData): Promise<void> {
  await requireAdmin();
  assertProductionWriteAllowed();
  const clusterId = String(formData.get("cluster_id") ?? "");
  const fixStatus = String(formData.get("fix_status") ?? "");
  if (!clusterId || !(FIX_STATUSES as readonly string[]).includes(fixStatus)) throw new Error("bad input");

  const supabase = createServiceClient();
  const label = LIFECYCLE_LABELS[fixStatus as keyof typeof LIFECYCLE_LABELS] ?? fixStatus.replace(/_/g, " ");
  const { error } = await supabase
    .from("issue_clusters")
    .update({
      fix_status: fixStatus,
      admin_override: true,
      lifecycle_reason: `Locked by you. Manual status set to ${label}.`,
    })
    .eq("id", clusterId);
  if (error) throw new Error(error.message);

  revalidatePath("/admin");
  revalidatePublicSurfaces();
}

const VISIBILITY_OVERRIDES = ["auto", "force_public", "force_hidden"] as const;

/** Writer for the promotion engine's visibility escape hatch (it already reads this column). */
export async function setClusterVisibilityOverride(formData: FormData): Promise<void> {
  await requireAdmin();
  assertProductionWriteAllowed();
  const clusterId = String(formData.get("cluster_id") ?? "");
  const visibility = String(formData.get("visibility") ?? "");
  if (!clusterId || !(VISIBILITY_OVERRIDES as readonly string[]).includes(visibility)) throw new Error("bad input");

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("issue_clusters")
    .update({ admin_visibility_override: visibility === "auto" ? null : visibility })
    .eq("id", clusterId);
  if (error) throw new Error(error.message);

  revalidatePath("/admin");
  revalidatePublicSurfaces();
}

export async function clearClusterFixStatusOverride(formData: FormData): Promise<void> {
  await requireAdmin();
  assertProductionWriteAllowed();
  const clusterId = String(formData.get("cluster_id") ?? "");
  if (!clusterId) throw new Error("bad input");

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("issue_clusters")
    .update({ admin_override: false, lifecycle_reason: null })
    .eq("id", clusterId);
  if (error) throw new Error(error.message);

  revalidatePath("/admin");
  revalidatePublicSurfaces();
}

export async function compileDossier(formData: FormData): Promise<void> {
  await requireAdmin();
  assertProductionWriteAllowed();
  const useAi = formData.get("use_ai") === "on";
  const supabase = createServiceClient();
  const currentPatch = await getCurrentPatchMetadata(supabase);

  const { data: reports, error: reportsError } = await supabase
    .from("bug_reports")
    .select("category, platform, cluster_id, evidence_url, repro_steps, issue_title")
    .eq("moderation_status", "approved");
  throwReadError("approved reports", reportsError);
  const rows = (reports ?? []) as CompileReportRow[];

  const { data: clusterData, error: clustersError } = await supabase
    .from("issue_clusters")
    .select("id, title, fix_status, confidence");
  throwReadError("issue clusters", clustersError);
  const clusterRows = (clusterData ?? []) as CompileClusterRow[];

  const { data: signals, error: signalsError } = await supabase
    .from("source_signals")
    .select("cluster_id, source, source_url, title, summary, category, observed_at")
    .eq("public_status", "public")
    .order("observed_at", { ascending: false });
  throwReadError("community signals", signalsError);
  const signalRows = (signals ?? []) as CompileSignalRow[];

  const { data: verified, error: verifiedError } = await supabase
    .from("approved_excerpts")
    .select("report_id, excerpt_text, bug_reports(cluster_id, issue_title, platform)")
    .order("created_at", { ascending: false })
    .limit(1000);
  throwReadError("verified reports", verifiedError);
  const verifiedRows = (verified ?? []) as CompileVerifiedRow[];
  const verifiedReports = distinctVerifiedReports(verifiedRows);

  const { count: pendingCount, error: pendingError } = await supabase
    .from("bug_reports")
    .select("id", { count: "exact", head: true })
    .eq("moderation_status", "pending");
  throwReadError("pending reports", pendingError);

  const directByCluster = countBy(rows, (report) => report.cluster_id);
  const signalByCluster = countBy(signalRows, (signal) => signal.cluster_id);
  const verifiedByCluster = countBy(distinctVerifiedClusterRows(verifiedRows), (verifiedReport) => verifiedReport.cluster_id);
  const clusterTitleById = new Map(clusterRows.map((cluster) => [cluster.id, cluster.title]));

  const clusters: DossierCluster[] = clusterRows.map((cluster) => {
    const reportsForCluster = rows.filter((report) => report.cluster_id === cluster.id);
    const platCounts = Object.entries(countBy(reportsForCluster, (report) => report.platform)).sort((a, b) => b[1] - a[1]);
    const directReportCount = directByCluster[cluster.id] ?? 0;
    return {
      title: cluster.title,
      fixStatus: cluster.fix_status,
      confidence: cluster.confidence,
      count: directReportCount,
      signalCount: signalByCluster[cluster.id] ?? 0,
      directReportCount,
      verifiedReportCount: verifiedByCluster[cluster.id] ?? 0,
      topPlatform: platCounts[0]?.[0] ?? null,
    };
  });

  const deterministic = buildDeterministicDossier({
    generatedAt: new Date().toISOString(),
    patchVersion: currentPatch.version,
    totalSignals: signalRows.length,
    totalDirectReports: rows.length,
    totalVerifiedReports: verifiedReports.length,
    pendingCount: pendingCount ?? 0,
    byCategory: countBy(rows, (report) => report.category),
    platforms: countBy(rows, (report) => report.platform),
    clusters,
    communitySignals: signalRows.map((signal) => ({
      title: signal.title?.trim() || signal.summary,
      source: signal.source,
      url: signal.source_url,
      summary: signal.summary,
      category: signal.category,
      clusterTitle: signal.cluster_id ? (clusterTitleById.get(signal.cluster_id) ?? null) : null,
    })),
    reproNotes: rows
      .filter((report) => report.repro_steps)
      .slice(0, 15)
      .map((report) => ({ title: report.issue_title, steps: String(report.repro_steps) })),
    directReportEvidenceUrls: [
      ...new Set(rows.map((report) => report.evidence_url).filter((url): url is string => Boolean(url))),
    ].slice(0, 30),
    verifiedReports,
  });

  let markdown = deterministic;
  let provider = "deterministic";
  if (useAi && features().ai) {
    const drafted = await draftDossierWithAi(deterministic);
    if (drafted) ({ markdown, provider } = drafted);
  }

  const { data: run, error } = await supabase
    .from("dossier_runs")
    .insert({
      markdown,
      provider,
      stats: {
        totalSignals: signalRows.length,
        totalDirectReports: rows.length,
        totalVerifiedReports: verifiedReports.length,
        pendingCount: pendingCount ?? 0,
      },
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  redirect(`/admin/compile?run=${run.id}`);
}

export async function runRedditMonitor(formData: FormData): Promise<void> {
  await requireAdmin();
  assertProductionWriteAllowed();
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

  revalidatePath("/scanner");
  revalidatePath("/admin/source-monitor");
  revalidatePublicSurfaces();
}

export async function setAutomationPaused(formData: FormData): Promise<void> {
  await requireAdmin();
  assertProductionWriteAllowed();
  const paused = formData.get("paused") === "true";
  await setAutomationPausedState(createServiceClient() as unknown as AutomationSettingsClient, paused);
  revalidatePath("/admin");
  revalidatePath("/scanner");
  revalidatePath("/admin/source-monitor");
  revalidatePublicSurfaces();
}

export async function setScannerPolicy(formData: FormData): Promise<void> {
  await requireAdmin();
  assertProductionWriteAllowed();
  await setScannerPolicyState(
    createServiceClient() as unknown as AutomationSettingsClient,
    scannerPolicyFromFormData(formData),
  );
  revalidatePath("/admin");
  revalidatePath("/scanner");
  revalidatePath("/admin/source-monitor");
  revalidatePublicSurfaces();
}

export async function rescueRejectedCandidate(formData: FormData): Promise<void> {
  await requireAdmin();
  assertProductionWriteAllowed();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("bad input");
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("automation_rejected_candidates")
    .select("id, title, url, source_domain, source_published_at, snippet")
    .eq("id", id)
    .limit(1);
  if (error) throw new Error(`rejected candidate read failed: ${error.message}`);
  const candidate = (data ?? [])[0];
  if (!candidate) throw new Error("rejected candidate not found");

  await rescueCandidateSignal(supabase, {
    title: candidate.title,
    url: candidate.url,
    sourceDomain: candidate.source_domain ?? null,
    sourcePublishedAt: candidate.source_published_at ?? null,
    snippet: candidate.snippet ?? "",
  });

  const { error: markError } = await supabase
    .from("automation_rejected_candidates")
    .update({ rescued_at: new Date().toISOString() })
    .eq("id", id);
  if (markError) throw new Error(`rescue mark failed: ${markError.message}`);

  revalidatePath("/scanner");
  revalidatePath("/admin/source-monitor");
  revalidatePublicSurfaces();
}
