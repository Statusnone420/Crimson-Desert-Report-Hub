import "server-only";

import { unstable_cache } from "next/cache";
import { countBy, rankClusters } from "@/lib/aggregates";
import { evaluateCurrentPatchEligibility } from "@/lib/automation/eligibility";
import { circuitReadStartIso, llmPausedFromCircuitRead, type CircuitRunRow } from "@/lib/automation/circuit";
import { hasUnsupportedSourceContext } from "@/lib/automation/relevance";
import { getAutomationControlState, type AutomationSettingsClient } from "@/lib/automation/settings";
import { PUBLIC_DASHBOARD_TAG, PUBLIC_ISSUES_TAG } from "@/lib/cacheTags";
import { computeClusterConfirmations, type ClusterConfirmations, type ConfirmationRow } from "@/lib/confirmations";
import { getClaimedFixesForCurrentPatch, getCurrentPatchMetadata } from "@/lib/officialPatch.server";
import {
  belongsToPatchFamily,
  isPostCurrentPatchEvidence,
  matchesPatchVersion,
  patchFamilyKey,
  type PatchContext,
} from "@/lib/patchWatch";
import { composeIssueReadout, DISPLAY_THRESHOLD_NETWORKS, type IssueReadout } from "@/lib/readout";
import { createServiceClient, hasSupabaseServiceConfig } from "@/lib/supabase";

export type ClusterRow = {
  id: string;
  slug: string;
  title: string;
  category: string;
  description: string;
  fix_status: string;
  fix_claimed_at?: string | null;
  fix_claimed_patch_version?: string | null;
  admin_override?: boolean | null;
  lifecycle_reason?: string | null;
  confidence: string;
  is_public: boolean;
};

type DashboardReportRow = {
  category: string | null;
  platform: string | null;
  created_at: string;
  patch_version: string;
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
  reddit_posts_seen: number;
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

export type PublicFinding = {
  id: string;
  title: string;
  summary: string;
  source: string;
  sourceUrl: string;
  sourceHost: string;
  confidence: "low" | "medium" | "high";
  observedAt: string;
  clusterId: string | null;
};

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
  bug_reports: RelatedReport<{ cluster_id: string | null; platform: string | null; patch_version: string | null }>;
};

export type VerifiedReportClusterRow = {
  report_id: string;
  bug_reports: RelatedReport<{ cluster_id: string | null }>;
};

function countClusterIds(rows: { cluster_id: string | null }[]): Record<string, number> {
  return countBy(rows, (row) => row.cluster_id);
}

export function countRowsAtOrAfterClaimByCluster<T extends { cluster_id: string | null }>(
  rows: T[],
  fixClaimedAtByCluster: Record<string, string | null>,
  evidenceTime: (row: T) => string | null | undefined,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (!row.cluster_id) continue;
    const claimedAt = fixClaimedAtByCluster[row.cluster_id];
    const happenedAt = evidenceTime(row);
    if (!claimedAt || !happenedAt) continue;
    const claimTime = new Date(claimedAt).getTime();
    const evidenceTimestamp = new Date(happenedAt).getTime();
    if (!Number.isFinite(claimTime) || !Number.isFinite(evidenceTimestamp) || evidenceTimestamp < claimTime) continue;
    counts[row.cluster_id] = (counts[row.cluster_id] ?? 0) + 1;
  }
  return counts;
}

export function groupConfirmationRowsByCluster(rows: ConfirmationRow[]): Record<string, ConfirmationRow[]> {
  const grouped: Record<string, ConfirmationRow[]> = {};
  for (const row of rows) {
    (grouped[row.cluster_id] ??= []).push(row);
  }
  return grouped;
}

export function reportPlatformCountsByCluster(
  rows: { cluster_id: string | null; platform: string | null }[],
): Record<string, Record<string, number>> {
  const counts: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    if (!row.cluster_id || !row.platform) continue;
    const platformCounts = (counts[row.cluster_id] ??= {});
    platformCounts[row.platform] = (platformCounts[row.platform] ?? 0) + 1;
  }
  return counts;
}

