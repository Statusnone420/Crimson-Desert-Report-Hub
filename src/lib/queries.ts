import "server-only";
import {
  isBriefRenderableObservation,
  OBSERVATION_FUTURE_SKEW_MS,
  patchEraFloorMs,
} from "@/lib/observationDisplay";

import { unstable_cache } from "next/cache";
import { countBy, rankClusters } from "@/lib/aggregates";
import { needsFullIssueCard } from "@/lib/evidence";
import { isProviderContextSource } from "@/lib/automation/domains";
import { evaluateCurrentPatchEligibility } from "@/lib/automation/eligibility";
import { circuitReadStartIso, llmPausedFromCircuitRead, type CircuitRunRow } from "@/lib/automation/circuit";
import { readActiveFeedbackRulePages } from "@/lib/automation/feedbackRules.server";
import { hasCrimsonDesertContext, hasUnsupportedSourceContext } from "@/lib/automation/relevance";
import { getAutomationControlState, type AutomationSettingsClient } from "@/lib/automation/settings";
import { PUBLIC_DASHBOARD_TAG, PUBLIC_ISSUES_TAG } from "@/lib/cacheTags";
import { computeClusterConfirmations, type ClusterConfirmations, type ConfirmationRow } from "@/lib/confirmations";
import { getCurrentPatchMetadata, readClaimedFixesForCurrentPatch } from "@/lib/officialPatch.server";
import { displayCandidateCount } from "@/lib/observatoryMetrics";
import {
  canonicalIgdbUrl,
  platformContextIsStale,
  type TwitchHistoryPoint,
} from "@/lib/platformPulseDisplay";
import {
  belongsToPatchFamily,
  isPostCurrentPatchEvidence,
  matchesPatchVersion,
  patchFamilyKey,
  type PatchContext,
} from "@/lib/patchWatch";
import { composeIssueReadout, DISPLAY_THRESHOLD_NETWORKS, type IssueReadout } from "@/lib/readout";
import { SCANNER_READ_REGISTERS, type ScannerReadRegister } from "@/lib/scannerRegisters";
import { createServiceClient, hasSupabaseServiceConfig } from "@/lib/supabase";
import { isMissingSupabaseColumn, isMissingSupabaseRelation } from "@/lib/supabaseCompatibility";

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

type PublicSignalEligibilityRow = Pick<
  SignalRow,
  "cluster_id" | "source" | "source_url" | "title" | "summary" | "source_published_at"
>;

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
  run_id: string | null;
  title: string;
  url: string;
  source_domain: string | null;
  source_published_at: string | null;
  snippet: string | null;
  reason: string;
  created_at: string;
  expires_at: string;
  rescued_at: string | null;
  decision_id: string | null;
  feedback_rule_id: string | null;
};

