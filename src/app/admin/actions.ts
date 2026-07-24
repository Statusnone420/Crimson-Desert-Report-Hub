"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { countBy } from "@/lib/aggregates";
import { hashValue } from "@/lib/automation/dedupe";
import {
  isScannerDecision,
  isScannerRuleScope,
  scannerRuleScopeValue,
} from "@/lib/automation/feedback";
import { refreshClusterVisibility, rescueCandidateSignal } from "@/lib/automation/run";
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
import { isValidPatchVersion } from "@/lib/officialPatch";
import { getCurrentPatchMetadata } from "@/lib/officialPatch.server";
import { assertProductionWriteAllowed } from "@/lib/previewGuard";
import { revalidatePublicSurfaces } from "@/lib/revalidate";
import { classifySignal, summarize } from "@/lib/reddit";
import { fetchNewPosts, getRedditToken } from "@/lib/reddit.server";
import { ADMIN_COOKIE } from "@/lib/session";
import { createServiceClient } from "@/lib/supabase";
import { isMissingSupabaseRpc } from "@/lib/supabaseCompatibility";

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
  const { data: existingReports, error: existingError } = await supabase
    .from("bug_reports")
    .select("moderation_status, cluster_id")
    .eq("id", id)
    .limit(1);
  if (existingError) throw new Error(`report read failed: ${existingError.message}`);
  const existingReport = ((existingReports ?? []) as {
    moderation_status: string;
    cluster_id: string | null;
  }[])[0];
  if (!existingReport) throw new Error("report not found");

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

  const clustersToRefresh = new Set<string>();
  if (existingReport.moderation_status === "approved" && existingReport.cluster_id) {
    clustersToRefresh.add(existingReport.cluster_id);
  }
  if (decision === "approved" && clusterId) clustersToRefresh.add(clusterId);

  for (const affectedClusterId of clustersToRefresh) {
    try {
      // The report trigger already made core visibility durable. Keep this deep
      // stats/source refresh best-effort after the excerpt is safely persisted.
      // Recompute the old destination too when an approval moves or is removed.
      await refreshClusterVisibility(affectedClusterId);
    } catch (refreshError) {
      console.error("cluster visibility refresh failed:", refreshError);
    }
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
  const claimBearing = fixStatus === "fix_claimed" || fixStatus === "verified_fixed" || fixStatus === "persists";
  const patch = claimBearing ? await getCurrentPatchMetadata(supabase) : null;
  const { error } = await supabase
    .from("issue_clusters")
    .update({
      fix_status: fixStatus,
      fix_claimed_at: claimBearing ? new Date().toISOString() : null,
      fix_claimed_patch_version: patch?.version ?? null,
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
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500);
  const confirmed = formData.get("confirm_override") === "true";
  if (!clusterId || !(VISIBILITY_OVERRIDES as readonly string[]).includes(visibility)) throw new Error("bad input");
  if (visibility !== "auto" && (reason.length < 3 || !confirmed)) throw new Error("override reason and confirmation required");

  const supabase = createServiceClient();
  const { error } = await supabase.rpc("set_cluster_visibility_override", {
    p_cluster_id: clusterId,
    p_visibility: visibility,
    p_reason: visibility === "auto" ? null : reason,
  });
  if (error) {
    if (!isMissingSupabaseRpc(error, "set_cluster_visibility_override")) {
      throw new Error(error.message);
    }
    // Rolling-deploy compatibility: the production migration used to expose
    // this RPC without p_reason. Retry only when PostgREST cannot resolve the
    // new signature; real database/runtime failures still surface.
    const { error: legacyError } = await supabase.rpc("set_cluster_visibility_override", {
      p_cluster_id: clusterId,
      p_visibility: visibility,
    });
    if (legacyError) throw new Error(legacyError.message);
  }
  try {
    if (visibility !== "force_hidden") await refreshClusterVisibility(clusterId);
  } finally {
    revalidatePath("/admin");
    revalidatePublicSurfaces();
  }
}

export async function clearClusterFixStatusOverride(formData: FormData): Promise<void> {
  await requireAdmin();
  assertProductionWriteAllowed();
  const clusterId = String(formData.get("cluster_id") ?? "");
  if (!clusterId) throw new Error("bad input");

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("issue_clusters")
    .update({
      admin_override: false,
      lifecycle_reason: null,
      // Manual claim-bearing locks synthesize this clock. Auto must rebuild it
      // only from a current, confidently matched Pearl Abyss claim.
      fix_claimed_at: null,
      fix_claimed_patch_version: null,
    })
    .eq("id", clusterId);
  if (error) throw new Error(error.message);

  revalidatePath("/admin");
  revalidatePublicSurfaces();
}

/**
 * Break-glass writer for when the Pearl Abyss notice scraper stops matching.
 * The next successful sync reclaims control by flipping is_current to whatever
 * it scrapes; no fix claims attach to a manual row.
 */
export async function setCurrentPatchOverride(formData: FormData): Promise<void> {
  await requireAdmin();
  assertProductionWriteAllowed();
  const version = String(formData.get("patch_version") ?? "").trim();
  if (!isValidPatchVersion(version)) throw new Error("bad input");

  const supabase = createServiceClient();
  const observedAt = new Date().toISOString();
  const { error } = await supabase.rpc("set_current_patch_override", {
    p_patch_version: version,
    p_observed_at: observedAt,
  });
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
  if (!features().reddit) throw new Error("reddit monitor permanently disabled");

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
          summary: summarize(post.title),
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

export async function recordScannerDecision(formData: FormData): Promise<void> {
  await requireAdmin();
  assertProductionWriteAllowed();
  const id = String(formData.get("id") ?? "").trim();
  const targetKind = String(formData.get("target_kind") ?? "candidate").trim();
  const decision = String(formData.get("decision") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const scope = String(formData.get("scope") ?? "exact_url").trim();
  const confirmBroad = formData.get("confirm_broad") === "true";
  const expiresAtValue = String(formData.get("expires_at") ?? "").trim();
  const expiresAt = expiresAtValue ? new Date(expiresAtValue) : null;
  if (
    !id ||
    !isScannerDecision(decision) ||
    !isScannerRuleScope(scope) ||
    !["candidate", "signal"].includes(targetKind) ||
    reason.length < 3 ||
    reason.length > 500 ||
    (targetKind === "signal" && (decision === "relevant" || scope !== "exact_url" || confirmBroad)) ||
    (scope !== "exact_url" && !confirmBroad) ||
    (expiresAt !== null && (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()))
  ) {
    throw new Error("bad input");
  }
  const supabase = createServiceClient();
  if (targetKind === "signal") {
    const { data, error } = await supabase
      .from("source_signals")
      .select("id, cluster_id, source, source_type, source_url, canonical_url, source_domain")
      .eq("id", id)
      .limit(1);
    if (error) throw new Error(`source signal read failed: ${error.message}`);
    const signal = (data ?? [])[0] as {
      id: string;
      cluster_id: string | null;
      source: string;
      source_type: string | null;
      source_url: string;
      canonical_url: string | null;
      source_domain: string | null;
    } | undefined;
    if (!signal) throw new Error("source signal not found");
    if (signal.source === "steam_review" || signal.source_type === "steam_review") {
      throw new Error("Steam review signals cannot create URL feedback rules");
    }
    const targetUrl = scannerRuleScopeValue("exact_url", {
      url: signal.canonical_url ?? signal.source_url,
      sourceDomain: signal.source_domain,
    });
    if (!targetUrl) throw new Error("bad input");
    const { data: decisionRows, error: decisionError } = await supabase.rpc("record_scanner_decision", {
      p_candidate_id: null,
      p_signal_id: signal.id,
      p_target_url: targetUrl,
      p_target_url_hash: hashValue(targetUrl),
      p_source_domain: signal.source_domain,
      p_decision: decision,
      p_reason: reason,
      p_scope_type: "exact_url",
      p_scope_value: targetUrl,
      p_confirm_broad: false,
      p_expires_at: expiresAt?.toISOString() ?? null,
    });
    if (decisionError) throw new Error(`scanner decision write failed: ${decisionError.message}`);
    const affectedClusterId = ((decisionRows ?? [])[0] as {
      affected_cluster_id?: string | null;
    } | undefined)?.affected_cluster_id ?? null;
    if (affectedClusterId) await refreshClusterVisibility(affectedClusterId);
    revalidatePath("/admin");
    revalidatePath("/scanner");
    revalidatePath("/admin/source-monitor");
    revalidatePublicSurfaces();
    return;
  }

  const { data, error } = await supabase
    .from("automation_rejected_candidates")
    .select("id, title, url, source_domain, source_published_at, snippet")
    .eq("id", id)
    .limit(1);
  if (error) throw new Error(`rejected candidate read failed: ${error.message}`);
  const candidate = (data ?? [])[0];
  if (!candidate) throw new Error("rejected candidate not found");

  const targetUrl = scannerRuleScopeValue("exact_url", {
    url: candidate.url,
    sourceDomain: candidate.source_domain ?? null,
  });
  const scopeValue = scannerRuleScopeValue(scope, {
    url: candidate.url,
    sourceDomain: candidate.source_domain ?? null,
  });
  if (!targetUrl || !scopeValue) throw new Error("bad input");

  // Relevant is the only decision with external work. Rescue first so a failed
  // extraction/persistence cannot hide the candidate or supersede an older rule.
  // A later decision-write failure leaves the safely persisted signal and the
  // candidate visible for a retry; signal upsert makes that retry idempotent.
  if (decision === "relevant") {
    await rescueCandidateSignal(supabase, {
      title: candidate.title,
      url: candidate.url,
      sourceDomain: candidate.source_domain ?? null,
      sourcePublishedAt: candidate.source_published_at ?? null,
      snippet: candidate.snippet ?? "",
    });
  }

  const { error: decisionError } = await supabase.rpc("record_scanner_decision", {
    p_candidate_id: id,
    p_signal_id: null,
    p_target_url: targetUrl,
    p_target_url_hash: hashValue(targetUrl),
    p_source_domain: candidate.source_domain ?? null,
    p_decision: decision,
    p_reason: reason,
    p_scope_type: scope,
    p_scope_value: scopeValue,
    p_confirm_broad: confirmBroad,
    p_expires_at: expiresAt?.toISOString() ?? null,
  });
  const legacyRelevantRescue =
    decision === "relevant" && isMissingSupabaseRpc(decisionError, "record_scanner_decision");
  if (decisionError && !legacyRelevantRescue) {
    throw new Error(`scanner decision write failed: ${decisionError.message}`);
  }

  if (decision === "relevant") {
    const { error: markError } = await supabase
      .from("automation_rejected_candidates")
      .update({ rescued_at: new Date().toISOString() })
      .eq("id", id);
    if (markError) throw new Error(`rescue mark failed: ${markError.message}`);
  }

  revalidatePath("/admin");
  revalidatePath("/scanner");
  revalidatePath("/admin/source-monitor");
  revalidatePublicSurfaces();
}

const OBSERVATION_DECISIONS = ["off_topic", "wrong_patch", "not_issue_report", "duplicate"] as const;

/**
 * Reject-and-teach for a public Wire/Asks item. One submit performs two
 * explicit, separately recorded acts inside one RPC transaction: a
 * reason-bearing hide of the observation and a block rule for future
 * discovery. Undo runs through the same generic undoScannerDecision path.
 */
export async function rejectObservationAndTeach(formData: FormData): Promise<void> {
  await requireAdmin();
  assertProductionWriteAllowed();
  const id = String(formData.get("id") ?? "").trim();
  const decision = String(formData.get("decision") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const scopeRaw = String(formData.get("scope") ?? "exact_url").trim();
  const scope: "exact_url" | "source_domain" | null =
    scopeRaw === "exact_url" ? "exact_url" : scopeRaw === "source_domain" ? "source_domain" : null;
  const confirmBroad = formData.get("confirm_broad") === "true";
  if (
    !id ||
    !(OBSERVATION_DECISIONS as readonly string[]).includes(decision) ||
    scope === null ||
    reason.length < 3 ||
    reason.length > 500 ||
    (scope !== "exact_url" && !confirmBroad)
  ) {
    throw new Error("bad input");
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("patch_observations")
    .select("id, url, source_domain, is_public")
    .eq("id", id)
    .limit(1);
  if (error) throw new Error(`observation read failed: ${error.message}`);
  const observation = (data ?? [])[0] as
    | { id: string; url: string; source_domain: string | null; is_public: boolean }
    | undefined;
  if (!observation) throw new Error("observation not found");

  const targetUrl = scannerRuleScopeValue("exact_url", {
    url: observation.url,
    sourceDomain: observation.source_domain,
  });
  const scopeValue = scannerRuleScopeValue(scope, {
    url: observation.url,
    sourceDomain: observation.source_domain,
  });
  if (!targetUrl || !scopeValue) throw new Error("bad input");

  const { error: decisionError } = await supabase.rpc("record_observation_decision", {
    p_observation_id: observation.id,
    p_target_url: targetUrl,
    p_target_url_hash: hashValue(targetUrl),
    p_source_domain: observation.source_domain,
    p_decision: decision,
    p_reason: reason,
    p_scope_type: scope,
    p_scope_value: scopeValue,
    p_confirm_broad: confirmBroad,
    p_expires_at: null,
  });
  if (decisionError) {
    // Surface the missing migration explicitly — the item must not appear to
    // have been moderated when nothing changed.
    if (isMissingSupabaseRpc(decisionError, "record_observation_decision")) {
      throw new Error(
        "Observation moderation needs the 20260724200000_observation_moderation migration; the item was not changed.",
      );
    }
    throw new Error(`observation decision write failed: ${decisionError.message}`);
  }

  revalidatePath("/admin");
  revalidatePath("/scanner");
  revalidatePath("/admin/source-monitor");
  revalidatePublicSurfaces();
}

/** Compatibility action for older forms: Rescue now records a durable Relevant decision. */
export async function rescueRejectedCandidate(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "").trim();
  if (!id) throw new Error("bad input");
  const decisionForm = new FormData();
  decisionForm.set("id", id);
  decisionForm.set("decision", "relevant");
  decisionForm.set("reason", "Operator reviewed this candidate and marked it relevant.");
  decisionForm.set("scope", "exact_url");
  await recordScannerDecision(decisionForm);
}

export async function undoScannerDecision(formData: FormData): Promise<void> {
  await requireAdmin();
  assertProductionWriteAllowed();
  const decisionId = String(formData.get("decision_id") ?? "").trim();
  if (!decisionId) throw new Error("bad input");
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("undo_scanner_decision", {
    p_decision_id: decisionId,
  });
  if (error) throw new Error(`scanner decision undo failed: ${error.message}`);
  const outcome = ((data ?? [])[0] as {
    undone?: boolean;
    affected_cluster_id?: string | null;
  } | undefined);
  if (outcome?.undone !== true) throw new Error("scanner decision was already undone or not found");
  if (outcome.affected_cluster_id) await refreshClusterVisibility(outcome.affected_cluster_id);
  revalidatePath("/admin");
  revalidatePath("/scanner");
  revalidatePath("/admin/source-monitor");
  revalidatePublicSurfaces();
}