/**
 * Raw confirmation rows for the current patch family, grouped per cluster.
 * voter_ip_hash is consumed server-side for distinct-network tallies and never
 * reaches a page — only aggregated ClusterConfirmations leave this module.
 */
export async function readConfirmationRowsByClusterForPatchFamily(
  supabase: ReturnType<typeof createServiceClient>,
  currentPatchVersion: string,
): Promise<Record<string, ConfirmationRow[]>> {
  const family = patchFamilyKey(currentPatchVersion) ?? currentPatchVersion;
  const pageSize = 1000;
  const rows: ConfirmationRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("issue_confirmations")
      .select("id, cluster_id, platform, kind, voter_ip_hash, created_at")
      .eq("patch_family", family)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) {
      // The branch can render before its migration is applied; other read errors should stay visible.
      if (error.code === "42P01") return {};
      throw new Error(`confirmation rows read failed: ${error.message}`);
    }
    const page = (data ?? []) as ConfirmationRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return groupConfirmationRowsByCluster(rows);
}

export function filterPatchFamilyReports<T extends { patch_version: string | null }>(
  rows: T[],
  currentPatch: PatchContext,
): T[] {
  return rows.filter((row) => Boolean(row.patch_version && belongsToPatchFamily(row.patch_version, currentPatch.version)));
}

export function filterExactPatchReports<T extends { patch_version: string | null }>(
  rows: T[],
  currentPatchVersion: string,
): T[] {
  // Intake accepts any trimmed spelling, so exact-patch evidence must compare
  // normalized version keys ("1.13.1" counts against "1.13.01"), matching the
  // family filters above.
  return rows.filter((row) => matchesPatchVersion(row.patch_version, currentPatchVersion));
}

export function latestReportAtFromRows<T extends { created_at: string }>(rows: T[]): string | null {
  return rows.reduce<string | null>((latest, row) => {
    if (!latest) return row.created_at;
    return new Date(row.created_at).getTime() > new Date(latest).getTime() ? row.created_at : latest;
  }, null);
}

export function countPostCurrentPatchReportsByCluster(
  rows: DashboardReportRow[],
  currentPatch: PatchContext,
): Record<string, number> {
  return countClusterIds(
    rows.filter((row) =>
      matchesPatchVersion(row.patch_version, currentPatch.version) &&
      isPostCurrentPatchEvidence({ sourcePublishedAt: row.created_at }, currentPatch),
    ),
  );
}

function countPostCurrentPatchSignalsByCluster(rows: SignalRow[], currentPatch: PatchContext): Record<string, number> {
  return countClusterIds(
    rows.filter((row) =>
      isPostCurrentPatchEvidence(
        { title: row.title ?? null, summary: row.summary, sourcePublishedAt: row.source_published_at ?? null },
        currentPatch,
      ),
    ),
  );
}

function sourceHost(url: string, fallback: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return fallback;
  }
}

export function publicFindingsFromSignals(rows: SignalRow[]): PublicFinding[] {
  return rows.map((row) => ({
    id: row.id,
    title: row.title?.trim() || row.summary,
    summary: row.summary,
    source: row.source,
    sourceUrl: row.source_url,
    sourceHost: sourceHost(row.source_url, row.source),
    confidence: row.confidence,
    observedAt: row.observed_at,
    clusterId: row.cluster_id,
  }));
}

function filterPublicCurrentPatchSignals<T extends SignalRow>(
  rows: T[],
  currentPatch: { version: string; publishedAt: string | null },
): T[] {
  return rows.filter((row) => {
    if (hasUnsupportedSourceContext({ title: row.title ?? "", snippet: row.summary, url: row.source_url })) {
      return false;
    }
    return evaluateCurrentPatchEligibility(
      { title: row.title ?? null, summary: row.summary, sourcePublishedAt: row.source_published_at ?? null },
      currentPatch,
    ).canPublish;
  });
}

type CandidateSignalRow = {
  cluster_id: string | null;
  title: string | null;
  summary: string;
  source_url: string;
  source_published_at: string | null;
};