export type ScannerFeedbackRuleRow = {
  id: string;
  decision_id: string;
  action: "allow" | "block";
  decision: "relevant" | "off_topic" | "wrong_patch" | "not_issue_report" | "duplicate";
  scope_type: "exact_url" | "source_path" | "source_domain";
  scope_value: string;
  reason: string;
  created_at: string;
  expires_at: string | null;
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
  funnel: Record<string, number> | null;
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

export function filterPublicCurrentPatchSignals<T extends PublicSignalEligibilityRow>(
  rows: T[],
  currentPatch: { version: string; publishedAt: string | null },
): T[] {
  return rows.filter((row) => {
    // Provider context — Steam reviews and the publisher's own pages — can seed
    // private radar questions and the aggregate Pulse, but it is never a
    // standalone public evidence/source card. Shared predicate: this must not
    // drift from the promotion engine's boundary.
    if (isProviderContextSource({ source: row.source, url: row.source_url })) return false;
    if (!hasCrimsonDesertContext({
      title: row.title ?? "",
      snippet: row.summary,
      url: row.source_url,
      sourceDomain: null,
    })) {
      return false;
    }
    if (hasUnsupportedSourceContext({ title: row.title ?? "", snippet: row.summary, url: row.source_url })) {
      return false;
    }
    return evaluateCurrentPatchEligibility(
      { title: row.title ?? null, summary: row.summary, sourcePublishedAt: row.source_published_at ?? null },
      currentPatch,
    ).canPublish;
  });
}

export async function getPublicSignalClusterIdsForCurrentPatch(
  supabase: ReturnType<typeof createServiceClient>,
  currentPatch: PatchContext,
): Promise<Set<string>> {
  // An empty set here is not a harmless default: every private-lead cluster then
  // looks uncorroborated, so a failed read would inflate "awaiting" rather than
  // zero it. Surface it and let the caller decide.
  const { data, error } = await supabase
    .from("source_signals")
    .select("cluster_id, source, title, summary, source_url, source_published_at")
    .eq("public_status", "public");
  if (error) throw new Error(`public signal clusters read failed: ${error.message}`);
  const clusterIds = new Set<string>();
  for (const signal of filterPublicCurrentPatchSignals(
    (data ?? []) as PublicSignalEligibilityRow[],
    currentPatch,
  )) {
    if (signal.cluster_id) clusterIds.add(signal.cluster_id);
  }
  return clusterIds;
}

type CandidateSignalRow = {
  id?: string;
  cluster_id: string | null;
  source: string | null;
  source_type: string | null;
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
      if (isProviderContextSource({ source: row.source, sourceType: row.source_type, url: row.source_url })) {
        return false;
      }
      if (!hasCrimsonDesertContext({
        title: row.title ?? "",
        snippet: row.summary,
        url: row.source_url,
        sourceDomain: null,
      })) {
        return false;
      }
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
export async function getCandidateSignalCountsByCluster(
  supabase: ReturnType<typeof createServiceClient>,
  currentPatch: PatchContext,
): Promise<Record<string, number>> {
  const pageSize = 1000;
  const rows: CandidateSignalRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("source_signals")
      .select("id, cluster_id, source, source_type, title, summary, source_url, source_published_at")
      .eq("public_status", "private")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`candidate signals read failed: ${error.message}`);
    const page = (data ?? []) as CandidateSignalRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return countCurrentPatchCandidateSignalsByCluster(rows, currentPatch);
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
  publicSignalsUnavailable: boolean;
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
    publicSignalsUnavailable: counts.publicSignalsUnavailable,
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

/**
 * Which clock a lane item is showing, carried in the data rather than inferred
 * at render time. `published` is the source's own publication date.
 * `first_seen_by_radar` is the row's URL-bound `created_at` — when the scanner
 * first saw the current thread. A serialized campaign rebinds it when its row
 * advances to a new URL. It is never described as a publication date anywhere
 * it surfaces.
 */
export type PublicObservationTimestamp =
  | { kind: "published"; value: string }
  | { kind: "first_seen_by_radar"; value: string };

export type PublicObservation = {
  id: string;
  kind: "patch_release" | "press_reception" | "fix_announcement" | "community_ask";
  title: string;
  url: string;
  sourceDomain: string | null;
  snippet: string | null;
  timestamp: PublicObservationTimestamp;
  observedAt: string;
  seenCount: number;
};

/** A lane item that is guaranteed to be carrying a real publication date. */
export type PublishedObservation = PublicObservation & {
  timestamp: Extract<PublicObservationTimestamp, { kind: "published" }>;
};

export type PublicObservationLanes = {
  /** From the Wire: third-party coverage of the current patch. Dated by the source, always. */
  coverage: PublishedObservation[];
  /** Community Asks: player requests — their own lane, never mixed with coverage. */
  asks: PublicObservation[];
};

type PatchObservationRow = {
  id: string;
  kind: PublicObservation["kind"];
  title: string;
  url: string;
  source_domain: string | null;
  snippet: string | null;
  source_published_at?: string | null;
  created_at?: string | null;
  observed_at: string;
  seen_count: number;
  is_public: boolean;
};

const PUBLIC_OBSERVATIONS_PER_LANE = 8;
const COVERAGE_OBSERVATION_KINDS: PublicObservation["kind"][] = [
  "patch_release",
  "press_reception",
  "fix_announcement",
];

function toPublicObservation(
  row: PatchObservationRow,
  timestamp: PublicObservationTimestamp,
): PublicObservation {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    url: row.url,
    sourceDomain: row.source_domain,
    snippet: row.snippet,
    timestamp,
    observedAt: row.observed_at,
    seenCount: row.seen_count,
  };
}

function byNewestTimestamp(left: PublicObservation, right: PublicObservation): number {
  return new Date(right.timestamp.value).getTime() - new Date(left.timestamp.value).getTime();
}

/**
 * Pure lane split for the Brief's context modules. Wire coverage and Community
 * Asks stay separate genres — and, since this PR, separate CLOCKS.
 *
 * From the Wire is press coverage: an article without a publication date cannot
 * be placed in the patch's timeline honestly, so the lane still requires one and
 * still sorts by it. Scanner discovery time never appears here.
 *
 * Community Asks are player threads, and the search provider almost never dates
 * them. Requiring a publication date emptied the lane of real, live campaigns.
 * An undated ask therefore renders on its first-discovery time instead — the
 * current URL's `created_at`, labelled as such, never copied into
 * `source_published_at` and never called published. Serialized campaign rows
 * rebind that clock when their representative URL changes. It may only do so
 * inside the current patch's era, and not at all when the patch publication
 * time is unknown (fail closed).
 */
export function splitPublicObservationLanes(
  rows: PatchObservationRow[],
  patch: { version: string; publishedAt: string | null },
  nowMs: number = Date.now(),
): PublicObservationLanes {
  const coverage: PublishedObservation[] = [];
  const asks: PublicObservation[] = [];

  for (const row of rows) {
    if (!isBriefRenderableObservation(row, patch, nowMs)) continue;
    if (row.kind !== "community_ask") {
      if (row.source_published_at) {
        coverage.push(
          toPublicObservation(row, { kind: "published", value: row.source_published_at }) as PublishedObservation,
        );
      }
      continue;
    }
    if (row.source_published_at) {
      asks.push(toPublicObservation(row, { kind: "published", value: row.source_published_at }));
      continue;
    }
    asks.push(toPublicObservation(row, { kind: "first_seen_by_radar", value: row.created_at as string }));
  }

  return {
    coverage: coverage.sort(byNewestTimestamp).slice(0, PUBLIC_OBSERVATIONS_PER_LANE),
    asks: asks.sort(byNewestTimestamp).slice(0, PUBLIC_OBSERVATIONS_PER_LANE),
  };
}

export const EMPTY_OBSERVATION_LANES: PublicObservationLanes = { coverage: [], asks: [] };

/**
 * Observation lane read. Never throws: a missing table (migration not applied
 * yet) or any read error renders as empty lanes, not a broken brief.
 */
export async function getPublicObservations(
  supabase: ReturnType<typeof createServiceClient>,
  patch: { version: string; publishedAt: string | null },
): Promise<PublicObservationLanes> {
  try {
    // `is_public` is read back, not assumed from the filter below: the lane
    // split re-checks every gate itself so it stays the single answer to
    // "would this render", wherever its rows came from.
    const selectColumns =
      "id, kind, title, url, source_domain, snippet, source_published_at, created_at, observed_at, seen_count, is_public";
    // Both date gates also run server-side, before the per-lane limit: a batch
    // of nonsense far-future provider dates would otherwise sort first, consume
    // the limit, then be dropped client-side — starving the lane of valid rows.
    const nowMs = Date.now();
    const latestAllowedIso = new Date(nowMs + OBSERVATION_FUTURE_SKEW_MS).toISOString();
    const eraFloorMs = patchEraFloorMs(patch.publishedAt);
    const eraStartIso = Number.isFinite(eraFloorMs) ? new Date(eraFloorMs).toISOString() : null;
    const laneBase = (kinds: PublicObservation["kind"][]) =>
      supabase
        .from("patch_observations")
        .select(selectColumns)
        .eq("patch_version", patch.version)
        .eq("is_public", true)
        .in("kind", kinds);
    const datedQuery = (kinds: PublicObservation["kind"][]) => {
      const dated = laneBase(kinds)
        .not("source_published_at", "is", null)
        .lte("source_published_at", latestAllowedIso);
      return (eraStartIso ? dated.gte("source_published_at", eraStartIso) : dated)
        .order("source_published_at", { ascending: false })
        .limit(PUBLIC_OBSERVATIONS_PER_LANE);
    };
    // Undated asks, newest discovery first. Bounded server-side by `eraStartIso`
    // — the parsed, normalized era floor, never the raw `patch.publishedAt`,
    // which may be a string the database cannot compare and would fail the whole
    // read. A null floor means the patch publication time is missing or
    // malformed, so ONLY this lane stands down: the fail-closed answer the split
    // gives anyway, reached without spending a query. The dated lanes above are
    // unaffected and still return their rows. The exact publication time (not
    // the floored day) is re-applied per row in the split, so this bound is a
    // pre-filter, never the rule.
    const undatedAsksQuery = eraStartIso
      ? laneBase(["community_ask"])
          .is("source_published_at", null)
          .gte("created_at", eraStartIso)
          .lte("created_at", latestAllowedIso)
          .order("created_at", { ascending: false })
          .limit(PUBLIC_OBSERVATIONS_PER_LANE)
      : null;
    const [coverage, asks, undatedAsks] = await Promise.all([
      datedQuery(COVERAGE_OBSERVATION_KINDS),
      datedQuery(["community_ask"]),
      undatedAsksQuery ?? Promise.resolve({ data: [], error: null }),
    ]);
    if (coverage.error || asks.error || undatedAsks.error) return EMPTY_OBSERVATION_LANES;
    return splitPublicObservationLanes(
      [
        ...(coverage.data ?? []),
        ...(asks.data ?? []),
        ...(undatedAsks.data ?? []),
      ] as PatchObservationRow[],
      patch,
      nowMs,
    );
  } catch {
    return EMPTY_OBSERVATION_LANES;
  }
}

/**
 * House rule (see readConfirmationRowsByClusterForPatchFamily): a failed read
 * throws — it never flattens into an empty success that renders as a zero.
 */
function requireRows<T>(what: string, result: { data: T[] | null; error: { message?: string | null } | null }): T[] {
  if (result.error) throw new Error(`${what} read failed: ${result.error.message ?? "unknown error"}`);
  return result.data ?? [];
}

/**
 * Scanner run history is context, not evidence. Its failure degrades to the
 * existing "no recorded run" state on its own — it must not flip the whole
 * board to evidence-unavailable and hide validly read reports and issues.
 */
function latestAutomationRunOrNull(result: {
  data: unknown[] | null;
  error: { message?: string | null } | null;
}): PublicAutomationRunRow | null {
  if (result.error) {
    console.error("[dashboard] automation-run read failed; showing no recorded run", result.error);
    return null;
  }
  return ((result.data ?? []) as PublicAutomationRunRow[])[0] ?? null;
}

/**
 * One shape for both "this environment has no database" and "the database
 * could not be read". Only the flag differs: an unconfigured preview renders
 * a quiet board on purpose, while a failed read must render as unavailable —
 * fabricated zeros would tell readers the board is quiet when it is blind.
 *
 * Official claims and patch facts live in their own tables, independent of
 * the evidence store, so an evidence outage re-reads them through their own
 * path instead of erasing them. If that read fails too, claims stay [] and
 * an explicit availability flag keeps that failure distinct from a successful
 * zero-claim read.
 */
async function dashboardFallbackData(evidenceUnavailable: boolean) {
  let currentPatch: Awaited<ReturnType<typeof getCurrentPatchMetadata>> | null = null;
  let claims: Awaited<ReturnType<typeof readDashboardClaims>> = {
    claimedFixes: [],
    claimedFixTotal: null,
    claimsUnavailable: false,
  };
  if (evidenceUnavailable && hasSupabaseServiceConfig()) {
    const supabase = createServiceClient();
    currentPatch = await getCurrentPatchMetadata(supabase).catch(() => null);
    claims = await readDashboardClaims(supabase);
  }
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
    currentPatch: currentPatch ?? (await getCurrentPatchMetadata()),
    ...claims,
    observations: EMPTY_OBSERVATION_LANES,
    publicFindings: [],
    evidenceUnavailable,
    // A full evidence outage leaves the lead fields unread too; an
    // unconfigured environment reads neither, deliberately.
    sourceLeadsUnavailable: evidenceUnavailable,
    publicLeadsUnavailable: evidenceUnavailable,
  };
}