export function countCurrentPatchCandidateSignalsByCluster(
  rows: CandidateSignalRow[],
  currentPatch: PatchContext,
): Record<string, number> {
  return countClusterIds(
    rows.filter((row) => {
      if (!row.cluster_id) return false;
      if (hasUnsupportedSourceContext({ title: row.title ?? "", snippet: row.summary, url: row.source_url })) {
        return false;
      }
      return evaluateCurrentPatchEligibility(
        { title: row.title, summary: row.summary, sourcePublishedAt: row.source_published_at },
        currentPatch,
      ).canStore;
    }),
  );
}

/** Private text is read only for current-patch eligibility; only cluster counts leave this server module. */
async function getCandidateSignalCountsByCluster(
  supabase: ReturnType<typeof createServiceClient>,
  currentPatch: PatchContext,
): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from("source_signals")
    .select("cluster_id, title, summary, source_url, source_published_at")
    .eq("public_status", "private");
  if (error) throw new Error(`candidate signals read failed: ${error.message}`);
  return countCurrentPatchCandidateSignalsByCluster((data ?? []) as CandidateSignalRow[], currentPatch);
}

function relatedReport<T>(value: RelatedReport<T>): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export function excerptsByClusterForCurrentPatch(
  rows: ExcerptRow[],
  currentPatch: PatchContext,
  limit = 100,
): Record<string, { text: string; platform: string }[]> {
  const excerptsByCluster: Record<string, { text: string; platform: string }[]> = {};
  let kept = 0;
  for (const excerpt of rows) {
    if (kept >= limit) break;
    const report = relatedReport(excerpt.bug_reports);
    if (!report?.patch_version || !belongsToPatchFamily(report.patch_version, currentPatch.version)) continue;
    const key = report.cluster_id ?? "unclustered";
    (excerptsByCluster[key] ??= []).push({
      text: excerpt.excerpt_text,
      platform: report.platform ?? "other",
    });
    kept += 1;
  }
  return excerptsByCluster;
}

export async function readExcerptsByClusterForCurrentPatch(
  supabase: ReturnType<typeof createServiceClient>,
  currentPatch: PatchContext,
  limit = 100,
): Promise<Record<string, { text: string; platform: string }[]>> {
  const pageSize = 1000;
  const rows: ExcerptRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("approved_excerpts")
      .select("excerpt_text, created_at, bug_reports(cluster_id, platform, patch_version)")
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) break;
    const page = (data ?? []) as ExcerptRow[];
    rows.push(...page);
    const grouped = excerptsByClusterForCurrentPatch(rows, currentPatch, limit);
    const kept = Object.values(grouped).reduce((sum, clusterRows) => sum + clusterRows.length, 0);
    if (kept >= limit || page.length < pageSize) return grouped;
  }
  return excerptsByClusterForCurrentPatch(rows, currentPatch, limit);
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

type ClusterCounts = {
  signalCount: number;
  directReportCount: number;
  verifiedReportCount?: number;
  candidateSignalCount: number;
  postCurrentPatchReportCount: number;
  postCurrentPatchSignalCount: number;
  postClaimEvidenceCount: number;
  confirmationRows: ConfirmationRow[];
  reportPlatformCounts: Record<string, number>;
  patchVersion: string;
};

export type DecoratedCluster = ClusterRow & {
  count: number;
  signalCount: number;
  directReportCount: number;
  verifiedReportCount: number;
  candidateSignalCount: number;
  postCurrentPatchReportCount: number;
  postCurrentPatchSignalCount: number;
  postCurrentPatchEvidenceCount: number;
  confirmations: ClusterConfirmations;
  reportPlatformCounts: Record<string, number>;
  readout: IssueReadout;
  strengthScore: number;
};

/** One decoration path for dashboard + issues: counts in, readout out. */
function decorateCluster(cluster: ClusterRow & { count: number }, counts: ClusterCounts): DecoratedCluster {
  const fixClaimedAt =
    cluster.fix_claimed_patch_version === counts.patchVersion ? cluster.fix_claimed_at ?? null : null;
  const confirmations = computeClusterConfirmations(counts.confirmationRows, fixClaimedAt);
  const postCurrentPatchEvidenceCount = counts.postCurrentPatchReportCount + counts.postCurrentPatchSignalCount;
  const readout = composeIssueReadout({
    directReportCount: counts.directReportCount,
    publicSignalCount: counts.signalCount,
    candidateSignalCount: counts.candidateSignalCount,
    postClaimEvidenceCount: counts.postClaimEvidenceCount,
    confirmations,
    fixClaimedAt,
    adminOverride: Boolean(cluster.admin_override),
    storedFixStatus: cluster.fix_status,
    patchVersion: counts.patchVersion,
  });
  // Confirmations join the ranking only once their tally is escalated (>= threshold networks).
  const escalatedConfirms = confirmations.affectedNetworks >= DISPLAY_THRESHOLD_NETWORKS ? confirmations.affectedCount : 0;
  return {
    ...cluster,
    count: counts.directReportCount,
    signalCount: counts.signalCount,
    directReportCount: counts.directReportCount,
    verifiedReportCount: counts.verifiedReportCount ?? 0,
    candidateSignalCount: counts.candidateSignalCount,
    postCurrentPatchReportCount: counts.postCurrentPatchReportCount,
    postCurrentPatchSignalCount: counts.postCurrentPatchSignalCount,
    postCurrentPatchEvidenceCount,
    confirmations,
    reportPlatformCounts: counts.reportPlatformCounts,
    readout,
    strengthScore: counts.signalCount + counts.directReportCount * 3 + escalatedConfirms,
  };
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

export type PublicObservation = {
  id: string;
  kind: "patch_release" | "press_reception" | "fix_announcement" | "community_ask";
  title: string;
  url: string;
  sourceDomain: string | null;
  snippet: string | null;
  observedAt: string;
  seenCount: number;
};

type PatchObservationRow = {
  id: string;
  kind: PublicObservation["kind"];
  title: string;
  url: string;
  source_domain: string | null;
  snippet: string | null;
  observed_at: string;
  seen_count: number;
};

const PUBLIC_OBSERVATIONS_PER_LANE = 8;
const COVERAGE_OBSERVATION_KINDS: PublicObservation["kind"][] = [
  "patch_release",
  "press_reception",
  "fix_announcement",
];

/**
 * Observation lane read. Never throws: a missing table (migration not applied
 * yet) or any read error renders as an empty lane, not a broken brief.
 */
export async function getPublicObservations(
  supabase: ReturnType<typeof createServiceClient>,
  patchVersion: string,
): Promise<PublicObservation[]> {
  try {
    const selectColumns = "id, kind, title, url, source_domain, snippet, observed_at, seen_count";
    const [coverage, asks] = await Promise.all([
      supabase
        .from("patch_observations")
        .select(selectColumns)
        .eq("patch_version", patchVersion)
        .eq("is_public", true)
        .in("kind", COVERAGE_OBSERVATION_KINDS)
        .order("observed_at", { ascending: false })
        .limit(PUBLIC_OBSERVATIONS_PER_LANE),
      supabase
        .from("patch_observations")
        .select(selectColumns)
        .eq("patch_version", patchVersion)
        .eq("is_public", true)
        .eq("kind", "community_ask")
        .order("observed_at", { ascending: false })
        .limit(PUBLIC_OBSERVATIONS_PER_LANE),
    ]);
    if (coverage.error || asks.error) return [];
    return ([...(coverage.data ?? []), ...(asks.data ?? [])] as PatchObservationRow[])
      .sort((left, right) => new Date(right.observed_at).getTime() - new Date(left.observed_at).getTime())
      .map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        url: row.url,
        sourceDomain: row.source_domain,
        snippet: row.snippet,
        observedAt: row.observed_at,
        seenCount: row.seen_count,
      }));
  } catch {
    return [];
  }
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
      topClusters: [],
      pendingCount: 0,
      latestReportAt: null,
      scanner: { paused: false, updatedAt: null },
      latestAutomationRun: null,
      currentPatch: await getCurrentPatchMetadata(),
      claimedFixes: [],
      observations: [] as PublicObservation[],
      publicFindings: [],
    };
  }

  const supabase = createServiceClient();

  const { data: reports } = await supabase
    .from("bug_reports")
    .select("category, platform, created_at, patch_version, cluster_id, hardware_specs")
    .eq("moderation_status", "approved");
  const rows = (reports ?? []) as DashboardReportRow[];

  const { data: clusterData } = await supabase
    .from("issue_clusters")
    .select("id, slug, title, category, description, fix_status, fix_claimed_at, fix_claimed_patch_version, admin_override, lifecycle_reason, confidence, is_public")
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

  const [scanner, latestAutomation, currentPatch, claimedFixes] = await Promise.all([
    getAutomationControlState(supabase as unknown as AutomationSettingsClient),
    supabase
      .from("automation_runs")
      .select(
        "started_at, status, mode, search_queries_used, llm_calls_used, signals_inserted, clusters_promoted, search_results_seen, reddit_posts_seen, signals_reobserved, stale_signals_hidden, candidates_rescued, finished_at",
      )
      .neq("mode", "dry_run")
      .in("status", ["success", "partial", "failed"])
      .order("started_at", { ascending: false })
      .limit(1),
    getCurrentPatchMetadata(supabase),
    getClaimedFixesForCurrentPatch(supabase),
  ]);
  const candidateSignalCounts = await getCandidateSignalCountsByCluster(supabase, currentPatch);
  const observations = await getPublicObservations(supabase, currentPatch.version);
  const signalRows = filterPublicCurrentPatchSignals(rawSignalRows, currentPatch);
  const currentReportRows = filterPatchFamilyReports(rows, currentPatch);
  const confirmationsByCluster = await readConfirmationRowsByClusterForPatchFamily(supabase, currentPatch.version);
  const publicClusters = (clusterData ?? []) as ClusterRow[];
  const fixClaimedAtByCluster = Object.fromEntries(
    publicClusters.map((cluster) => [
      cluster.id,
      cluster.fix_claimed_patch_version === currentPatch.version ? cluster.fix_claimed_at ?? null : null,
    ]),
  );

  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const directByCluster = countClusterIds(currentReportRows);
  const signalByCluster = countClusterIds(signalRows);
  const platformCountsByCluster = reportPlatformCountsByCluster(currentReportRows);
  const postCurrentPatchReportByCluster = countPostCurrentPatchReportsByCluster(currentReportRows, currentPatch);
  const postCurrentPatchSignalByCluster = countPostCurrentPatchSignalsByCluster(signalRows, currentPatch);
  const postClaimReportByCluster = countRowsAtOrAfterClaimByCluster(
    filterExactPatchReports(currentReportRows, currentPatch.version),
    fixClaimedAtByCluster,
    (row) => row.created_at,
  );
  const verifiedByCluster = countDistinctVerifiedReportsByCluster(verifiedRows);
  const verifiedReportCount = new Set(verifiedRows.map((row) => row.report_id)).size;
  const topClusters = rankClusters(publicClusters, rows)
    .map((cluster) =>
      decorateCluster(cluster, {
        signalCount: signalByCluster[cluster.id] ?? 0,
        directReportCount: directByCluster[cluster.id] ?? 0,
        verifiedReportCount: verifiedByCluster[cluster.id] ?? 0,
        candidateSignalCount: candidateSignalCounts[cluster.id] ?? 0,
        postCurrentPatchReportCount: postCurrentPatchReportByCluster[cluster.id] ?? 0,
        postCurrentPatchSignalCount: postCurrentPatchSignalByCluster[cluster.id] ?? 0,
        postClaimEvidenceCount: postClaimReportByCluster[cluster.id] ?? 0,
        confirmationRows: confirmationsByCluster[cluster.id] ?? [],
        reportPlatformCounts: platformCountsByCluster[cluster.id] ?? {},
        patchVersion: currentPatch.version,
      }),
    )
    .sort((a, b) => b.strengthScore - a.strengthScore);

  return {
    total: currentReportRows.length,
    communitySignals: signalRows.length,
    directReports: currentReportRows.length,
    verifiedReports: verifiedReportCount,
    weekDelta: currentReportRows.filter((row) => new Date(row.created_at).getTime() > weekAgo).length,
    byCategory: countBy(currentReportRows, (row) => row.category),
    signalByCategory: countBy(signalRows, (row) => row.category),
    platforms: countBy(currentReportRows, (row) => row.platform),
    gpus: countGpus(currentReportRows),
    topClusters,
    pendingCount: pendingCount ?? 0,
    latestReportAt: latestReportAtFromRows(currentReportRows),
    scanner,
    latestAutomationRun: ((latestAutomation.data ?? []) as PublicAutomationRunRow[])[0] ?? null,
    currentPatch,
    claimedFixes,
    observations,
    publicFindings: publicFindingsFromSignals(signalRows).slice(0, 6),
  };
}