async function getDashboardDataUncached() {
  if (!hasSupabaseServiceConfig()) return dashboardFallbackData(false);
  try {
    return await readDashboardData();
  } catch (error) {
    console.error("[dashboard] evidence read failed; rendering the unavailable state, not zeros", error);
    return dashboardFallbackData(true);
  }
}

async function readDashboardClaims(supabase: ReturnType<typeof createServiceClient>) {
  try {
    const register = await readClaimedFixesForCurrentPatch(supabase);
    return {
      claimedFixes: register.fixes,
      claimedFixTotal: register.totalClaimedFixes,
      claimsUnavailable: false,
    };
  } catch (error) {
    console.error("[dashboard] official-claims read failed; claims unavailable, not zero", error);
    return {
      claimedFixes: [],
      claimedFixTotal: null,
      claimsUnavailable: true,
    };
  }
}

async function readDashboardData() {
  const supabase = createServiceClient();

  const rows = requireRows(
    "approved reports",
    await supabase
      .from("bug_reports")
      .select("category, platform, created_at, patch_version, cluster_id, hardware_specs")
      .eq("moderation_status", "approved"),
  ) as DashboardReportRow[];

  const clusterData = requireRows(
    "public clusters",
    await supabase
      .from("issue_clusters")
      .select("id, slug, title, category, description, fix_status, fix_claimed_at, fix_claimed_patch_version, admin_override, lifecycle_reason, confidence, is_public")
      .eq("is_public", true),
  );

  // Source signals are lead context, not player evidence: their failure
  // disables the lead-derived fields on their own instead of blanking the
  // validly read evidence board.
  const signalsRes = await supabase
    .from("source_signals")
    .select("id, cluster_id, source, source_url, title, summary, category, confidence, observed_at, source_published_at, public_status")
    .eq("public_status", "public");
  const sourceLeadsUnavailable = Boolean(signalsRes.error);
  if (signalsRes.error) {
    console.error("[dashboard] source-signal read failed; lead fields unavailable, evidence intact", signalsRes.error);
  }
  const rawSignalRows = (signalsRes.data ?? []) as SignalRow[];

  // Verified-excerpt and pending-moderation metrics are ancillary — neither
  // feeds readouts, ranking, or any homepage cell. They degrade on their own
  // (logged) instead of taking validly read evidence down with them.
  const verifiedRes = await supabase.from("approved_excerpts").select("report_id, bug_reports(cluster_id)").limit(1000);
  if (verifiedRes.error) {
    console.error("[dashboard] approved-excerpt read failed; verified metric unavailable", verifiedRes.error);
  }
  const verifiedRows = (verifiedRes.data ?? []) as VerifiedReportClusterRow[];

  const pendingRes = await supabase
    .from("bug_reports")
    .select("id", { count: "exact", head: true })
    .eq("moderation_status", "pending");
  if (pendingRes.error) {
    console.error("[dashboard] pending-count read failed; moderation metric unavailable", pendingRes.error);
  }
  const pendingCount = pendingRes.error ? null : pendingRes.count ?? 0;

  const [scanner, latestAutomation, currentPatch, claims] = await Promise.all([
    // Scanner configuration is provider context: its failure degrades to the
    // neutral control state (logged) instead of blanking the evidence board.
    getAutomationControlState(supabase as unknown as AutomationSettingsClient).catch((error: unknown) => {
      console.error("[dashboard] automation-settings read failed; showing neutral scanner state", error);
      return { paused: false, updatedAt: null };
    }),
    supabase
      .from("automation_runs")
      .select(
        "started_at, status, mode, search_queries_used, llm_calls_used, signals_inserted, clusters_promoted, search_results_seen, reddit_posts_seen, signals_reobserved, stale_signals_hidden, candidates_rescued, funnel, finished_at",
      )
      .neq("mode", "dry_run")
      .in("status", ["success", "partial", "failed"])
      .order("started_at", { ascending: false })
      .limit(1),
    getCurrentPatchMetadata(supabase),
    readDashboardClaims(supabase),
  ]);
  // Candidate counts read the same lead register; their failure folds into
  // the lead flag, not the evidence one. The shared reader keeps throwing for
  // callers that want the strict behavior.
  let candidateSignalCounts: Record<string, number> = {};
  let candidateLeadsFailed = false;
  try {
    candidateSignalCounts = await getCandidateSignalCountsByCluster(supabase, currentPatch);
  } catch (error) {
    candidateLeadsFailed = true;
    console.error("[dashboard] candidate-signal read failed; lead fields unavailable, evidence intact", error);
  }
  const observations = await getPublicObservations(supabase, {
    version: currentPatch.version,
    publishedAt: currentPatch.publishedAt ?? null,
  });
  const signalRows = filterPublicCurrentPatchSignals(rawSignalRows, currentPatch);
  const currentReportRows = filterPatchFamilyReports(rows, currentPatch);
  const confirmationsByCluster = await readConfirmationRowsByClusterForPatchFamily(supabase, currentPatch.version);
  const publicClusters = clusterData as ClusterRow[];
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
        publicSignalsUnavailable: sourceLeadsUnavailable,
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
    pendingCount,
    latestReportAt: latestReportAtFromRows(currentReportRows),
    scanner,
    latestAutomationRun: latestAutomationRunOrNull(latestAutomation),
    currentPatch,
    ...claims,
    observations,
    publicFindings: publicFindingsFromSignals(signalRows).slice(0, 6),
    evidenceUnavailable: false,
    sourceLeadsUnavailable: sourceLeadsUnavailable || candidateLeadsFailed,
    publicLeadsUnavailable: sourceLeadsUnavailable,
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

  // These three reads have always degraded to an empty board rather than
  // throwing, and changing that would alter how /issues and the homepage
  // behave. Instead the failure is reported alongside the data, so a caller
  // that must not publish an unread count — the scanner scoreboard's
  // `published` register — can tell "no public clusters" from "could not read".
  const { data: clusterData, error: clusterError } = await supabase
    .from("issue_clusters")
    .select("id, slug, title, category, description, fix_status, fix_claimed_at, fix_claimed_patch_version, admin_override, lifecycle_reason, confidence, is_public")
    .eq("is_public", true);

  const { data: reports, error: reportsError } = await supabase
    .from("bug_reports")
    .select("cluster_id, platform, patch_version, created_at")
    .eq("moderation_status", "approved");
  const reportRows = (reports ?? []) as DashboardReportRow[];

  const { data: signals, error: signalsError } = await supabase
    .from("source_signals")
    .select("id, cluster_id, source, source_url, title, summary, category, confidence, observed_at, source_published_at, public_status")
    .eq("public_status", "public")
    .order("observed_at", { ascending: false });
  const boardReadFailed = Boolean(clusterError || reportsError || signalsError);
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
        publicSignalsUnavailable: false,
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

  return { clusters, excerptsByCluster, signalsByCluster, currentPatch, boardReadFailed };
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

type AdminRejectedCandidateRow = {
  id: string;
  run_id: string | null;
  title: string;
  url: string;
  source_domain: string | null;
  source_published_at: string | null;
  snippet: string;
  reason: string;
  created_at: string;
  expires_at: string;
  rescued_at: string | null;
  decision_id?: string | null;
  feedback_rule_id?: string | null;
};

export type AdminObservationRow = {
  id: string;
  kind: PublicObservation["kind"];
  title: string;
  url: string;
  source_domain: string | null;
  snippet: string | null;
  source_published_at: string | null;
  created_at: string;
  observed_at: string;
  seen_count: number;
  is_public: boolean;
  /** Latest non-undone Reject-and-teach decision, when the moderation schema exists. */
  decision_id: string | null;
};

export async function getAutomationAdminData() {
  const supabase = createServiceClient();
  const nowIso = new Date().toISOString();

  // Every read below surfaces its own failure. A swallowed error here would
  // render as an empty Records band, a green ACTIVE badge, or a clear action
  // inbox — the operator would read "nothing to do" off a broken connection.
  const signalsResult = await supabase
    .from("source_signals")
    .select(
      "id, cluster_id, source, source_type, source_url, title, source_domain, source_published_at, first_seen_at, last_seen_at, seen_count, summary, category, confidence, observed_at, public_status",
    )
    .order("observed_at", { ascending: false })
    .limit(20);
  if (signalsResult.error) throw new Error(`source signals read failed: ${signalsResult.error.message}`);
  const signals = signalsResult.data;

  const runsResult = await supabase
    .from("automation_runs")
    .select(
      RUN_COLUMNS,
    )
    .order("started_at", { ascending: false })
    .limit(10);
  if (runsResult.error) throw new Error(`run history read failed: ${runsResult.error.message}`);
  const runs = runsResult.data;

  const enhancedRejectedResult = await supabase
    .from("automation_rejected_candidates")
    .select(
      "id, run_id, title, url, source_domain, source_published_at, snippet, reason, created_at, expires_at, rescued_at, decision_id, feedback_rule_id",
    )
    .gt("expires_at", nowIso)
    .is("rescued_at", null)
    .is("decision_id", null)
    .is("feedback_rule_id", null)
    .order("created_at", { ascending: false })
    .limit(30);
  let rejectedRows = (enhancedRejectedResult.data ?? []) as AdminRejectedCandidateRow[];
  let rejectedError = enhancedRejectedResult.error;
  if (
    rejectedError &&
    (isMissingSupabaseColumn(rejectedError, "automation_rejected_candidates", "decision_id") ||
      isMissingSupabaseColumn(rejectedError, "automation_rejected_candidates", "feedback_rule_id"))
  ) {
    const legacyRejectedResult = await supabase
      .from("automation_rejected_candidates")
      .select(
        "id, run_id, title, url, source_domain, source_published_at, snippet, reason, created_at, expires_at, rescued_at",
      )
      .gt("expires_at", nowIso)
      .is("rescued_at", null)
      .order("created_at", { ascending: false })
      .limit(30);
    rejectedRows = (legacyRejectedResult.data ?? []) as AdminRejectedCandidateRow[];
    rejectedError = legacyRejectedResult.error;
  }
  if (rejectedError) {
    throw new Error(`rejected candidates read failed: ${rejectedError.message}`);
  }
  const rejectedCandidates = rejectedRows.map((row) => ({
    ...row,
    decision_id: row.decision_id ?? null,
    feedback_rule_id: row.feedback_rule_id ?? null,
  }));

  // Paged to completion: this ledger is the only recovery surface for an
  // enforced rule, so a truncated read would strand rules the scanner is still
  // applying. Its length is therefore an exact total of the active rules,
  // counted from the same rows the page renders rather than from a separate
  // count query that could disagree with them.
  const feedbackRulesResult = await readActiveFeedbackRulePages<ScannerFeedbackRuleRow>(
    supabase,
    "id, decision_id, action, decision, scope_type, scope_value, reason, created_at, expires_at",
  );
  if ("error" in feedbackRulesResult && !isMissingSupabaseRelation(feedbackRulesResult.error, "scanner_feedback_rules")) {
    throw new Error(`scanner feedback rules read failed: ${feedbackRulesResult.error.message}`);
  }
  const feedbackLearningAvailable = !("error" in feedbackRulesResult);
  // Expiry is filtered here rather than in the query so that this ledger and
  // scanner enforcement judge "active" against the same clock.
  const feedbackRules = feedbackLearningAvailable
    ? feedbackRulesResult.rows.filter((rule) => !rule.expires_at || new Date(rule.expires_at).getTime() > Date.now())
    : [];

  const control = await getAutomationControlState(supabase as unknown as AutomationSettingsClient);

  const activeRunResult = await supabase
    .from("automation_runs")
    .select("id, status, mode, started_at")
    .eq("status", "running")
    .order("started_at", { ascending: false })
    .limit(1);
  if (activeRunResult.error) throw new Error(`active run read failed: ${activeRunResult.error.message}`);
  const activeRunRows = activeRunResult.data;

  // Fetched unbounded (not from the 10-row `runs` slice): during a paused/capped
  // stretch, hourly skip rows can fill that slice and hide the real last scan.
  const latestRealResult = await supabase
    .from("automation_runs")
    .select(RUN_COLUMNS)
    .neq("mode", "dry_run")
    .in("status", ["success", "partial", "failed"])
    .order("started_at", { ascending: false })
    .limit(1);
  if (latestRealResult.error) throw new Error(`latest run read failed: ${latestRealResult.error.message}`);
  const latestRealRows = latestRealResult.data;
  // success/partial only: signalsInserted is bumped during screening (before
  // persistSignals writes to the DB), so a failed run can report inserts that never
  // landed — it must not pose as the most recent find.
  const latestFindResult = await supabase
    .from("automation_runs")
    .select(RUN_COLUMNS)
    .neq("mode", "dry_run")
    .in("status", ["success", "partial"])
    .or("signals_inserted.gt.0,signals_reobserved.gt.0,clusters_promoted.gt.0")
    .order("started_at", { ascending: false })
    .limit(1);
  if (latestFindResult.error) throw new Error(`latest find read failed: ${latestFindResult.error.message}`);
  const latestFindRows = latestFindResult.data;

  // Observation desk: current-patch Wire/Asks items in every visibility state.
  // The decision join doubles as the schema probe — a missing observation_id
  // column means the moderation migration has not been applied yet.
  const currentPatch = await getCurrentPatchMetadata(supabase);
  const observationRowsResult = await supabase
    .from("patch_observations")
    .select("id, kind, title, url, source_domain, snippet, source_published_at, created_at, observed_at, seen_count, is_public")
    .eq("patch_version", currentPatch.version)
    .order("observed_at", { ascending: false })
    .limit(40);
  // Narrowly identified fallback only: a missing relation (pre-migration
  // deploy) reads as an empty desk; every other failure surfaces loudly
  // instead of posing as "no observations recorded".
  if (
    observationRowsResult.error &&
    !isMissingSupabaseRelation(observationRowsResult.error, "patch_observations")
  ) {
    throw new Error(`observations read failed: ${observationRowsResult.error.message}`);
  }
  const observationRows = observationRowsResult.error
    ? []
    : ((observationRowsResult.data ?? []) as Omit<AdminObservationRow, "decision_id">[]);

  // Scoped to the listed observations: a global newest-N read could let an
  // active decision fall past the cap and strand a hidden item with no Undo.
  const observationDecisionsResult = await supabase
    .from("scanner_decisions")
    .select("id, observation_id, created_at")
    .in("observation_id", observationRows.map((row) => row.id))
    .is("undone_at", null)
    .order("created_at", { ascending: false })
    .limit(200);
  // Narrowly identified fallback only: a pre-migration schema reads as
  // "moderation unavailable"; every other failure surfaces loudly instead of
  // silently downgrading the desk.
  if (
    observationDecisionsResult.error &&
    !isMissingSupabaseColumn(observationDecisionsResult.error, "scanner_decisions", "observation_id") &&
    !isMissingSupabaseRelation(observationDecisionsResult.error, "scanner_decisions")
  ) {
    throw new Error(`observation decisions read failed: ${observationDecisionsResult.error.message}`);
  }
  const observationModerationAvailable = !observationDecisionsResult.error;
  const latestDecisionByObservation = new Map<string, string>();
  if (observationModerationAvailable) {
    for (const row of (observationDecisionsResult.data ?? []) as { id: string; observation_id: string | null }[]) {
      if (row.observation_id && !latestDecisionByObservation.has(row.observation_id)) {
        latestDecisionByObservation.set(row.observation_id, row.id);
      }
    }
  }
  const observations: AdminObservationRow[] = observationRows.map((row) => ({
    ...row,
    decision_id: latestDecisionByObservation.get(row.id) ?? null,
  }));

  return {
    signals: (signals ?? []) as AdminSignalRow[],
    runs: (runs ?? []) as AutomationRunRow[],
    rejectedCandidates: rejectedCandidates as RejectedCandidateRow[],
    observations,
    // The patch these rows were selected against, returned with them. The
    // radar's copy is cached for five minutes, so on the first page load after
    // a rollover it can still name the previous patch — judging fresh rows by
    // a stale version would call the new patch's coverage off-topic.
    observationPatch: currentPatch,
    observationModerationAvailable,
    feedbackLearningAvailable,
    feedbackRules,
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
  /**
   * The cost-safety circuit is open right now — the same evaluation the next scan
   * will make. `null` means the circuit could not be read, which is not the same
   * claim as "open" and must never be displayed as one.
   */
  llmPaused: boolean | null;
  /**
   * Which registers above could not be read. A value belonging to a listed
   * register is a placeholder, not a count, and its surface must say so instead
   * of printing it.
   *
   * `scannerConnected` is the shorthand for "this list is empty", so a consumer
   * that has not been taught the registers still degrades the conservative way:
   * one failed read hides everything. Consumers move to the registers one cell
   * at a time to keep the numbers that were genuinely read.
   */
  readFailures: ScannerReadRegister[];
  steamPulse: SteamPulsePoint[];
  platformContext: PlatformContextSnapshot | null;
  pulseReadFailures: PulseReadFailure[];
};

export type PulseReadFailure = "steam" | "platform";

export type SteamPulsePoint = {
  snapshotDay: string;
  collectedAt: string;
  totalReviews: number;
  positivePercentage: number;
  reviewCountDelta: number | null;
  reviewsScanned: number;
  issueLanguageCount: number;
  leadsRetained: number;
};

export type PlatformContextSnapshot = {
  capturedAt: string;
  igdbStatus: string;
  releaseAt: string | null;
  platforms: string[];
  igdbUrl: string | null;
  twitchStatus: string;
  liveStreams: number | null;
  liveViewers: number | null;
  twitchComplete: boolean | null;
  twitchHistory: TwitchHistoryPoint[];
};

export async function readSteamPulse(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<SteamPulsePoint[]> {
  const { data, error } = await supabase
    .from("steam_pulse_snapshots")
    .select(
      "snapshot_day, collected_at, total_reviews, positive_percentage, review_count_delta, reviews_scanned, issue_language_count, leads_retained",
    )
    .order("snapshot_day", { ascending: false })
    .limit(14);
  if (error) {
    if (isMissingSupabaseRelation(error, "steam_pulse_snapshots")) return [];
    throw new Error(`Steam Pulse read failed: ${error.message}`);
  }
  return ((data ?? []) as Record<string, unknown>[])
    .map((row) => ({
      snapshotDay: String(row.snapshot_day ?? ""),
      collectedAt: String(row.collected_at ?? ""),
      totalReviews: Number(row.total_reviews ?? 0),
      positivePercentage: Number(row.positive_percentage ?? 0),
      reviewCountDelta: row.review_count_delta === null || row.review_count_delta === undefined
        ? null
        : Number(row.review_count_delta),
      reviewsScanned: Number(row.reviews_scanned ?? 0),
      issueLanguageCount: Number(row.issue_language_count ?? 0),
      leadsRetained: Number(row.leads_retained ?? 0),
    }))
    .reverse();
}

export async function readPlatformContext(
  supabase: ReturnType<typeof createServiceClient>,
  now = new Date(),
): Promise<PlatformContextSnapshot | null> {
  const { data, error } = await supabase
    .from("platform_context_snapshots")
    .select(
      "captured_at, igdb_status, igdb_slug, igdb_first_release_at, igdb_platforms, twitch_status, twitch_live_streams, twitch_live_viewers, twitch_complete",
    )
    .order("captured_at", { ascending: false })
    .limit(96);
  if (error) {
    if (isMissingSupabaseRelation(error, "platform_context_snapshots")) return null;
    throw new Error(`Platform context read failed: ${error.message}`);
  }
  const rows = (data ?? []) as Record<string, unknown>[];
  const row = rows[0];
  if (!row) return null;
  const capturedAt = String(row.captured_at ?? "");
  const storedTwitchStatus = String(row.twitch_status ?? "absent");
  const twitchStale = storedTwitchStatus === "ok" && platformContextIsStale(capturedAt, now);
  const twitchHistory = rows
    .filter(
      (snapshot) =>
        snapshot.twitch_status === "ok" &&
        snapshot.twitch_complete === true &&
        snapshot.twitch_live_streams !== null &&
        snapshot.twitch_live_streams !== undefined &&
        snapshot.twitch_live_viewers !== null &&
        snapshot.twitch_live_viewers !== undefined,
    )
    .map((snapshot) => ({
      capturedAt: String(snapshot.captured_at ?? ""),
      liveStreams: Number(snapshot.twitch_live_streams),
      liveViewers: Number(snapshot.twitch_live_viewers),
    }))
    .filter(
      (snapshot) =>
        Number.isFinite(new Date(snapshot.capturedAt).getTime()) &&
        Number.isFinite(snapshot.liveStreams) &&
        Number.isFinite(snapshot.liveViewers),
    )
    .reverse();
  return {
    capturedAt,
    igdbStatus: String(row.igdb_status ?? "absent"),
    releaseAt: typeof row.igdb_first_release_at === "string" ? row.igdb_first_release_at : null,
    platforms: Array.isArray(row.igdb_platforms) ? row.igdb_platforms.map(String) : [],
    igdbUrl: canonicalIgdbUrl(typeof row.igdb_slug === "string" ? row.igdb_slug : null),
    twitchStatus: twitchStale ? "stale" : storedTwitchStatus,
    liveStreams: twitchStale || row.twitch_live_streams === null || row.twitch_live_streams === undefined
      ? null
      : Number(row.twitch_live_streams),
    liveViewers: twitchStale || row.twitch_live_viewers === null || row.twitch_live_viewers === undefined
      ? null
      : Number(row.twitch_live_viewers),
    twitchComplete: !twitchStale && typeof row.twitch_complete === "boolean" ? row.twitch_complete : null,
    twitchHistory,
  };
}

export async function readPublicPulseContext(
  supabase: ReturnType<typeof createServiceClient>,
  now = new Date(),
): Promise<Pick<PublicScannerData, "steamPulse" | "platformContext" | "pulseReadFailures">> {
  const [steamResult, platformResult] = await Promise.allSettled([
    readSteamPulse(supabase),
    readPlatformContext(supabase, now),
  ]);
  const pulseReadFailures: PulseReadFailure[] = [];
  if (steamResult.status === "rejected") pulseReadFailures.push("steam");
  if (platformResult.status === "rejected") pulseReadFailures.push("platform");
  return {
    steamPulse: steamResult.status === "fulfilled" ? steamResult.value : [],
    platformContext: platformResult.status === "fulfilled" ? platformResult.value : null,
    pulseReadFailures,
  };
}

/**
 * Admin rescues re-screen a single stored candidate without searching, so they can
 * add a kept signal while reviewing zero candidates — counting them would inflate
 * keptThisWeek and eat into filteredThisWeek. Same rule as telemetry.server.ts
 * isIntakeRun on the front-page observatory; unify the two once both are in-tree.
 */
function isIntakeRun(run: { mode: string; intent: string | null; search_queries_used: number | null }): boolean {
  return !(run.mode === "manual" && run.intent === "rescue_candidate" && (run.search_queries_used ?? 0) === 0);
}

/**
 * Aggregate-only scanner counts for the public /scanner tab. Public and private
 * source text is read server-side only to enforce current-patch eligibility; no
 * title, URL, summary, rejection reason, or candidate row leaves this function.
 */
async function getPublicScannerDataUncached(): Promise<PublicScannerData> {
  // Zeros here are not counts — every register is listed as failed, which marks
  // each number as unavailable, and each surface says so rather than printing an
  // ordinary zero.
  const allUnavailable = (circuitOpen: boolean | null): PublicScannerData => ({
    reviewedThisWeek: 0,
    filteredThisWeek: 0,
    keptThisWeek: 0,
    awaiting: 0,
    published: 0,
    lastCheckedAt: null,
    scannerActive: false,
    scannerConnected: false,
    readFailures: [...SCANNER_READ_REGISTERS],
    llmPaused: circuitOpen,
    steamPulse: [],
    platformContext: null,
    pulseReadFailures: [],
  });
  // No Supabase in this environment is a known state rather than a failed read:
  // no automation runs here, so there is no cost circuit to report open.
  if (!hasSupabaseServiceConfig()) return allUnavailable(false);

  // Unknown until the circuit read runs. A failure before that point must not
  // erase an open circuit, and must not invent one either — the engine fails
  // closed because it is deciding whether to spend; this value is only displayed.
  let llmPaused: boolean | null = null;
  // Each read records only its own register. A failure no longer discards the
  // numbers its siblings returned successfully — one broken query used to blank
  // the whole scoreboard, which reads on the public page as a very quiet week.
  const failures = new Set<ScannerReadRegister>();
  try {
    const supabase = createServiceClient();
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: runData, error: runError } = await supabase
      .from("automation_runs")
      .select(
        "search_results_seen, reddit_posts_seen, signals_inserted, signals_reobserved, status, mode, intent, search_queries_used, finished_at, started_at, funnel",
      )
      .neq("mode", "dry_run")
      .in("status", ["success", "partial", "failed"])
      .gte("started_at", weekAgo)
      .order("started_at", { ascending: false });
    if (runError) failures.add("week");
    const runs = (
      ((runError ? [] : runData) ?? []) as {
        search_results_seen: number;
        reddit_posts_seen: number;
        signals_inserted: number;
        signals_reobserved: number | null;
        status: string;
        mode: string;
        intent: string | null;
        search_queries_used: number | null;
        funnel: Record<string, number> | null;
        finished_at: string | null;
        started_at: string;
      }[]
    ).filter(isIntakeRun);
    const reviewedThisWeek = runs.reduce(
      (sum, run) => sum + displayCandidateCount(run),
      0,
    );
    // Only success/partial runs actually persisted signals — a failed run can carry a
    // non-zero signals_inserted from screening that never landed in the DB.
    const keptThisWeek = runs.reduce(
      (sum, run) => (run.status === "failed" ? sum : sum + (run.signals_inserted ?? 0)),
      0,
    );
    // Re-encounters of already-tracked signals pass screening too — they land in
    // signals_reobserved instead of signals_inserted. They belong on the surviving
    // side of the funnel, or repeat-only weeks would read as 100% filtered.
    const reobservedThisWeek = runs.reduce(
      (sum, run) => (run.status === "failed" ? sum : sum + (run.signals_reobserved ?? 0)),
      0,
    );
    const filteredThisWeek = Math.max(0, reviewedThisWeek - keptThisWeek - reobservedThisWeek);

    // Heartbeat is independent of the weekly counters: a quiet or paused week must not
    // erase the real "last checked" time when older runs exist. Unbounded latest lookup.
    const { data: latestRows, error: latestError } = await supabase
      .from("automation_runs")
      .select("finished_at, started_at")
      .neq("mode", "dry_run")
      .in("status", ["success", "partial", "failed"])
      .order("started_at", { ascending: false })
      .limit(1);
    if (latestError) failures.add("heartbeat");
    const latest = (latestRows ?? [])[0] as { finished_at: string | null; started_at: string } | undefined;
    const lastCheckedAt = latestError ? null : (latest?.finished_at ?? latest?.started_at ?? null);

    // Same rolling-history evaluation the automation engine uses, so the badge
    // can never disagree with whether the next scan will actually call the LLM.
    // A failed read fails closed here for the same reason it does in the engine.
    const now = new Date();
    const { data: circuitData, error: circuitError } = await supabase
      .from("automation_runs")
      .select("skips, started_at")
      .gte("started_at", circuitReadStartIso(now));
    llmPaused = llmPausedFromCircuitRead(circuitData as CircuitRunRow[] | null, circuitError, now);

    // Awaiting = current-patch eligible private-lead clusters not backed by a
    // public link or approved report, including clusters not yet public. Four
    // reads feed it, and any of them failing costs this one number rather than
    // the whole scoreboard.
    let awaiting = 0;
    try {
      const currentPatch = await getCurrentPatchMetadata(supabase);
      const publicSignalClusters = await getPublicSignalClusterIdsForCurrentPatch(supabase, currentPatch);
      const privateSignalClusters = new Set(
        Object.keys(await getCandidateSignalCountsByCluster(supabase, currentPatch)),
      );

      const { data: reportData, error: reportError } = await supabase
        .from("bug_reports")
        .select("cluster_id, patch_version")
        .eq("moderation_status", "approved");
      if (reportError) throw new Error(`approved reports read failed: ${reportError.message}`);
      const approvedReportClusters = new Set<string>();
      for (const report of filterPatchFamilyReports(
        (reportData ?? []) as { cluster_id: string | null; patch_version: string | null }[],
        currentPatch,
      )) {
        if (report.cluster_id) approvedReportClusters.add(report.cluster_id);
      }

      for (const id of privateSignalClusters) {
        if (!publicSignalClusters.has(id) && !approvedReportClusters.has(id)) awaiting += 1;
      }
    } catch {
      // A partial loop may already have counted; the number is unusable either way.
      awaiting = 0;
      failures.add("awaiting");
    }

    // One definition of "published" for every surface: the same full-card gate
    // the issue board and homepage use (needsFullIssueCard on decorated clusters).
    // Counting from raw sets here previously disagreed with the board.
    let published = 0;
    try {
      const { clusters: decoratedClusters, boardReadFailed } = await getIssuesDataUncached();
      // The board read degrades to empty rather than throwing, so an exception is
      // not the only way this count can be wrong — an unread board would look
      // like zero published issues.
      if (boardReadFailed) throw new Error("issue board read failed");
      published = decoratedClusters.filter(needsFullIssueCard).length;
    } catch {
      failures.add("published");
    }

    const control = await getAutomationControlState(supabase as unknown as AutomationSettingsClient);
    const pulseContext = await readPublicPulseContext(supabase, now);

    return {
      reviewedThisWeek,
      filteredThisWeek,
      keptThisWeek,
      awaiting,
      published,
      lastCheckedAt,
      scannerActive: !control.paused,
      scannerConnected: failures.size === 0,
      // Declaration order, not insertion order, so the list is stable.
      readFailures: SCANNER_READ_REGISTERS.filter((register) => failures.has(register)),
      llmPaused,
      ...pulseContext,
    };
  } catch {
    return allUnavailable(llmPaused);
  }
}

export const getPublicScannerData = unstable_cache(getPublicScannerDataUncached, ["public-scanner-data"], {
  revalidate: 300,
  tags: [PUBLIC_DASHBOARD_TAG],
});

export type DailySignalDay = { day: string; reports: number; taps: number; keptLeads: number };

type DailyReportRollupRow = { created_at: string; patch_version: string | null };
type DailyTapRollupRow = { created_at: string; patch_family: string | null };
type DailyKeptLeadRollupRow = {
  started_at: string;
  signals_inserted: number | null;
  mode: string | null;
  intent: string | null;
  search_queries_used: number | null;
};

const DAILY_SIGNAL_ROLLUP_PAGE_SIZE = 1000;

type DailySignalRollupPage<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

/** Exhaustive paged read so the Patch Pulse rollup never silently truncates. */
export async function fetchAllDailySignalRollupRows<T>(
  label: string,
  page: (from: number, to: number) => PromiseLike<DailySignalRollupPage<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += DAILY_SIGNAL_ROLLUP_PAGE_SIZE) {
    const { data, error } = await page(from, from + DAILY_SIGNAL_ROLLUP_PAGE_SIZE - 1);
    if (error) throw new Error(`${label} read failed: ${error.message}`);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < DAILY_SIGNAL_ROLLUP_PAGE_SIZE) return rows;
  }
}