export const getDashboardData = unstable_cache(getDashboardDataUncached, ["dashboard-data"], {
  revalidate: 300,
  tags: [PUBLIC_DASHBOARD_TAG],
});

async function getIssuesDataUncached() {
  if (!hasSupabaseServiceConfig()) {
    return {
      clusters: [] as DecoratedCluster[],
      excerptsByCluster: {} as Record<string, { text: string; platform: string }[]>,
      signalsByCluster: {} as Record<string, SignalRow[]>,
      currentPatch: await getCurrentPatchMetadata(),
    };
  }

  const supabase = createServiceClient();

  const { data: clusterData } = await supabase
    .from("issue_clusters")
    .select("id, slug, title, category, description, fix_status, fix_claimed_at, fix_claimed_patch_version, admin_override, lifecycle_reason, confidence, is_public")
    .eq("is_public", true);

  const { data: reports } = await supabase
    .from("bug_reports")
    .select("cluster_id, platform, patch_version, created_at")
    .eq("moderation_status", "approved");
  const reportRows = (reports ?? []) as DashboardReportRow[];

  const { data: signals } = await supabase
    .from("source_signals")
    .select("id, cluster_id, source, source_url, title, summary, category, confidence, observed_at, source_published_at, public_status")
    .eq("public_status", "public")
    .order("observed_at", { ascending: false });
  const currentPatch = await getCurrentPatchMetadata(supabase);
  const signalRows = filterPublicCurrentPatchSignals((signals ?? []) as SignalRow[], currentPatch);
  const currentReportRows = filterPatchFamilyReports(reportRows, currentPatch);
  const publicClusters = (clusterData ?? []) as ClusterRow[];
  const fixClaimedAtByCluster = Object.fromEntries(
    publicClusters.map((cluster) => [
      cluster.id,
      cluster.fix_claimed_patch_version === currentPatch.version ? cluster.fix_claimed_at ?? null : null,
    ]),
  );

  const candidateSignalCounts = await getCandidateSignalCountsByCluster(supabase, currentPatch);
  const confirmationsByCluster = await readConfirmationRowsByClusterForPatchFamily(supabase, currentPatch.version);

  const directByCluster = countClusterIds(currentReportRows);
  const signalByCluster = countClusterIds(signalRows);
  const platformCountsByCluster = reportPlatformCountsByCluster(currentReportRows);
  const postCurrentPatchReportByCluster = countPostCurrentPatchReportsByCluster(currentReportRows, currentPatch);
  const postCurrentPatchSignalByCluster = countPostCurrentPatchSignalsByCluster(signalRows, currentPatch);
  const postClaimReportByCluster = countRowsAtOrAfterClaimByCluster(
    filterExactPatchReports(currentReportRows, currentPatch.version),
    fixClaimedAtByCluster,
    (row) => row.created_at,
  );
  const clusters = rankClusters(publicClusters, currentReportRows)
    .map((cluster) =>
      decorateCluster(cluster, {
        signalCount: signalByCluster[cluster.id] ?? 0,
        directReportCount: directByCluster[cluster.id] ?? 0,
        candidateSignalCount: candidateSignalCounts[cluster.id] ?? 0,
        postCurrentPatchReportCount: postCurrentPatchReportByCluster[cluster.id] ?? 0,
        postCurrentPatchSignalCount: postCurrentPatchSignalByCluster[cluster.id] ?? 0,
        postClaimEvidenceCount: postClaimReportByCluster[cluster.id] ?? 0,
        confirmationRows: confirmationsByCluster[cluster.id] ?? [],
        reportPlatformCounts: platformCountsByCluster[cluster.id] ?? {},
        patchVersion: currentPatch.version,
      }),
    )
    .sort((a, b) => b.strengthScore - a.strengthScore);

  const signalsByCluster: Record<string, SignalRow[]> = {};
  for (const signal of signalRows) {
    const key = signal.cluster_id ?? "unclustered";
    (signalsByCluster[key] ??= []).push(signal);
  }

  const excerptsByCluster = await readExcerptsByClusterForCurrentPatch(supabase, currentPatch);

  return { clusters, excerptsByCluster, signalsByCluster, currentPatch };
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
  scannerConnected: boolean;
  /** The cost-safety circuit is open right now — the same evaluation the next scan will make. */
  llmPaused: boolean;
};