function dayKey(value: string): string | null {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString().slice(0, 10);
}

function addDays(day: string, offset: number): string {
  const time = new Date(`${day}T00:00:00.000Z`).getTime();
  return new Date(time + offset * 86_400_000).toISOString().slice(0, 10);
}

function countByDay(rows: { created_at: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const day = dayKey(row.created_at);
    if (day) counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return counts;
}

export function composeDailySignalRollup(input: {
  today: string;
  currentPatch: PatchContext;
  reports: DailyReportRollupRow[];
  taps: DailyTapRollupRow[];
  runs: DailyKeptLeadRollupRow[];
}): DailySignalDay[] {
  const currentFamily = patchFamilyKey(input.currentPatch.version);
  const publishedDay = input.currentPatch.publishedAt ? dayKey(input.currentPatch.publishedAt) : null;
  const fallbackStart = addDays(input.today, -30);
  const boundedStart = publishedDay && publishedDay > fallbackStart ? publishedDay : fallbackStart;
  const startDay = boundedStart < input.today ? boundedStart : input.today;

  const reportCounts = countByDay(
    input.reports.filter(
      (row) => row.patch_version && currentFamily && patchFamilyKey(row.patch_version) === currentFamily,
    ),
  );
  const tapCounts = countByDay(input.taps.filter((row) => row.patch_family === currentFamily));
  const keptLeadCounts = new Map<string, number>();
  for (const run of input.runs) {
    if (run.mode === "dry_run") continue;
    if (run.mode === "manual" && run.intent === "rescue_candidate" && (run.search_queries_used ?? 0) === 0) continue;
    const day = dayKey(run.started_at);
    if (day) keptLeadCounts.set(day, (keptLeadCounts.get(day) ?? 0) + (run.signals_inserted ?? 0));
  }

  const days: DailySignalDay[] = [];
  for (let day = startDay; day <= input.today; day = addDays(day, 1)) {
    days.push({
      day,
      reports: reportCounts.get(day) ?? 0,
      taps: tapCounts.get(day) ?? 0,
      keptLeads: keptLeadCounts.get(day) ?? 0,
    });
  }
  return days;
}

/**
 * Aggregate-only Patch Pulse chart data. This stays in the server-only data
 * access layer and uses the service role to avoid a public security-definer
 * view while still returning only day-level DTOs to the page.
 */
async function getDailySignalRollupUncached(): Promise<DailySignalDay[] | null> {
  if (!hasSupabaseServiceConfig()) return null;
  try {
    const supabase = createServiceClient();
    const currentPatch = await getCurrentPatchMetadata(supabase);
    const today = new Date().toISOString().slice(0, 10);
    const since = `${addDays(today, -30)}T00:00:00.000Z`;
    const [reports, taps, runs] = await Promise.all([
      fetchAllDailySignalRollupRows<DailyReportRollupRow>("daily reports", (from, to) =>
        supabase
          .from("bug_reports")
          .select("created_at, patch_version")
          .eq("moderation_status", "approved")
          .gte("created_at", since)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      ),
      fetchAllDailySignalRollupRows<DailyTapRollupRow>("daily confirmations", (from, to) =>
        supabase
          .from("issue_confirmations")
          .select("created_at, patch_family")
          .gte("created_at", since)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      ),
      fetchAllDailySignalRollupRows<DailyKeptLeadRollupRow>("daily automation runs", (from, to) =>
        supabase
          .from("automation_runs")
          .select("started_at, signals_inserted, mode, intent, search_queries_used")
          .in("status", ["success", "partial"])
          .gte("started_at", since)
          .order("started_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      ),
    ]);
    return composeDailySignalRollup({
      today,
      currentPatch,
      reports,
      taps,
      runs,
    });
  } catch {
    return null;
  }
}

export const getDailySignalRollup = unstable_cache(getDailySignalRollupUncached, ["daily-signal-rollup"], {
  revalidate: 300,
  tags: [PUBLIC_DASHBOARD_TAG],
});