/**
 * Aggregate-only scanner counts for the public /scanner tab. Public and private
 * source text is read server-side only to enforce current-patch eligibility; no
 * title, URL, summary, rejection reason, or candidate row leaves this function.
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
    scannerConnected: false,
    llmPaused: false,
  };
  if (!hasSupabaseServiceConfig()) return empty;

  try {
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

    // Same rolling-history evaluation the automation engine uses, so the badge
    // can never disagree with whether the next scan will actually call the LLM.
    // A failed read fails closed here for the same reason it does in the engine.
    const now = new Date();
    const { data: circuitData, error: circuitError } = await supabase
      .from("automation_runs")
      .select("skips, started_at")
      .gte("started_at", circuitReadStartIso(now));
    const llmPaused = llmPausedFromCircuitRead(circuitData as CircuitRunRow[] | null, circuitError, now);

    const currentPatch = await getCurrentPatchMetadata(supabase);
    const { data: publicSignalData } = await supabase
      .from("source_signals")
      .select("cluster_id, title, summary, source_url, source_published_at")
      .eq("public_status", "public");
    const publicSignalClusters = new Set<string>();
    for (const signal of filterPublicCurrentPatchSignals((publicSignalData ?? []) as SignalRow[], currentPatch)) {
      if (signal.cluster_id) publicSignalClusters.add(signal.cluster_id);
    }
    const privateSignalClusters = new Set(Object.keys(await getCandidateSignalCountsByCluster(supabase, currentPatch)));

    const { data: reportData } = await supabase
      .from("bug_reports")
      .select("cluster_id, patch_version")
      .eq("moderation_status", "approved");
    const approvedReportClusters = new Set<string>();
    for (const report of filterPatchFamilyReports(
      (reportData ?? []) as { cluster_id: string | null; patch_version: string | null }[],
      currentPatch,
    )) {
      if (report.cluster_id) approvedReportClusters.add(report.cluster_id);
    }

    const { data: clusterData } = await supabase.from("issue_clusters").select("id").eq("is_public", true);
    let published = 0;
    for (const cluster of (clusterData ?? []) as { id: string }[]) {
      if (publicSignalClusters.has(cluster.id) || approvedReportClusters.has(cluster.id)) published += 1;
    }

    // Awaiting = current-patch eligible private-lead clusters not backed by a
    // public link or approved report, including clusters not yet public.
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
      scannerConnected: true,
      llmPaused,
    };
  } catch {
    return empty;
  }
}

export const getPublicScannerData = unstable_cache(getPublicScannerDataUncached, ["public-scanner-data"], {
  revalidate: 300,
  tags: [PUBLIC_DASHBOARD_TAG],
});
