import "server-only";

import { computeAutomationBudget, type AutomationBudget } from "@/lib/automation/budget";
import { circuitReadStartIso, openRouterCircuitOpenFromRuns } from "@/lib/automation/circuit";
import {
  mapClaimToClusterWithOpenRouter,
  type ClaimMappingCluster,
  type ClaimMappingDecision,
} from "@/lib/automation/claimMapping";
import { canonicalizeUrl, hashValue, semanticFingerprint } from "@/lib/automation/dedupe";
import { countIndependentDomains, domainTier, isOfficialDomain, isProviderContextSource } from "@/lib/automation/domains";
import {
  evaluateCurrentPatchEligibility,
  type CurrentPatchContext,
  type CurrentPatchEligibilityReason,
} from "@/lib/automation/eligibility";
import { extractSignalWithOpenRouter, type ClusterOption, type ExtractionResult } from "@/lib/automation/extract";
import {
  canonicalizeRuleScopes,
  matchScannerFeedbackRule,
  storedRecordUrl,
  type ScannerFeedbackRule,
} from "@/lib/automation/feedback";
import { readActiveFeedbackRulePages } from "@/lib/automation/feedbackRules.server";
import { buildMemorySearchQueries, chooseScanIntent, eligibleLaneCount, type ScanIntent, type ScanMemory } from "@/lib/automation/memory";
import { resolveSignalPublicStatus, shouldPromoteSignalCluster } from "@/lib/automation/promote";
import {
  hasCrimsonDesertContext,
  hasUnsupportedSourceContext,
  preScreenCandidate,
  shouldKeepExtractedSignal,
  type ObservationKind,
  type RelevanceSkipReason,
} from "@/lib/automation/relevance";
import { routeToWatchlistCluster, type RoutableCluster } from "@/lib/automation/route";
import {
  buildWireNewsQuery,
  tavilyExtract,
  tavilySearch,
  WIRE_NEWS_TURN_INTERVAL,
  type SearchResult,
} from "@/lib/automation/search";
import { resolveBurstState } from "@/lib/automation/schedule";
import type { ScannerPolicy } from "@/lib/automation/settings";
import type { Category, Platform } from "@/lib/constants";
import { externalIdHash } from "@/lib/crypto";
import {
  automationBudgetUsd,
  features,
  platformContextConfigured,
  steamPlayerCountsEnabled,
  steamPulseEnabled,
} from "@/lib/env";
import { computeClusterLifecycle, type LifecycleClaimDecision } from "@/lib/lifecycle";
import {
  getClaimedFixesForCurrentPatch,
  getCurrentPatchMetadata,
  syncOfficialPatchNote,
  type CurrentPatchMetadata,
} from "@/lib/officialPatch.server";
import {
  appendUniqueObservation,
  persistObservations,
  upgradeObservationDate,
  type ObservationCandidate,
  type StoredObservationDate,
} from "@/lib/automation/observations";
import {
  classifyProviderSourceDate,
  resolveAssertedSourceDate,
  resolveSourceDate,
} from "@/lib/automation/sourceDate";
import {
  buildSteamPulseSnapshot,
  fetchSteamCurrentPlayers,
  fetchSteamReviewBatch,
  filterNewOrUpdatedSteamReviews,
  STEAM_REVIEW_SOURCE_URL,
  type SteamReviewBatch,
  type SteamReviewCandidate,
} from "@/lib/automation/steam";
import { createServiceClient } from "@/lib/supabase";
import { isMissingSupabaseColumn, isMissingSupabaseRelation } from "@/lib/supabaseCompatibility";
import { fetchCrimsonDesertPlatformContext } from "@/lib/platform/igdb";

export type AutomationMode = "scheduled" | "manual" | "dry_run";

export type AutomationResult = {
  status: "success" | "partial" | "failed" | "skipped";
  searchQueriesUsed: number;
  searchResultsSeen: number;
  llmCallsUsed: number;
  candidatesSeen: number;
  prefilterRejected: number;
  signalsPrepared: number;
  signalsInserted: number;
  signalsDeduped: number;
  clustersPromoted: number;
  intent: ScanIntent;
  targetClusterTitles: string[];
  signalsReobserved: number;
  staleSignalsHidden: number;
  candidatesRescued: number;
  observationsKept: number;
  operatorRulesMatched: number;
  estimatedCostUsd: number;
  llmCostUsd: number;
  skips: string[];
  errors: string[];
};

export type RunProgress = {
  stage: "starting" | "searching" | "screening" | "persisting" | "done";
  searchesDone: number;
  searchTotal: number;
  candidatesSeen: number;
  prefilterRejected: number;
  llmCallsUsed: number;
  kept: number;
  promoted: number;
};

function remainingLlmCalls(result: AutomationResult, budget: AutomationBudget): number {
  if (
    [
      "openrouter_unexpected_charge",
      "openrouter_cost_unverified",
      "openrouter_budget_exceeded",
      // Every later call would be refused the same way, so stop asking.
      "openrouter_no_route",
    ].some((reason) => result.skips.includes(reason))
  ) {
    return 0;
  }
  return result.llmCostUsd >= budget.remainingLlmUsd
    ? 0
    : Math.max(0, budget.maxLlmCalls - result.llmCallsUsed);
}

/**
 * Record the OpenRouter outcomes that stop the run's LLM lane. Two of them also
 * feed the cost-safety circuit through the same skip list; `openrouter_no_route`
 * does not — circuit.ts counts only the money reasons.
 */
function recordOpenRouterRunSkip(result: AutomationResult, reason: string | undefined): void {
  if (
    (reason === "openrouter_cost_unverified" ||
      reason === "openrouter_budget_exceeded" ||
      reason === "openrouter_no_route") &&
    !result.skips.includes(reason)
  ) {
    result.skips.push(reason);
  }
}

function snapshotProgress(stage: RunProgress["stage"], result: AutomationResult, searchTotal: number): RunProgress {
  return {
    stage,
    // Clamp: recon /extract calls share searchQueriesUsed, so raw done can exceed the
    // per-run search total; the progress bar should never read >100%.
    searchesDone: Math.min(result.searchQueriesUsed, searchTotal),
    searchTotal,
    candidatesSeen: result.candidatesSeen,
    prefilterRejected: result.prefilterRejected,
    llmCallsUsed: result.llmCallsUsed,
    kept: result.signalsPrepared,
    promoted: result.clustersPromoted,
  };
}

/** Best-effort progress write — never throws, never fails a run. */
async function writeProgress(
  supabase: ReturnType<typeof createServiceClient>,
  runId: string,
  progress: RunProgress,
): Promise<void> {
  try {
    await supabase.from("automation_runs").update({ progress }).eq("id", runId);
  } catch {
    // best-effort by design
  }
}

const STALE_RUN_MINUTES = 15;

/** Finalize crashed runs: a killed serverless function can never finalize its own row. */
export async function sweepStaleRuns(
  supabase: ReturnType<typeof createServiceClient>,
  now: Date,
): Promise<void> {
  try {
    await supabase
      .from("automation_runs")
      .update({
        status: "failed",
        finished_at: now.toISOString(),
        errors: ["stale_running_run"],
      })
      .eq("status", "running")
      .lt("started_at", new Date(now.getTime() - STALE_RUN_MINUTES * 60 * 1000).toISOString());
  } catch {
    // best-effort by design
  }
}

/**
 * BEST-EFFORT concurrency protection, not a lock. The sweep -> check -> create
 * sequence is not atomic and there is no DB unique constraint on
 * status = 'running', so two simultaneous starts can both pass this check and
 * both create a run. Upstream guards (cron's policy recency check, single-admin
 * manual use) make that acceptable — do not rely on this as mutual exclusion.
 */
export async function hasActiveRun(
  supabase: ReturnType<typeof createServiceClient>,
  now: Date,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("automation_runs")
    .select("id")
    .eq("status", "running")
    .gte("started_at", new Date(now.getTime() - STALE_RUN_MINUTES * 60 * 1000).toISOString())
    .limit(1);
  if (error) throw new Error(`active run read failed: ${error.message}`);
  return ((data ?? []) as { id: string }[]).length > 0;
}

type SourceInput = {
  source: "web_search" | "steam_review";
  id: string;
  title: string;
  body: string;
  url: string;
  observedAt: string;
  sourceDomain: string | null;
  sourcePublishedAt?: string | null;
  steam?: Omit<SteamReviewCandidate, "reviewText">;
};

type PreparedSignal = SourceInput & {
  canonicalUrl: string;
  externalHash: string;
  semantic: string;
  extraction: ExtractionResult;
};

export type RejectedCandidate = {
  source: SourceInput["source"];
  title: string;
  url: string;
  sourceDomain: string | null;
  sourcePublishedAt?: string | null;
  snippet: string;
  reason: string;
  feedbackRuleId?: string | null;
  steamRecommendationHash?: string | null;
};

type ClusterRow = {
  id: string;
  category: Category;
  admin_visibility_override?: "force_public" | "force_hidden" | null;
  auto_public?: boolean | null;
  is_public?: boolean | null;
  visibility_restore_auto_public?: boolean | null;
  visibility_restore_is_public?: boolean | null;
  visibility_revision?: number | string | null;
};

type SourceSignalRow = {
  id?: string;
  cluster_id?: string | null;
  source_url?: string | null;
  canonical_url?: string | null;
  source?: string;
  source_type?: string | null;
  source_domain?: string | null;
  category?: Category | string | null;
  confidence?: "low" | "medium" | "high" | null;
  observed_at?: string | null;
  extracted_facts?: { platform?: Platform | null } | null;
  title?: string | null;
  summary?: string | null;
  source_published_at?: string | null;
  public_status?: "private" | "public" | "hidden" | null;
  promotion_reason?: string | null;
  seen_count?: number | string | null;
  first_seen_at?: string | null;
  last_seen_at?: string | null;
  last_seen_run_id?: string | null;
  external_id_hash?: string | null;
};

type ApprovedReportRow = {
  id: string;
  cluster_id: string | null;
  category: Category;
  platform: Platform;
  issue_title: string;
};

type ApprovedExcerptRow = {
  id: string;
  report_id: string;
};

const SEARCH_QUERY_COST_USD = 0.008;
const SEARCH_ROTATION_WINDOW_MS = 60 * 60 * 1000;
const MAX_RESERVED_EXTRACTION_LLM_CALLS = 2;
const MAX_RESCUE_LLM_CALLS = 1;
// Hard cap on full-page recon fetches per run. Each fetch is one Tavily extract
// credit, so this bounds the extra cost of the "read the real thread before
// rejecting" lane regardless of how many borderline candidates a run surfaces.
const MAX_RECON_FETCHES_PER_RUN = 2;

function searchResultToInput(result: SearchResult): SourceInput {
  return {
    source: "web_search",
    id: result.url,
    title: result.title,
    body: result.snippet,
    url: result.url,
    observedAt: result.observedAt,
    sourceDomain: result.sourceDomain,
    sourcePublishedAt: result.sourcePublishedAt ?? null,
  };
}

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function clusterSlug(semantic: string): string {
  return `auto-${hashValue(semantic).slice(0, 12)}`;
}

function clusterConfidence(confidence: "low" | "medium" | "high"): "low" | "medium" {
  return confidence === "low" ? "low" : "medium";
}

function isObservedWithinWindow(row: SourceSignalRow, now: Date, windowMs: number): boolean {
  if (!row.observed_at) return false;
  const observedAt = new Date(row.observed_at).getTime();
  if (!Number.isFinite(observedAt)) return false;
  return observedAt >= now.getTime() - windowMs && observedAt <= now.getTime();
}

function signalDomain(row: SourceSignalRow): string | null {
  if (row.source_domain) return row.source_domain;
  if (!row.canonical_url) return null;
  try {
    return new URL(row.canonical_url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function domainCounts(rows: SourceSignalRow[], now: Date): { independentDomainCount: number; trustedDomainCount: number } {
  const recentWindowMs = 14 * 24 * 60 * 60 * 1000;
  const hostnames = rows
    .filter((row) => isObservedWithinWindow(row, now, recentWindowMs))
    .map(signalDomain)
    .filter((domain): domain is string => Boolean(domain));
  return countIndependentDomains(hostnames);
}

function lastObservedAt(rows: SourceSignalRow[]): string | null {
  return rows
    .map((row) => row.observed_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
}

const RESCUE_EXCLUDED_CONTENT = /\b(?:patch notes?|benchmark|performance test|how to fix|troubleshooting|settings guide|gameplay|trailer|walkthrough|first look)\b/i;
const RESCUE_CONTEXT = /\b(?:discussion|comments?|thread|feedback|player|players|report|reports|bug|issue|latest patch|current patch|new patch)\b/i;

function isBorderlineRescueCandidate(
  signal: SourceInput,
  assertedSourceDate: string | null,
  currentPatch: CurrentPatchContext,
): boolean {
  if (domainTier(signal.sourceDomain) !== "trusted") return false;
  // Recon exists to read a page once before REJECTING a promising candidate.
  // An official page cannot be rescued by construction — the re-screen routes
  // it straight back to the observation lane whatever the fetched text says —
  // so fetching it would spend a scarce Tavily credit on a predetermined verdict.
  if (isOfficialDomain(signal.sourceDomain)) return false;
  const text = `${signal.title} ${signal.body}`;
  if (RESCUE_EXCLUDED_CONTENT.test(text)) return false;
  if (!RESCUE_CONTEXT.test(text)) return false;
  return evaluateCurrentPatchEligibility(
    { title: signal.title, snippet: signal.body, sourcePublishedAt: assertedSourceDate },
    currentPatch,
  ).canStore;
}

function sourceSignalEligibility(
  row: SourceSignalRow,
  currentPatch: CurrentPatchContext,
) {
  return evaluateCurrentPatchEligibility(
    {
      title: row.title ?? null,
      summary: typeof row.summary === "string" ? row.summary : null,
      sourcePublishedAt: row.source_published_at ?? null,
    },
    currentPatch,
  );
}

function isUnsupportedStoredSignal(row: SourceSignalRow): boolean {
  return hasUnsupportedSourceContext({
    title: row.title ?? "",
    snippet: typeof row.summary === "string" ? row.summary : "",
    url: row.canonical_url ?? row.source_url ?? undefined,
  });
}

function hasStoredSignalGameContext(row: SourceSignalRow): boolean {
  return hasCrimsonDesertContext({
    title: row.title ?? "",
    snippet: typeof row.summary === "string" ? row.summary : "",
    url: row.canonical_url ?? row.source_url ?? undefined,
    sourceDomain: row.source_domain ?? null,
  });
}

function isContextOnlySignal(row: SourceSignalRow): boolean {
  // Steam reviews and the publisher's own pages are both provider context,
  // never player evidence. The official half also covers rows stored BEFORE the
  // pre-screen learned to route official domains to the observation lane — they
  // resolve to private with reason source_context_only instead of ever being
  // presented as a cluster's evidence. One shared predicate holds the boundary
  // here and in the radar's tracked-lead filter, so the definitions cannot
  // fork, and the url rides along so a mis-stamped domain column cannot slip
  // an official page past the guard that decides public display.
  return isProviderContextSource({
    source: row.source,
    domain: signalDomain(row),
    url: row.canonical_url ?? row.source_url,
  });
}

function stalePromotionReason(reason: CurrentPatchEligibilityReason | "source_not_issue_report" | "off_topic"): string {
  if (reason === "source_not_issue_report") return "source_not_issue_report";
  if (reason === "off_topic") return "off_topic";
  if (reason === "wrong_patch") return "wrong_patch";
  if (reason === "stale_source") return "stale_source";
  return "unknown_source_freshness";
}

async function updateRunIntent(
  supabase: ReturnType<typeof createServiceClient>,
  runId: string,
  intent: ScanIntent,
): Promise<void> {
  try {
    await supabase.from("automation_runs").update({ intent }).eq("id", runId);
  } catch {
    // best-effort by design
  }
}

/**
 * Publication dates this patch's observation shelf already holds, keyed two
 * ways for two different jobs:
 *
 *   - byCanonicalUrl feeds the source-date resolver's last precedence step, so
 *     a page we already have a verified date for keeps it when an undated
 *     sighting arrives. Exact URL only — a date describes one page.
 *   - byUrlHash is the row identity the persistence RPC uses. Its value carries
 *     the URL too because a community-ask campaign hash can span several pages,
 *     while a publication date belongs to exactly one of them.
 *
 * Only the narrowly identified rolling-deploy case where patch_observations is
 * absent degrades to empty maps. Permissions, timeouts and all other failures
 * stop the run before persistence can replace a date without knowing who owns
 * the stored one.
 */
type StoredObservationDates = {
  byCanonicalUrl: ReadonlyMap<string, string | null>;
  byUrlHash: ReadonlyMap<string, StoredObservationDate>;
};

const EMPTY_STORED_SOURCE_DATES: StoredObservationDates = {
  byCanonicalUrl: new Map(),
  byUrlHash: new Map(),
};

async function loadStoredSourceDates(
  supabase: ReturnType<typeof createServiceClient>,
  patchVersion: string,
): Promise<StoredObservationDates> {
  const storedDateQuery = supabase
    .from("patch_observations")
    .select("url, url_hash, source_published_at")
    .eq("patch_version", patchVersion);
  let response: Awaited<typeof storedDateQuery>;
  try {
    response = await storedDateQuery;
  } catch (error) {
    throw new Error(
      `stored observation dates read failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (response.error) {
    if (isMissingSupabaseRelation(response.error, "patch_observations")) {
      return EMPTY_STORED_SOURCE_DATES;
    }
    throw new Error(`stored observation dates read failed: ${response.error.message}`);
  }
  const byCanonicalUrl = new Map<string, string | null>();
  const byUrlHash = new Map<string, StoredObservationDate>();
  for (const row of (response.data ?? []) as {
    url?: string | null;
    url_hash?: string | null;
    source_published_at?: string | null;
  }[]) {
    if (row.url) byCanonicalUrl.set(row.url, row.source_published_at ?? null);
    if (row.url && row.url_hash) {
      byUrlHash.set(row.url_hash, {
        url: row.url,
        sourcePublishedAt: row.source_published_at ?? null,
      });
    }
  }
  return { byCanonicalUrl, byUrlHash };
}

async function loadRecentRunMemory(supabase: ReturnType<typeof createServiceClient>): Promise<ScanMemory["recentRuns"]> {
  const { data, error } = await supabase
    .from("automation_runs")
    .select("status, mode, signals_inserted, search_results_seen, funnel")
    .order("started_at", { ascending: false })
    .limit(5);
  if (error) throw new Error(`automation run memory read failed: ${error.message}`);
  return (data ?? []) as ScanMemory["recentRuns"];
}

type ScannerFeedbackRuleRow = {
  id: string;
  action: "allow" | "block";
  decision: ScannerFeedbackRule["decision"];
  scope_type: ScannerFeedbackRule["scopeType"];
  scope_value: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
};

async function loadActiveScannerFeedbackRules(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<ScannerFeedbackRule[]> {
  const result = await readActiveFeedbackRulePages<ScannerFeedbackRuleRow>(
    supabase,
    "id, action, decision, scope_type, scope_value, created_at, expires_at, revoked_at",
  );
  if ("error" in result) {
    // Safe rolling-deploy behavior: code may reach a preview before its local-
    // tested migration is applied. No rules is the old behavior.
    if (isMissingSupabaseRelation(result.error, "scanner_feedback_rules")) return [];
    throw new Error(`scanner feedback rules read failed: ${result.error.message}`);
  }
  return result.rows.map((row) => ({
    id: row.id,
    action: row.action,
    decision: row.decision,
    scopeType: row.scope_type,
    scopeValue: row.scope_value,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  }));
}

async function loadPublicSignalsForAudit(supabase: ReturnType<typeof createServiceClient>): Promise<SourceSignalRow[]> {
  const pageSize = 500;
  const rows: SourceSignalRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("source_signals")
      .select("id, cluster_id, source, source_url, canonical_url, source_domain, title, summary, source_published_at, public_status")
      .eq("public_status", "public")
      .order("last_seen_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`public source signal audit read failed: ${error.message}`);
    const page = (data ?? []) as SourceSignalRow[];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

async function countPrivateSignals(supabase: ReturnType<typeof createServiceClient>): Promise<number> {
  const { data, error } = await supabase.from("source_signals").select("cluster_id").eq("public_status", "private").limit(100);
  if (error) throw new Error(`private source signal memory read failed: ${error.message}`);
  return ((data ?? []) as unknown[]).length;
}

async function loadPrivateSignalClusterTitles(supabase: ReturnType<typeof createServiceClient>): Promise<string[]> {
  const { data: signalRows, error: signalError } = await supabase
    .from("source_signals")
    .select("cluster_id")
    .eq("public_status", "private")
    .limit(100);
  if (signalError) throw new Error(`private source signal target read failed: ${signalError.message}`);

  const clusterIds = [
    ...new Set(
      ((signalRows ?? []) as { cluster_id?: string | null }[])
        .map((row) => row.cluster_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ].slice(0, 10);
  if (clusterIds.length === 0) return [];

  const { data: clusterRows, error: clusterError } = await supabase
    .from("issue_clusters")
    .select("id, title")
    .in("id", clusterIds)
    .limit(10);
  if (clusterError) throw new Error(`private source signal cluster target read failed: ${clusterError.message}`);
  return ((clusterRows ?? []) as { title?: string | null }[])
    .map((row) => row.title?.trim())
    .filter((title): title is string => Boolean(title));
}

async function loadHuntableSeedClusterTitles(supabase: ReturnType<typeof createServiceClient>): Promise<string[]> {
  const { data, error } = await supabase
    .from("issue_clusters")
    .select("title")
    .eq("is_public", true)
    .eq("confidence", "seed_unverified")
    .eq("signal_count", 0)
    .eq("direct_report_count", 0)
    .limit(10);
  if (error) throw new Error(`huntable seed cluster target read failed: ${error.message}`);
  return ((data ?? []) as { title?: string | null }[])
    .map((row) => row.title?.trim())
    .filter((title): title is string => Boolean(title));
}

async function countRejectedCandidates(supabase: ReturnType<typeof createServiceClient>, now: Date): Promise<number> {
  const { data, error } = await supabase
    .from("automation_rejected_candidates")
    .select("id")
    .eq("reason", "source_not_issue_report")
    .is("rescued_at", null)
    .gt("expires_at", now.toISOString())
    .limit(100);
  if (error) throw new Error(`rejected candidate memory read failed: ${error.message}`);
  return ((data ?? []) as unknown[]).length;
}

async function loadScanMemory(
  supabase: ReturnType<typeof createServiceClient>,
  currentPatch: CurrentPatchContext,
  now: Date,
): Promise<ScanMemory> {
  const [publicSignals, privateSignals, rejectedCandidates, privateClusterTitles, seedClusterTitles, recentRuns] =
    await Promise.all([
      loadPublicSignalsForAudit(supabase),
      countPrivateSignals(supabase),
      countRejectedCandidates(supabase, now),
      loadPrivateSignalClusterTitles(supabase),
      loadHuntableSeedClusterTitles(supabase),
      loadRecentRunMemory(supabase),
    ]);
  // Private-signal clusters first (they already have momentum), then zero-evidence
  // public seed clusters so the scanner actually hunts them by name. De-duplicate
  // and keep the same small cap as the individual title reads.
  const targetClusterTitles = [...new Set([...privateClusterTitles, ...seedClusterTitles])].slice(0, 10);
  return {
    stalePublicSignals: publicSignals.filter(
      (row) =>
        isContextOnlySignal(row) ||
        isUnsupportedStoredSignal(row) ||
        !hasStoredSignalGameContext(row) ||
        !sourceSignalEligibility(row, currentPatch).canPublish,
    ).length,
    privateSignals,
    rejectedCandidates,
    targetClusterTitles,
    recentRuns,
  };
}

async function loadMonthSpend(
  supabase: ReturnType<typeof createServiceClient>,
  now: Date,
): Promise<{ estimatedCostUsd: number; tavilyCredits: number; llmCostUsd: number; openRouterCircuitOpen: boolean }> {
  const monthStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  // circuitReadStartIso reaches into the previous month during a month's first
  // 24h (rolling blip window); spend accounting stays month-scoped below.
  const { data, error } = await supabase
    .from("automation_runs")
    .select("estimated_cost_usd, search_queries_used, skips, started_at")
    .gte("started_at", circuitReadStartIso(now));
  if (error) throw new Error(`automation spend read failed: ${error.message}`);
  const rows = (data ?? []) as {
    estimated_cost_usd?: number | string | null;
    search_queries_used?: number | string | null;
    skips?: unknown;
    started_at?: string | null;
  }[];
  const monthRows = rows.filter(
    (row) => typeof row.started_at === "string" && new Date(row.started_at).getTime() >= monthStartMs,
  );
  const usage = monthRows.reduce(
    (sum, row) => ({
      estimatedCostUsd: sum.estimatedCostUsd + Number(row.estimated_cost_usd ?? 0),
      tavilyCredits: sum.tavilyCredits + Number(row.search_queries_used ?? 0),
    }),
    { estimatedCostUsd: 0, tavilyCredits: 0 },
  );
  return {
    ...usage,
    llmCostUsd: Math.max(0, usage.estimatedCostUsd - usage.tavilyCredits * SEARCH_QUERY_COST_USD),
    openRouterCircuitOpen: openRouterCircuitOpenFromRuns(rows, now),
  };
}

function searchRotationOffset(now: Date): number {
  return Math.floor(now.getTime() / SEARCH_ROTATION_WINDOW_MS);
}

const STEAM_PULSE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const STEAM_REVIEW_MAX_PAGES = 10;
const STEAM_REVIEW_RECEIPT_CHUNK_SIZE = 100;
const PLATFORM_CONTEXT_INTERVAL_MS = 60 * 60 * 1000;
const STEAM_PLAYER_INTERVAL_MS = 60 * 60 * 1000;

type SteamReviewCollection = {
  batch: SteamReviewBatch;
  changedReviews: SteamReviewCandidate[];
  inputs: SourceInput[];
};

async function collectSteamReviewInputs(
  supabase: ReturnType<typeof createServiceClient>,
  result: AutomationResult,
  now: Date,
): Promise<SteamReviewCollection | null> {
  if (!steamPulseEnabled()) return null;

  try {
    const snapshotDay = now.toISOString().slice(0, 10);
    const { data: recentRows, error: recentError } = await supabase
      .from("steam_pulse_snapshots")
      .select("collected_at")
      .eq("snapshot_day", snapshotDay)
      .order("collected_at", { ascending: false })
      .limit(1);
    if (recentError) {
      if (isMissingSupabaseRelation(recentError, "steam_pulse_snapshots")) {
        result.skips.push("steam_pulse_schema_unavailable");
        return null;
      }
      throw new Error(`Steam Pulse recency read failed: ${recentError.message}`);
    }
    const recent = (recentRows ?? [])[0] as { collected_at?: string | null } | undefined;
    const recentAt = recent?.collected_at ? new Date(recent.collected_at).getTime() : Number.NaN;
    if (Number.isFinite(recentAt) && now.getTime() - recentAt < STEAM_PULSE_INTERVAL_MS) {
      result.skips.push("steam_pulse_recent");
      return null;
    }

    const firstBatch = await fetchSteamReviewBatch();
    const reviewsByHash = new Map(
      firstBatch.reviews.map((review) => [review.recommendationHash, review] as const),
    );
    const seenCursors = new Set<string>();
    let cursor = firstBatch.cursor;
    let pagesFetched = 1;
    while (cursor && pagesFetched < STEAM_REVIEW_MAX_PAGES) {
      if (seenCursors.has(cursor)) throw new Error("Steam reviews pagination cursor repeated");
      seenCursors.add(cursor);
      const nextBatch = await fetchSteamReviewBatch({ cursor, fallbackTotals: firstBatch.totals });
      for (const review of nextBatch.reviews) {
        if (!reviewsByHash.has(review.recommendationHash)) {
          reviewsByHash.set(review.recommendationHash, review);
        }
      }
      cursor = nextBatch.cursor;
      pagesFetched += 1;
    }
    if (cursor) result.skips.push("steam_pulse_page_cap");
    const batch: SteamReviewBatch = {
      ...firstBatch,
      reviews: [...reviewsByHash.values()],
      cursor,
    };

    const hashes = batch.reviews.map((review) => review.recommendationHash);
    const existingUpdatedAtByHash = new Map<string, string>();
    for (let offset = 0; offset < hashes.length; offset += STEAM_REVIEW_RECEIPT_CHUNK_SIZE) {
      const hashChunk = hashes.slice(offset, offset + STEAM_REVIEW_RECEIPT_CHUNK_SIZE);
      const { data, error } = await supabase
        .from("steam_review_receipts")
        .select("recommendation_hash, source_updated_at")
        .in("recommendation_hash", hashChunk);
      if (error) {
        if (isMissingSupabaseRelation(error, "steam_review_receipts")) {
          result.skips.push("steam_pulse_schema_unavailable");
          return null;
        }
        throw new Error(`Steam review receipt read failed: ${error.message}`);
      }
      for (const row of (data ?? []) as { recommendation_hash: string; source_updated_at: string }[]) {
        existingUpdatedAtByHash.set(row.recommendation_hash, row.source_updated_at);
      }
    }

    const changedReviews = filterNewOrUpdatedSteamReviews(batch.reviews, existingUpdatedAtByHash);
    const inputs: SourceInput[] = changedReviews.map((review) => ({
      source: "steam_review",
      id: review.recommendationHash,
      // Avoid the broad-content "review" title gate while keeping the player
      // text private; extraction derives the actual issue title from the body.
      title: "Crimson Desert player issue on Steam",
      body: review.reviewText,
      url: STEAM_REVIEW_SOURCE_URL,
      observedAt: now.toISOString(),
      sourceDomain: "store.steampowered.com",
      // Steam's updated feed can surface a current complaint on an older review.
      // Use the edit time for patch freshness; the original creation time stays
      // in the private receipt metadata below.
      sourcePublishedAt: review.sourceUpdatedAt,
      steam: {
        recommendationHash: review.recommendationHash,
        sourceCreatedAt: review.sourceCreatedAt,
        sourceUpdatedAt: review.sourceUpdatedAt,
        votedUp: review.votedUp,
        playtimeAtReviewMinutes: review.playtimeAtReviewMinutes,
      },
    }));
    return { batch, changedReviews, inputs };
  } catch (error) {
    result.status = result.status === "success" ? "partial" : result.status;
    result.errors.push(toErrorMessage(error, "Steam Pulse collection failed"));
    return null;
  }
}

async function persistSteamReviewCollection(
  supabase: ReturnType<typeof createServiceClient>,
  collection: SteamReviewCollection,
  prepared: PreparedSignal[],
  rejected: RejectedCandidate[],
  persistedSteamReviewHashes: ReadonlySet<string>,
  result: AutomationResult,
  now: Date,
): Promise<void> {
  try {
    const snapshotDay = now.toISOString().slice(0, 10);
    const acknowledgedReviewHashes = new Set(persistedSteamReviewHashes);
    for (const candidate of rejected) {
      if (candidate.source === "steam_review" && candidate.steamRecommendationHash) {
        acknowledgedReviewHashes.add(candidate.steamRecommendationHash);
      }
    }
    const acknowledgedReviews = collection.changedReviews.filter((review) =>
      acknowledgedReviewHashes.has(review.recommendationHash),
    );

    // A receipt is the retry boundary. Only acknowledge reviews that either
    // landed as a source signal or completed classification as a rejection.
    // A prepared signal whose write failed intentionally has no receipt, so a
    // later run can retry it instead of silently losing the lead.
    if (acknowledgedReviews.length > 0) {
      const { error } = await supabase.from("steam_review_receipts").upsert(
        acknowledgedReviews.map((review) => ({
          recommendation_hash: review.recommendationHash,
          last_seen_at: now.toISOString(),
          source_created_at: review.sourceCreatedAt,
          source_updated_at: review.sourceUpdatedAt,
          voted_up: review.votedUp,
          playtime_at_review_minutes: review.playtimeAtReviewMinutes,
        })),
        { onConflict: "recommendation_hash" },
      );
      if (error) throw new Error(`Steam review receipt write failed: ${error.message}`);
    }

    const { data: previousRows, error: previousError } = await supabase
      .from("steam_pulse_snapshots")
      .select("total_reviews")
      .lt("snapshot_day", snapshotDay)
      .order("snapshot_day", { ascending: false })
      .limit(1);
    if (previousError) throw new Error(`Steam Pulse history read failed: ${previousError.message}`);
    const previous = (previousRows ?? [])[0] as { total_reviews?: number | null } | undefined;
    const previousTotalReviews = typeof previous?.total_reviews === "number" ? previous.total_reviews : null;
    const steamPrepared = prepared.filter((signal) => signal.source === "steam_review").length;
    const steamIssueRejects = rejected.filter(
      (candidate) =>
        candidate.source === "steam_review" &&
        candidate.reason !== "source_not_issue_report" &&
        candidate.reason !== "off_topic",
    ).length;
    const snapshot = buildSteamPulseSnapshot({
      batch: collection.batch,
      previousTotalReviews,
      reviewsScanned: collection.changedReviews.length,
      issueLanguageCount: steamPrepared + steamIssueRejects,
      leadsRetained: persistedSteamReviewHashes.size,
      now,
    });
    const { error: snapshotError } = await supabase
      .from("steam_pulse_snapshots")
      .upsert(snapshot, { onConflict: "snapshot_day" });
    if (snapshotError) throw new Error(`Steam Pulse snapshot write failed: ${snapshotError.message}`);
  } catch (error) {
    result.status = result.status === "success" ? "partial" : result.status;
    result.errors.push(toErrorMessage(error, "Steam Pulse persistence failed"));
  }
}

async function persistSteamPlayerSnapshot(
  supabase: ReturnType<typeof createServiceClient>,
  result: AutomationResult,
  now: Date,
): Promise<void> {
  if (!steamPlayerCountsEnabled()) return;
  try {
    const { data, error } = await supabase.from("steam_player_snapshots")
      .select("captured_at").order("captured_at", { ascending: false }).limit(1);
    if (error) {
      if (isMissingSupabaseRelation(error, "steam_player_snapshots")) {
        result.skips.push("steam_players_schema_unavailable");
        return;
      }
      throw new Error(`Steam player recency read failed: ${error.message}`);
    }
    const recent = (data ?? [])[0] as { captured_at: string } | undefined;
    if (recent && now.getTime() - Date.parse(recent.captured_at) < STEAM_PLAYER_INTERVAL_MS) {
      result.skips.push("steam_players_recent");
      return;
    }
    const reading = await fetchSteamCurrentPlayers();
    const hour = new Date(reading.capturedAt);
    hour.setUTCMinutes(0, 0, 0);
    // Keep the first successful reading in an hour if overlapping runs race.
    const { error: writeError } = await supabase.from("steam_player_snapshots").upsert({
      sample_hour: hour.toISOString(),
      captured_at: reading.capturedAt,
      player_count: reading.playerCount,
    }, { onConflict: "sample_hour", ignoreDuplicates: true });
    if (writeError) {
      if (isMissingSupabaseRelation(writeError, "steam_player_snapshots")) {
        result.skips.push("steam_players_schema_unavailable");
        return;
      }
      throw new Error(`Steam player snapshot write failed: ${writeError.message}`);
    }
  } catch (error) {
    result.status = result.status === "success" ? "partial" : result.status;
    result.errors.push(toErrorMessage(error, "Steam player collection failed"));
    result.skips.push("steam_players_failed");
  }
}

async function persistPlatformContextSnapshot(
  supabase: ReturnType<typeof createServiceClient>,
  result: AutomationResult,
  now: Date,
): Promise<void> {
  if (!platformContextConfigured()) return;

  try {
    const { data: recentRows, error: recentError } = await supabase
      .from("platform_context_snapshots")
      .select("captured_at")
      .order("captured_at", { ascending: false })
      .limit(1);
    if (recentError) {
      if (isMissingSupabaseRelation(recentError, "platform_context_snapshots")) {
        result.skips.push("platform_context_schema_unavailable");
        return;
      }
      throw new Error(`platform context recency read failed: ${recentError.message}`);
    }
    const recent = (recentRows ?? [])[0] as { captured_at?: string | null } | undefined;
    const recentAt = recent?.captured_at ? new Date(recent.captured_at).getTime() : Number.NaN;
    if (Number.isFinite(recentAt) && now.getTime() - recentAt < PLATFORM_CONTEXT_INTERVAL_MS) {
      result.skips.push("platform_context_recent");
      return;
    }

    const context = await fetchCrimsonDesertPlatformContext({
      env: {
        TWITCH_CLIENT_ID: process.env.TWITCH_CLIENT_ID,
        TWITCH_CLIENT_SECRET: process.env.TWITCH_CLIENT_SECRET,
      },
      now,
    });
    const igdb = context.igdb.status === "ok" ? context.igdb.data : null;
    const twitch = context.twitch.status === "ok" ? context.twitch.data : null;
    const { error } = await supabase.from("platform_context_snapshots").insert({
      captured_at: context.capturedAt,
      igdb_status: context.igdb.status,
      igdb_game_id: igdb?.id ?? null,
      igdb_name: igdb?.name ?? null,
      igdb_slug: igdb?.slug ?? null,
      igdb_summary: igdb?.summary ?? null,
      igdb_first_release_at: igdb?.firstReleaseDate ?? null,
      igdb_platforms: igdb?.platforms ?? [],
      twitch_status: context.twitch.status,
      twitch_live_streams: twitch?.liveStreamCount ?? null,
      twitch_live_viewers: twitch?.liveViewerCount ?? null,
      twitch_complete: twitch?.isComplete ?? null,
    });
    if (error) {
      if (isMissingSupabaseRelation(error, "platform_context_snapshots")) {
        result.skips.push("platform_context_schema_unavailable");
        return;
      }
      throw new Error(`platform context snapshot write failed: ${error.message}`);
    }
    if (context.igdb.status !== "ok") result.skips.push(`platform_context_igdb_${context.igdb.status}`);
    if (context.twitch.status !== "ok") result.skips.push(`platform_context_twitch_${context.twitch.status}`);
  } catch (error) {
    // The evidence scan can still finish, but an unexpected persistence failure
    // must remain visible in run health instead of disappearing as a skip.
    result.status = result.status === "success" ? "partial" : result.status;
    result.errors.push(toErrorMessage(error, "Platform context persistence failed"));
    result.skips.push("platform_context_failed");
  }
}

async function collectInputs(
  result: AutomationResult,
  budget: AutomationBudget,
  now: Date,
  currentPatch: CurrentPatchContext,
  intent: ScanIntent,
  laneCount: number,
  report?: () => Promise<void>,
): Promise<SourceInput[]> {
  const inputs: SourceInput[] = [];
  const f = features();

  if (f.webSearch && budget.allowPaidSearch) {
    const startDate = currentPatch.publishedAt?.slice(0, 10) ?? null;
    // Wire slot: every few discovery TURNS, one general-search slot becomes the
    // press query on Tavily's news index — identical credit count, but the
    // trusted-press results it feeds into the observation lane carry real
    // published_date values. Discovery lanes only; backlog lanes stay whole.
    const discoveryTurn = Math.floor(searchRotationOffset(now) / Math.max(1, laneCount));
    const wireSlot =
      (intent === "broad_discovery" || intent === "forum_discovery" || intent === "community_pulse") &&
      budget.maxSearchQueries >= 2 &&
      discoveryTurn % WIRE_NEWS_TURN_INTERVAL === 0;
    for (const query of buildMemorySearchQueries(
      budget.maxSearchQueries - (wireSlot ? 1 : 0),
      currentPatch.version,
      intent,
      {
        rotationOffset: searchRotationOffset(now),
        targetClusterTitles: result.intent === "corroborate_cluster" ? result.targetClusterTitles : undefined,
        laneCount,
      },
    )) {
      try {
        result.searchQueriesUsed += 1;
        result.estimatedCostUsd += SEARCH_QUERY_COST_USD;
        const found = await tavilySearch(query, { now, startDate });
        result.searchResultsSeen += found.length;
        inputs.push(...found.slice(0, 5).map(searchResultToInput));
      } catch (error) {
        result.status = "partial";
        result.errors.push(toErrorMessage(error, "search failed"));
      }
      await report?.();
    }
    if (wireSlot) {
      try {
        result.searchQueriesUsed += 1;
        result.estimatedCostUsd += SEARCH_QUERY_COST_USD;
        const found = await tavilySearch(buildWireNewsQuery(), { now, startDate, topic: "news" });
        result.searchResultsSeen += found.length;
        inputs.push(...found.slice(0, 5).map(searchResultToInput));
      } catch (error) {
        result.status = "partial";
        result.errors.push(toErrorMessage(error, "wire news search failed"));
      }
      await report?.();
    }
  } else if (!f.webSearch) {
    result.skips.push("search_disabled");
  }

  return inputs;
}

async function prepareSignals(
  inputs: SourceInput[],
  result: AutomationResult,
  budget: AutomationBudget,
  currentPatch: CurrentPatchContext,
  clusterOptions: ClusterOption[],
  feedbackRules: ScannerFeedbackRule[],
  storedSourceDates: StoredObservationDates,
  now: Date,
  report?: () => Promise<void>,
): Promise<{ prepared: PreparedSignal[]; rejected: RejectedCandidate[]; observations: ObservationCandidate[] }> {
  const prepared: PreparedSignal[] = [];
  const rejected: RejectedCandidate[] = [];
  const observations: ObservationCandidate[] = [];
  const seenObservationHashes = new Set<string>();
  const seenUrls = new Set<string>();
  const seenExternalIds = new Set<string>();
  let reconFetchesUsed = 0;

  /**
   * Every date decision in this function starts here. `asserted` is what the
   * source itself claims (still format-, calendar- and skew-checked) and is
   * what freshness screening judges — current-patch eligibility is the code
   * that decides a pre-era source is stale, so it has to be able to see a
   * pre-era date. `displayable` additionally clears the patch-era floor and is
   * the only date that reaches the observation shelf.
   *
   * Judged at the candidate's own observedAt, not the wall clock, so a run is
   * deterministic for a given input set.
   */
  const resolveDates = (signal: SourceInput, canonicalUrl: string, sourceText: string) => {
    const observedMs = Date.parse(signal.observedAt);
    const nowMs = Number.isFinite(observedMs) ? observedMs : now.getTime();
    const input = {
      title: signal.title,
      sourceText,
      canonicalUrl,
      sourcePublishedAt: signal.sourcePublishedAt ?? null,
      storedDatesByCanonicalUrl: storedSourceDates.byCanonicalUrl,
    };
    return {
      asserted: resolveAssertedSourceDate(input, currentPatch, nowMs).value,
      displayable: resolveSourceDate(input, currentPatch, nowMs).value,
      providerDateStatus: classifyProviderSourceDate(input, nowMs),
    };
  };

  // Observation reroute: a genre-tagged pre-screen rejection from a trusted domain
  // is copied to the observation lane. The rejection itself is unchanged — the
  // candidate still lands in the rejected pile exactly as before.
  const collectObservation = (
    decision: { keep: false; reason: RelevanceSkipReason; observationKind?: ObservationKind },
    signal: SourceInput,
    canonicalUrl: string,
    snippet: string,
    displayableDate: string | null,
  ) => {
    if (!decision.observationKind) return;
    appendUniqueObservation(observations, {
      kind: decision.observationKind as ObservationKind,
      title: signal.title,
      url: canonicalUrl,
      sourceDomain: signal.sourceDomain,
      snippet: snippet.slice(0, 500),
      sourcePublishedAt: displayableDate,
      observedAt: signal.observedAt,
    }, seenObservationHashes, currentPatch.publishedAt);
  };
  // Recon uses Tavily's extract endpoint, so it must be gated on the SAME
  // configured-web-search signal as paid search in collectInputs. Without this,
  // an unset/rotated TAVILY_API_KEY makes tavilyExtract a no-op that still books
  // phantom credits into the monthly ledger. Computed once per run.
  const webSearchEnabled = features().webSearch;
  const limit = Math.max(25, budget.maxSearchResults + 25);
  const candidates = [
    ...inputs.filter((signal) => signal.source === "steam_review").slice(0, 100),
    ...inputs.filter((signal) => signal.source !== "steam_review").slice(0, limit),
  ];
  result.candidatesSeen += candidates.length;

  for (const signal of candidates) {
    let canonicalUrl: string;
    try {
      canonicalUrl = canonicalizeUrl(signal.url);
    } catch (error) {
      result.status = "partial";
      result.errors.push(toErrorMessage(error, "invalid signal URL"));
      continue;
    }

    const snippetDates = resolveDates(signal, canonicalUrl, signal.body);

    const externalId = signal.source === "web_search" ? canonicalUrl : signal.id;
    // Steam intake hashes the recommendation id at the provider boundary. Reuse
    // that opaque identifier so receipts and source-signal retries share one
    // stable key instead of hashing an already-hashed value a second time.
    const externalHash = signal.source === "steam_review"
      ? signal.id
      : externalIdHash(signal.source, externalId);
    if ((signal.source !== "steam_review" && seenUrls.has(canonicalUrl)) || seenExternalIds.has(externalHash)) {
      // First-wins for content — but a dated duplicate of a page already on
      // the observation shelf still donates its date before being dropped.
      // The wire returns some of the same URLs general search already
      // surfaced undated, and its copy is the only one carrying the
      // publication date the Brief requires. Steam reviews stay out: their
      // shared provider URL never identifies a page.
      if (signal.source !== "steam_review") {
        const donated = upgradeObservationDate(
          observations,
          canonicalUrl,
          snippetDates.displayable,
          currentPatch.publishedAt,
        );
        // No row to donate to: if the page's undated incarnation was
        // displaced from the shelf, its dated twin can still claim a fresh
        // consideration (appendUniqueObservation owns that rule). The
        // duplicate skipped the main pipeline, so it re-runs the same gates
        // its first sighting faced: a page already kept as a signal must
        // not also become an observation (one candidate yields a signal or
        // an observation, never both), operator block rules — a blocked
        // page must not re-enter through this side door — and the
        // pre-screen, which decides whether it is observation material at
        // all.
        if (
          !donated &&
          snippetDates.displayable &&
          !prepared.some((row) => row.canonicalUrl === canonicalUrl)
        ) {
          const duplicateRule = matchScannerFeedbackRule(
            { url: canonicalUrl, sourceDomain: signal.sourceDomain },
            feedbackRules,
            now,
          );
          if (duplicateRule?.action !== "block") {
            const duplicateScreen = preScreenCandidate(
              {
                title: signal.title,
                snippet: signal.body,
                url: canonicalUrl,
                sourceDomain: signal.sourceDomain,
                sourcePublishedAt: snippetDates.asserted,
              },
              { currentPatchVersion: currentPatch.version, currentPatchPublishedAt: currentPatch.publishedAt },
            );
            if (!duplicateScreen.keep) {
              collectObservation(duplicateScreen, signal, canonicalUrl, signal.body, snippetDates.displayable);
            }
          }
        }
      }
      result.signalsDeduped += 1;
      continue;
    }
    if (signal.source !== "steam_review") seenUrls.add(canonicalUrl);
    seenExternalIds.add(externalHash);

    // A missing provider date is allowed to take the explicitly undated Ask
    // path. A supplied date that failed format, calendar, or future-skew gates
    // is different evidence: it cannot establish freshness and must not be
    // laundered into "first seen by radar."
    if (snippetDates.providerDateStatus === "invalid") {
      result.skips.push("invalid_source_date");
      result.prefilterRejected += 1;
      rejected.push({
        source: signal.source,
        title: signal.title,
        url: canonicalUrl,
        sourceDomain: signal.sourceDomain,
        sourcePublishedAt: null,
        snippet: signal.body.slice(0, 500),
        reason: "invalid_source_date",
        steamRecommendationHash: signal.steam?.recommendationHash ?? null,
      });
      await report?.();
      continue;
    }

    // Steam reviews intentionally share one provider URL, so URL/path/domain
    // lessons cannot identify one review and must never filter this lane.
    const operatorRule = signal.source === "steam_review"
      ? null
      : matchScannerFeedbackRule(
          { url: canonicalUrl, sourceDomain: signal.sourceDomain },
          feedbackRules,
          now,
        );
    if (operatorRule?.action === "block") {
      result.operatorRulesMatched += 1;
      result.prefilterRejected += 1;
      result.skips.push("operator_rule_blocked");
      rejected.push({
        source: signal.source,
        title: signal.title,
        url: canonicalUrl,
        sourceDomain: signal.sourceDomain,
        sourcePublishedAt: snippetDates.asserted,
        snippet: signal.body.slice(0, 500),
        reason: operatorRule.rule.decision,
        feedbackRuleId: operatorRule.rule.id,
        steamRecommendationHash: signal.steam?.recommendationHash ?? null,
      });
      await report?.();
      continue;
    }
    const operatorAllowed = operatorRule?.action === "allow";
    if (operatorAllowed) {
      result.operatorRulesMatched += 1;
      result.skips.push("operator_rule_allowed");
    }

    // Cheap gate on raw source text, runs BEFORE any LLM call. Trade-off: a source
    // whose raw title+snippet has no symptom language is rejected without giving the
    // LLM a chance to rescue it. That rescue path was the waste this prefilter removes.
    const preScreen = operatorAllowed ? { keep: true as const } : preScreenCandidate(
      {
        title: signal.title,
        snippet: signal.body,
        url: canonicalUrl,
        sourceDomain: signal.sourceDomain,
        sourcePublishedAt: snippetDates.asserted,
      },
      { currentPatchVersion: currentPatch.version, currentPatchPublishedAt: currentPatch.publishedAt },
    );
    if (!preScreen.keep) {
      if (
        preScreen.reason === "source_not_issue_report" &&
        isBorderlineRescueCandidate(signal, snippetDates.asserted, currentPatch)
      ) {
        // Recon lane: read the real page ONCE before rejecting a promising
        // trusted current-patch candidate whose Tavily snippet is too thin. Bounded
        // by the per-run Tavily credit budget shared with search
        // (searchQueriesUsed < budget.maxTavilyCreditsPerRun) and capped at
        // MAX_RECON_FETCHES_PER_RUN. Scheduled budgets reserve this credit before
        // search allocation, while burst budgets remain capped at three total.
        // A recon miss (budget/cap/failure) falls straight through to today's
        // snippet-only borderline behavior — strict enhancement, never a regression.
        //
        // The credit is booked AFTER the call, and only an outcome Tavily states is
        // unbilled goes free. Three cases:
        //
        //   1. Page text returned      -> billed. Charge.
        //   2. Answered, no text       -> Tavily replies 200 with the URL in
        //      (nothing thrown)           `failed_results` and bills nothing, which
        //                                 tavilyExtract reports as null. Free.
        //   3. Threw                   -> a timeout, 5xx, or unparseable body can
        //                                 follow work Tavily already charged for. The
        //                                 outcome is unknown, so charge worst case,
        //                                 the same rule the OpenRouter circuit uses
        //                                 for unverifiable cost. Understating here
        //                                 would let a later run overrun the cap.
        //
        // Case 2 is why this mattered: booking up front spent a credit on nothing and,
        // because searchQueriesUsed gates real queries, took that query away from the
        // run. reddit.com is the first trusted domain and Reddit refuses Tavily's
        // fetcher, so every Reddit recon paid that toll. Same defect the
        // webSearchEnabled guard above already fixed for a missing key.
        //
        // Every attempt counts against MAX_RECON_FETCHES_PER_RUN, so an unreachable
        // domain cannot retry unbounded.
        let reconText: string | null = null;
        if (
          webSearchEnabled &&
          budget.allowPaidSearch &&
          reconFetchesUsed < MAX_RECON_FETCHES_PER_RUN &&
          result.searchQueriesUsed < budget.maxTavilyCreditsPerRun
        ) {
          reconFetchesUsed += 1;
          result.skips.push("candidate_recon");
          let reconThrew = false;
          try {
            reconText = await tavilyExtract(canonicalUrl, { now: new Date(signal.observedAt) });
          } catch (error) {
            reconThrew = true;
            result.status = "partial";
            result.errors.push(toErrorMessage(error, "recon extract failed"));
            reconText = null;
          }
          if (reconText !== null || reconThrew) {
            result.searchQueriesUsed += 1;
            result.estimatedCostUsd += SEARCH_QUERY_COST_USD;
          }
          if (reconText === null) {
            // Say which of the two empty outcomes happened: the operator console must
            // not report an unbilled refusal and a charged error as the same thing.
            result.skips.push(reconThrew ? "candidate_recon_failed" : "candidate_recon_unavailable");
          }
        }

        const effectiveBody = reconText ?? signal.body;
        // Recon fetched the real page, and the page can state a date the snippet
        // never carried (a Reddit byline lives in the thread, not the search
        // summary). Re-resolve against the fuller text before re-screening.
        const effectiveDates =
          reconText === null ? snippetDates : resolveDates(signal, canonicalUrl, effectiveBody);

        // Re-run the cheap gate on the FULL text. Recon may reveal the source is a
        // wrong-patch/stale/non-issue page after all — hard-reject on the real text.
        if (reconText !== null) {
          const reScreen = preScreenCandidate(
            {
              title: signal.title,
              snippet: effectiveBody,
              url: canonicalUrl,
              sourceDomain: signal.sourceDomain,
              sourcePublishedAt: effectiveDates.asserted,
            },
            { currentPatchVersion: currentPatch.version, currentPatchPublishedAt: currentPatch.publishedAt },
          );
          if (!reScreen.keep) {
            collectObservation(reScreen, signal, canonicalUrl, effectiveBody, effectiveDates.displayable);
            result.skips.push(reScreen.reason);
            result.prefilterRejected += 1;
            rejected.push({
              source: signal.source,
              title: signal.title,
              url: canonicalUrl,
              sourceDomain: signal.sourceDomain,
              sourcePublishedAt: effectiveDates.asserted,
              snippet: effectiveBody.slice(0, 500),
              reason: reScreen.reason,
              steamRecommendationHash: signal.steam?.recommendationHash ?? null,
            });
            await report?.();
            continue;
          }
        }

        const extraction = await extractSignalWithOpenRouter(
          { title: signal.title, snippet: effectiveBody, url: canonicalUrl },
          {
            llmCallsRemaining: remainingLlmCalls(result, budget),
            llmBudgetRemainingUsd: Math.max(0, budget.remainingLlmUsd - result.llmCostUsd),
            clusterOptions,
          },
        );
        result.llmCallsUsed += extraction.llmCallsUsed;
        result.llmCostUsd += extraction.llmCostUsd ?? 0;
        result.estimatedCostUsd += extraction.llmCostUsd ?? 0;
        if (extraction.fallbackReason) result.skips.push(extraction.fallbackReason);
        recordOpenRouterRunSkip(result, extraction.fallbackReason);

        const relevance = shouldKeepExtractedSignal(extraction, `${signal.title} ${effectiveBody}`);
        if (relevance.keep) {
          result.skips.push("candidate_rescued");
          result.candidatesRescued += 1;
          prepared.push({
            ...signal,
            body: effectiveBody,
            sourcePublishedAt: effectiveDates.asserted,
            canonicalUrl,
            externalHash,
            semantic: semanticFingerprint(extraction.issueTitle, extraction.category),
            extraction,
          });
          result.signalsPrepared += 1;
          await report?.();
          continue;
        }

        result.skips.push(relevance.reason);
        rejected.push({
          source: signal.source,
          title: signal.title,
          url: canonicalUrl,
          sourceDomain: signal.sourceDomain,
          sourcePublishedAt: effectiveDates.asserted,
          snippet: effectiveBody.slice(0, 500),
          reason: relevance.reason,
          steamRecommendationHash: signal.steam?.recommendationHash ?? null,
        });
        await report?.();
        continue;
      }

      collectObservation(preScreen, signal, canonicalUrl, signal.body, snippetDates.displayable);
      result.skips.push(preScreen.reason);
      result.prefilterRejected += 1;
      rejected.push({
        source: signal.source,
        title: signal.title,
        url: canonicalUrl,
        sourceDomain: signal.sourceDomain,
        sourcePublishedAt: snippetDates.asserted,
        snippet: signal.body.slice(0, 500),
        reason: preScreen.reason,
        steamRecommendationHash: signal.steam?.recommendationHash ?? null,
      });
      await report?.();
      continue;
    }

    const extraction = await extractSignalWithOpenRouter(
      { title: signal.title, snippet: signal.body, url: canonicalUrl },
      {
        llmCallsRemaining: remainingLlmCalls(result, budget),
        llmBudgetRemainingUsd: Math.max(0, budget.remainingLlmUsd - result.llmCostUsd),
        clusterOptions,
      },
    );
    result.llmCallsUsed += extraction.llmCallsUsed;
    result.llmCostUsd += extraction.llmCostUsd ?? 0;
    result.estimatedCostUsd += extraction.llmCostUsd ?? 0;
    if (extraction.fallbackReason) result.skips.push(extraction.fallbackReason);
    recordOpenRouterRunSkip(result, extraction.fallbackReason);

    const relevance = operatorAllowed
      ? { keep: true as const }
      : shouldKeepExtractedSignal(extraction, `${signal.title} ${signal.body}`);
    if (!relevance.keep) {
      result.skips.push(relevance.reason);
      rejected.push({
        source: signal.source,
        title: signal.title,
        url: canonicalUrl,
        sourceDomain: signal.sourceDomain,
        sourcePublishedAt: snippetDates.asserted,
        snippet: signal.body.slice(0, 500),
        reason: relevance.reason,
        steamRecommendationHash: signal.steam?.recommendationHash ?? null,
      });
      await report?.();
      continue;
    }

    prepared.push({
      ...signal,
      sourcePublishedAt: snippetDates.asserted,
      canonicalUrl,
      externalHash,
      semantic: semanticFingerprint(extraction.issueTitle, extraction.category),
      extraction,
    });
    result.signalsPrepared += 1;
    await report?.();
  }

  if (
    result.candidatesSeen > 0 &&
    result.signalsPrepared === 0 &&
    result.llmCallsUsed === 0 &&
    result.prefilterRejected > 0 &&
    !result.skips.includes("all_candidates_prefiltered")
  ) {
    result.skips.push("all_candidates_prefiltered");
  }

  return { prepared, rejected, observations };
}

async function loadApprovedReports(supabase: ReturnType<typeof createServiceClient>): Promise<ApprovedReportRow[]> {
  const { data, error } = await supabase
    .from("bug_reports")
    .select("id, cluster_id, category, platform, issue_title")
    .eq("moderation_status", "approved");
  if (error) throw new Error(`approved reports read failed: ${error.message}`);
  return (data ?? []) as ApprovedReportRow[];
}

async function loadApprovedExcerpts(supabase: ReturnType<typeof createServiceClient>): Promise<ApprovedExcerptRow[]> {
  const { data, error } = await supabase.from("approved_excerpts").select("id, report_id");
  if (error) throw new Error(`approved excerpts read failed: ${error.message}`);
  return (data ?? []) as ApprovedExcerptRow[];
}

export type SemanticClusterCandidate = {
  id: string;
  slug: string;
  title: string;
  category: string;
  description?: string | null;
  last_signal_at?: string | null;
  created_at?: string | null;
  lifecycle_reason?: string | null;
};

type RoutableClusterRow = SemanticClusterCandidate;

export const MAX_SEMANTIC_NAMED_CLUSTER_OPTIONS = 24;
export const MAX_SEMANTIC_AUTO_CLUSTER_OPTIONS = 24;
const ROUTABLE_CLUSTER_PAGE_SIZE = 1000;
const ROUTABLE_CLUSTER_COLUMNS =
  "id, slug, title, category, description, last_signal_at, created_at, lifecycle_reason";

function isAutoCluster(cluster: RoutableClusterRow): boolean {
  return cluster.slug.startsWith("auto-");
}

// Visibility overrides are temporary; only the persisted merge lifecycle retires a route.
function isActiveAutoCluster(cluster: RoutableClusterRow): boolean {
  return isAutoCluster(cluster) && !cluster.lifecycle_reason?.trimStart().startsWith("Merged into ");
}

function isRoutableClusterRow(value: unknown): value is RoutableClusterRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return ["id", "slug", "title", "category"].every((field) => typeof row[field] === "string" && row[field].trim() !== "");
}

/** Newest activity first, then creation, then slug: bounded and reproducible. */
function compareSemanticClusterRecency(left: RoutableClusterRow, right: RoutableClusterRow): number {
  const fields: (keyof Pick<RoutableClusterRow, "last_signal_at" | "created_at">)[] = ["last_signal_at", "created_at"];
  for (const field of fields) {
    const leftValue = left[field] ?? "";
    const rightValue = right[field] ?? "";
    if (leftValue === rightValue) continue;
    return leftValue < rightValue ? 1 : -1;
  }
  if (left.slug === right.slug) return 0;
  return left.slug < right.slug ? -1 : 1;
}

export function selectSemanticClusterOptions(clusters: SemanticClusterCandidate[]): ClusterOption[] {
  const select = (predicate: (cluster: RoutableClusterRow) => boolean, limit: number) =>
    clusters.filter(predicate).sort(compareSemanticClusterRecency).slice(0, limit);
  const named = select((cluster) => !isAutoCluster(cluster), MAX_SEMANTIC_NAMED_CLUSTER_OPTIONS);
  const auto = select(isActiveAutoCluster, MAX_SEMANTIC_AUTO_CLUSTER_OPTIONS);
  return [...named, ...auto].map((cluster) => ({
    slug: cluster.slug,
    title: cluster.title,
    category: cluster.category,
    description: cluster.description ?? null,
  }));
}

type ClusterRoutingState = {
  /** All explicitly named clusters preserve the existing keyword route path. */
  keywordClusters: RoutableClusterRow[];
  /** Bounded auto choices may be reached only by a parser-validated sure LLM assignment. */
  semanticRoutingClusters: RoutableClusterRow[];
  semanticOptions: ClusterOption[];
};

/**
 * Read every cluster with an immutable `id` cursor. The hosted PostgREST cap may
 * return fewer rows than requested, so only an empty page ends the walk.
 */
async function readAllRoutableClusterRows(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<RoutableClusterRow[]> {
  const rows: RoutableClusterRow[] = [];
  let after: string | null = null;
  for (;;) {
    const filtered = supabase.from("issue_clusters").select(ROUTABLE_CLUSTER_COLUMNS);
    const result = await (after === null ? filtered : filtered.gt("id", after))
      .order("id")
      .limit(ROUTABLE_CLUSTER_PAGE_SIZE);
    if (result.error) throw new Error(`routable clusters read failed: ${result.error.message}`);
    const pageRows = (result.data ?? []) as RoutableClusterRow[];
    if (pageRows.length === 0) return rows;
    rows.push(...pageRows);
    after = pageRows[pageRows.length - 1].id;
  }
}

async function loadClusterRoutingState(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<ClusterRoutingState> {
  const rows = await readAllRoutableClusterRows(supabase);
  // A complete database row always has these columns; retain the old
  // non-routing behavior for any malformed compatibility fixture/row instead
  // of throwing while constructing bounded semantic options.
  const allClusters = rows.filter(isRoutableClusterRow);
  const keywordClusters = allClusters.filter((cluster) => !isAutoCluster(cluster));
  const semanticOptions = selectSemanticClusterOptions(allClusters);
  const selectedAutoSlugs = new Set(
    semanticOptions.filter((option) => option.slug.startsWith("auto-")).map((option) => option.slug),
  );
  return {
    keywordClusters,
    semanticRoutingClusters: [
      ...keywordClusters,
      ...allClusters.filter((cluster) => isActiveAutoCluster(cluster) && selectedAutoSlugs.has(cluster.slug)),
    ],
    semanticOptions,
  };
}

type LifecycleClusterRow = ClaimMappingCluster & {
  fix_status: string;
  fix_claimed_at?: string | null;
  fix_claimed_patch_version?: string | null;
  admin_override?: boolean | null;
  lifecycle_reason?: string | null;
};

async function loadLifecycleClusters(supabase: ReturnType<typeof createServiceClient>): Promise<LifecycleClusterRow[]> {
  const { data, error } = await supabase
    .from("issue_clusters")
    .select("id, slug, title, category, description, fix_status, fix_claimed_at, fix_claimed_patch_version, admin_override, lifecycle_reason")
    .eq("is_public", true);
  if (error) throw new Error(`lifecycle clusters read failed: ${error.message}`);
  return (data ?? []) as LifecycleClusterRow[];
}

function decisionRank(decision: ClaimMappingDecision): number {
  if (decision.matchKind === "llm_sure") return 3;
  if (decision.matchKind === "llm_unsure" || decision.matchKind === "keyword_proposal") return 2;
  return 1;
}

function needsReviewReason(reason: string, fallback: string): string {
  const normalized = reason.trim() || fallback;
  return normalized.startsWith("Needs review:") ? normalized : `Needs review: ${normalized}`;
}

function toLifecycleClaimDecision(decision: ClaimMappingDecision | undefined): LifecycleClaimDecision | null {
  if (!decision) return null;
  if (decision.matchKind === "llm_sure") return { matchKind: "llm_sure", reason: decision.reason };
  if (decision.matchKind === "llm_unsure") {
    return {
      matchKind: "llm_unsure",
      reason: needsReviewReason(decision.reason, "PA claim was not confidently matched."),
    };
  }
  if (decision.matchKind === "keyword_proposal") {
    return {
      matchKind: "keyword_proposal",
      reason: needsReviewReason(decision.reason, "Keyword match is only a proposal."),
    };
  }
  return { matchKind: "none", reason: decision.reason };
}

async function writeLifecycleResult(
  supabase: ReturnType<typeof createServiceClient>,
  cluster: LifecycleClusterRow,
  computed: ReturnType<typeof computeClusterLifecycle>,
): Promise<void> {
  if (cluster.admin_override) {
    if (cluster.lifecycle_reason === computed.detail) return;
    const { error } = await supabase
      .from("issue_clusters")
      .update({ lifecycle_reason: computed.detail })
      .eq("id", cluster.id)
      .eq("admin_override", true);
    if (error) throw new Error(`lifecycle override reason update failed: ${error.message}`);
    return;
  }

  const patch: Record<string, unknown> = {};
  if (computed.status !== cluster.fix_status) patch.fix_status = computed.status;
  if (computed.fixClaimedAt !== (cluster.fix_claimed_at ?? null)) patch.fix_claimed_at = computed.fixClaimedAt;
  if (computed.fixClaimedPatchVersion !== (cluster.fix_claimed_patch_version ?? null)) {
    patch.fix_claimed_patch_version = computed.fixClaimedPatchVersion;
  }
  // Only human exceptions carry stored prose; normal states are composed at read time.
  const shouldWriteReason = computed.needsHuman;
  if (shouldWriteReason && cluster.lifecycle_reason !== computed.detail) {
    patch.lifecycle_reason = computed.detail;
  } else if (!shouldWriteReason && cluster.lifecycle_reason) {
    patch.lifecycle_reason = null;
  }
  if (Object.keys(patch).length === 0) return;

  let query = supabase
    .from("issue_clusters")
    .update(patch)
    .eq("id", cluster.id)
    .eq("admin_override", false)
    .eq("fix_status", cluster.fix_status);
  query = cluster.fix_claimed_at
    ? query.eq("fix_claimed_at", cluster.fix_claimed_at)
    : query.is("fix_claimed_at", null);
  query = cluster.fix_claimed_patch_version
    ? query.eq("fix_claimed_patch_version", cluster.fix_claimed_patch_version)
    : query.is("fix_claimed_patch_version", null);
  const { error } = await query;
  if (error) throw new Error(`lifecycle cluster update failed: ${error.message}`);
}

async function runLifecyclePass(
  supabase: ReturnType<typeof createServiceClient>,
  result: AutomationResult,
  budget: AutomationBudget,
  currentPatch: CurrentPatchContext,
  now: Date,
): Promise<void> {
  const [clusters, claims] = await Promise.all([
    loadLifecycleClusters(supabase),
    getClaimedFixesForCurrentPatch(supabase),
  ]);
  const claimDecisionByCluster = new Map<string, ClaimMappingDecision>();
  const initialLlmCallsRemaining = remainingLlmCalls(result, budget);
  const extractionReserve = budget.allowPaidSearch
    ? Math.min(MAX_RESERVED_EXTRACTION_LLM_CALLS, Math.floor(initialLlmCallsRemaining / 2))
    : 0;
  let claimLlmCallsRemaining = initialLlmCallsRemaining - extractionReserve;
  const claimOffset = claims.length > 0 ? Math.floor(now.getTime() / SEARCH_ROTATION_WINDOW_MS) % claims.length : 0;
  const orderedClaims = [...claims.slice(claimOffset), ...claims.slice(0, claimOffset)];

  for (const claim of orderedClaims) {
    const llmCallsRemaining = Math.min(claimLlmCallsRemaining, remainingLlmCalls(result, budget));
    const decision = await mapClaimToClusterWithOpenRouter(claim, clusters, {
      llmCallsRemaining,
      llmBudgetRemainingUsd: Math.max(0, budget.remainingLlmUsd - result.llmCostUsd),
    });
    result.llmCallsUsed += decision.llmCallsUsed;
    result.llmCostUsd += decision.llmCostUsd;
    result.estimatedCostUsd += decision.llmCostUsd;
    recordOpenRouterRunSkip(result, decision.skipReason);
    claimLlmCallsRemaining = Math.max(0, claimLlmCallsRemaining - decision.llmCallsUsed);
    if (!decision.clusterId) continue;
    const existing = claimDecisionByCluster.get(decision.clusterId);
    if (!existing || decisionRank(decision) > decisionRank(existing)) {
      claimDecisionByCluster.set(decision.clusterId, decision);
    }
  }

  for (const cluster of clusters) {
    const computed = computeClusterLifecycle({
      currentStatus: cluster.fix_status,
      fixClaimedAt: cluster.fix_claimed_at ?? null,
      fixClaimedPatchVersion: cluster.fix_claimed_patch_version ?? null,
      currentPatchVersion: currentPatch.version,
      adminOverride: Boolean(cluster.admin_override),
      now,
      claimDecision: toLifecycleClaimDecision(claimDecisionByCluster.get(cluster.id)),
    });
    await writeLifecycleResult(supabase, cluster, computed);
  }
}

function matchingReportCluster(signal: PreparedSignal, reports: ApprovedReportRow[]): string | null {
  const match = reports.find(
    (report) =>
      report.cluster_id &&
      report.category === signal.extraction.category &&
      semanticFingerprint(report.issue_title, report.category) === signal.semantic,
  );
  return match?.cluster_id ?? null;
}

async function findExistingSignalCluster(
  supabase: ReturnType<typeof createServiceClient>,
  semantic: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("source_signals")
    .select("cluster_id, source")
    .eq("semantic_fingerprint", semantic)
    .not("cluster_id", "is", null)
    .neq("source", "steam_review")
    .limit(1);
  if (error) throw new Error(`existing signal cluster read failed: ${error.message}`);
  const rows = (data ?? []) as SourceSignalRow[];
  return rows[0]?.cluster_id ?? null;
}

async function findAutoClusterBySlug(
  supabase: ReturnType<typeof createServiceClient>,
  slug: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("issue_clusters")
    .select("id")
    .eq("slug", slug)
    .limit(1);
  if (error) throw new Error(`auto-cluster slug read failed: ${error.message}`);
  const rows = (data ?? []) as { id?: string | null }[];
  return rows[0]?.id ?? null;
}

async function createCluster(supabase: ReturnType<typeof createServiceClient>, signal: PreparedSignal): Promise<string> {
  const slug = clusterSlug(signal.semantic);
  const { data, error } = await supabase
    .from("issue_clusters")
    .insert({
      slug,
      title: signal.extraction.issueTitle,
      category: signal.extraction.category,
      description: signal.extraction.summary,
      fix_status: "reported",
      confidence: clusterConfidence(signal.extraction.confidence),
      is_public: false,
      auto_public: false,
      signal_count: 0,
      direct_report_count: 0,
      verified_report_count: 0,
      public_signal_count: 0,
    })
    .select("id")
    .single();
  if (error) {
    const errorConstraint = (error as typeof error & { constraint?: unknown }).constraint;
    const isSlugConflict =
      error.code === "23505" &&
      (errorConstraint === "issue_clusters_slug_key" || error.message.includes("issue_clusters_slug_key"));
    if (isSlugConflict) {
      const existingId = await findAutoClusterBySlug(supabase, slug);
      if (existingId) return existingId;
    }
    throw new Error(error.message);
  }
  const id = (data as { id?: string } | null)?.id;
  if (!id) throw new Error("automation cluster insert returned no id");
  return id;
}

async function resolveClusterId(
  supabase: ReturnType<typeof createServiceClient>,
  signal: PreparedSignal,
  reports: ApprovedReportRow[],
  clusterBySemantic: Map<string, string>,
  routableClusters: RoutableCluster[],
): Promise<string | null> {
  const cached = clusterBySemantic.get(signal.semantic);
  if (cached) return cached;

  const existingSignalCluster = await findExistingSignalCluster(supabase, signal.semantic);
  const routedCluster = routeToWatchlistCluster(
    {
      issueTitle: signal.extraction.issueTitle,
      summary: signal.extraction.summary,
      category: signal.extraction.category,
      llmClusterAssignment: signal.extraction.clusterAssignment,
      llmClusterSlug: signal.extraction.clusterSlug,
    },
    routableClusters,
  );
  const reportCluster = matchingReportCluster(signal, reports);
  if (isProviderContextSource({ source: signal.source, domain: signal.sourceDomain, url: signal.canonicalUrl })) {
    // Steam reviews and the publisher's own pages are private provider context,
    // never player evidence. Either may support a cluster whose public-safe
    // metadata already exists, but neither may create durable titles or
    // descriptions from provider content. The guard lives HERE because an
    // operator rescue deliberately skips the pre-screen — marking an official
    // rejection Relevant stores the signal, and it must still never mint a
    // cluster. The canonical url rides along because the domain column is
    // nullable, and a candidate stored without one must not slip the guard.
    const clusterId = existingSignalCluster ?? routedCluster?.id ?? reportCluster;
    if (clusterId) clusterBySemantic.set(signal.semantic, clusterId);
    return clusterId ?? null;
  }
  const existingAutoCluster =
    existingSignalCluster || routedCluster?.id || reportCluster
      ? null
      : await findAutoClusterBySlug(supabase, clusterSlug(signal.semantic));
  const clusterId =
    existingSignalCluster ?? routedCluster?.id ?? reportCluster ?? existingAutoCluster ?? (await createCluster(supabase, signal));
  clusterBySemantic.set(signal.semantic, clusterId);
  return clusterId;
}

type SignalPersistence = {
  kind: "inserted" | "reobserved";
  previousClusterId: string | null;
};

/**
 * Process-lifetime latch for the optional re-observation ledger. The table
 * ships as a migration the owner applies manually, so a missing relation is
 * an expected production state: the first missing-table response turns the
 * ledger off for this process and scans continue untouched. First observations
 * need no event row — first_seen_at already records them.
 */
let observationLedgerAvailable = true;

function isMissingObservationLedgerError(error: { code?: string | null; message?: string | null }): boolean {
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /(?:relation|table).*signal_observation_events.*(?:does not exist|not found|schema cache)/i.test(
      error.message ?? "",
    )
  );
}

async function recordReobservationEvent(
  supabase: ReturnType<typeof createServiceClient>,
  signalId: string,
  runId: string | null,
  now: Date,
): Promise<void> {
  if (!observationLedgerAvailable) return;
  try {
    const { error } = await supabase.from("signal_observation_events").insert({
      signal_id: signalId,
      run_id: runId,
      observed_at: now.toISOString(),
    });
    if (!error) return;
    if (isMissingObservationLedgerError(error)) {
      observationLedgerAvailable = false;
      return;
    }
    throw new Error(`re-observation ledger write failed: ${error.message}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("re-observation ledger write failed:")) throw error;
    throw new Error(`re-observation ledger write failed: ${toErrorMessage(error, "unknown error")}`);
  }
}

async function upsertSignal(
  supabase: ReturnType<typeof createServiceClient>,
  signal: PreparedSignal,
  clusterId: string | null,
  now: Date,
  runId: string | null,
): Promise<SignalPersistence> {
  const rawExpiresAt = signal.body ? new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString() : null;
  const baseRow = {
    source: signal.source,
    source_type: signal.source,
    source_url: signal.canonicalUrl,
    canonical_url: signal.canonicalUrl,
    external_id_hash: signal.externalHash,
    title: signal.title.slice(0, 240),
    source_domain: signal.sourceDomain,
    source_published_at: signal.sourcePublishedAt ?? null,
    semantic_fingerprint: signal.semantic,
    cluster_id: clusterId,
    summary: signal.extraction.summary,
    extracted_facts: {
      issueTitle: signal.extraction.issueTitle,
      platform: signal.extraction.platform,
      ...(signal.steam
        ? {
            steamVotedUp: signal.steam.votedUp,
            playtimeAtReviewMinutes: signal.steam.playtimeAtReviewMinutes,
            sourceUpdatedAt: signal.steam.sourceUpdatedAt,
          }
        : {}),
    },
    category: signal.extraction.category,
    confidence: signal.extraction.confidence,
    observed_at: signal.observedAt,
    raw_text: signal.body.slice(0, 8000) || null,
    raw_expires_at: rawExpiresAt,
    public_status: "private",
    extraction_provider: signal.extraction.extractionProvider,
    extraction_model: signal.extraction.extractionModel,
    cost_estimate_usd: signal.extraction.llmCostUsd ?? 0,
  };

  const { data: existingRows, error: existingError } = await supabase
    .from("source_signals")
    .select("id, seen_count, first_seen_at, cluster_id")
    .eq("external_id_hash", signal.externalHash)
    .limit(1);
  if (existingError) throw new Error(`source signal memory read failed: ${existingError.message}`);

  const existing = ((existingRows ?? []) as SourceSignalRow[])[0];
  if (existing?.id) {
    const { error } = await supabase
      .from("source_signals")
      .update({
        ...baseRow,
        first_seen_at: existing.first_seen_at ?? now.toISOString(),
        last_seen_at: now.toISOString(),
        seen_count: Number(existing.seen_count ?? 1) + 1,
        last_seen_run_id: runId,
      })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
    await recordReobservationEvent(supabase, existing.id, runId, now);
    return { kind: "reobserved", previousClusterId: existing.cluster_id ?? null };
  }

  const { error } = await supabase.from("source_signals").insert({
    ...baseRow,
    first_seen_at: now.toISOString(),
    last_seen_at: now.toISOString(),
    seen_count: 1,
    last_seen_run_id: runId,
  });
  if (error) throw new Error(error.message);
  return { kind: "inserted", previousClusterId: null };
}

async function loadCluster(supabase: ReturnType<typeof createServiceClient>, clusterId: string): Promise<ClusterRow> {
  const { data, error } = await supabase
    .from("issue_clusters")
    .select(
      "id, category, admin_visibility_override, auto_public, is_public, visibility_restore_auto_public, visibility_restore_is_public, visibility_revision",
    )
    .eq("id", clusterId)
    .limit(1);
  if (error) throw new Error(`automation cluster read failed: ${error.message}`);
  const row = ((data ?? []) as ClusterRow[])[0];
  if (!row) throw new Error(`automation cluster not found: ${clusterId}`);
  return row;
}

async function loadClusterSignals(
  supabase: ReturnType<typeof createServiceClient>,
  clusterId: string,
): Promise<SourceSignalRow[]> {
  const { data, error } = await supabase
    .from("source_signals")
    .select(
      "id, source_url, canonical_url, source, source_type, source_domain, title, summary, category, confidence, observed_at, source_published_at, public_status, extracted_facts",
    )
    .eq("cluster_id", clusterId);
  if (error) throw new Error(`cluster signals read failed: ${error.message}`);
  return (data ?? []) as SourceSignalRow[];
}

async function refreshClusterStats(
  supabase: ReturnType<typeof createServiceClient>,
  clusterId: string,
  now: Date,
): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // Read the revision before every input it protects. If a report/override
    // changes afterward, its database trigger bumps the revision and the RPC
    // rejects this entire snapshot before any visibility row is written.
    const cluster = await loadCluster(supabase, clusterId);
    const [signals, activeReports, activeExcerpts, activeCurrentPatch] = await Promise.all([
      loadClusterSignals(supabase, clusterId),
      loadApprovedReports(supabase),
      loadApprovedExcerpts(supabase),
      getCurrentPatchMetadata(supabase),
    ]);
    const feedbackRules = await loadActiveScannerFeedbackRules(supabase);
    // Broad path/domain lessons gate future intake only. Re-evaluating stored
    // evidence may honor an exact reviewed URL, but must not retroactively
    // rewrite evidence counts because a later candidate taught a broad rule.
    const retainedSignalRules = feedbackRules.filter((rule) => rule.scopeType === "exact_url");
    const signalRuleMatches = new Map(
      signals.map((signal) => [
        signal.id,
        matchScannerFeedbackRule(
          { url: storedRecordUrl(signal), sourceDomain: signal.source_domain ?? null },
          retainedSignalRules,
          now,
          // Stored record against stored rule, neither side re-canonicalized.
          // Whether a signal counts as evidence is fixed at the moment it was
          // reviewed, and no later widening of canonicalization can move it in
          // either direction — not by breaking a block that matched, and not by
          // extending one across records that were stored separately.
          { exactUrlAsRecorded: true },
        ),
      ]),
    );
    const isOperatorBlocked = (signal: SourceSignalRow) =>
      signalRuleMatches.get(signal.id)?.action === "block";
    const clusterReports = activeReports.filter((report) => report.cluster_id === clusterId);
    const reportIds = new Set(clusterReports.map((report) => report.id));
    const verifiedReportCount = new Set(
      activeExcerpts.filter((excerpt) => reportIds.has(excerpt.report_id)).map((excerpt) => excerpt.report_id),
    ).size;
    const publishableSignals = signals.filter(
      (signal) =>
        !isOperatorBlocked(signal) &&
        !isContextOnlySignal(signal) &&
        !isUnsupportedStoredSignal(signal) &&
        hasStoredSignalGameContext(signal) &&
        sourceSignalEligibility(signal, activeCurrentPatch).canPublish,
    );
    const { independentDomainCount, trustedDomainCount } = domainCounts(publishableSignals, now);

    const automaticDecision = shouldPromoteSignalCluster({
      independentDomainCount,
      trustedDomainCount,
      directReportCount: clusterReports.length,
      hasAdminForcePublic: false,
      hasAdminForceHidden: false,
    });
    const decision = cluster.admin_visibility_override
      ? shouldPromoteSignalCluster({
          independentDomainCount,
          trustedDomainCount,
          directReportCount: clusterReports.length,
          hasAdminForcePublic: cluster.admin_visibility_override === "force_public",
          hasAdminForceHidden: cluster.admin_visibility_override === "force_hidden",
        })
      : automaticDecision;

    // A cluster's approved report makes the CLUSTER public (direct_report_match), but
    // an individual scanner signal only counts as standalone public evidence if the
    // cluster is independently corroborated by domains. This mirrors the domain-count
    // thresholds in shouldPromoteSignalCluster so an untrusted single-domain signal
    // riding a direct report is not published on its own.
    const corroboratedByDomains =
      (independentDomainCount >= 2 && trustedDomainCount >= 1) || independentDomainCount >= 3;
    let publicSignalCount = 0;
    const signalPatches = signals.map((signal) => {
      if (!signal.id) throw new Error(`cluster signal is missing an id: ${clusterId}`);
      const unsupported = isUnsupportedStoredSignal(signal);
      const offTopic = !hasStoredSignalGameContext(signal);
      const contextOnly = isContextOnlySignal(signal);
      const operatorBlocked = isOperatorBlocked(signal);
      const eligibility = sourceSignalEligibility(signal, activeCurrentPatch);
      const shouldHideStale =
        unsupported ||
        offTopic ||
        (!eligibility.canPublish &&
          (signal.public_status === "public" || eligibility.reason === "wrong_patch" || eligibility.reason === "stale_source"));
      let publicStatus: "public" | "private" | "hidden";
      let promotionReason: string;
      if (operatorBlocked) {
        publicStatus = "hidden";
        promotionReason = "operator_feedback_blocked";
      } else if (!contextOnly && !unsupported && !offTopic && eligibility.canPublish) {
        const resolved = resolveSignalPublicStatus({
          decision,
          signalTrusted: domainTier(signalDomain(signal)) === "trusted",
          corroboratedByDomains,
        });
        publicStatus = resolved.publicStatus;
        promotionReason = resolved.reason;
      } else {
        publicStatus = shouldHideStale ? "hidden" : "private";
        promotionReason = contextOnly && !shouldHideStale
          ? "source_context_only"
          : shouldHideStale
          ? stalePromotionReason(unsupported ? "source_not_issue_report" : offTopic ? "off_topic" : eligibility.reason)
          : "below_threshold";
      }
      if (publicStatus === "public") publicSignalCount += 1;
      return {
        id: signal.id,
        public_status: publicStatus,
        promoted_at: publicStatus === "public" ? now.toISOString() : null,
        promotion_reason: promotionReason,
      };
    });

    // Forced visibility is only the effective presentation state. Retention and
    // demotion must be calculated from the engine-owned baseline kept underneath it.
    const priorAutomaticIsPublic = cluster.admin_visibility_override
      ? (cluster.visibility_restore_is_public ?? cluster.is_public ?? false)
      : (cluster.is_public ?? false);
    const priorAutomaticOwner = cluster.admin_visibility_override
      ? (cluster.visibility_restore_auto_public ?? cluster.auto_public ?? false)
      : (cluster.auto_public ?? false);
    const hasPublicEvidence = publicSignalCount > 0 || clusterReports.length > 0;
    const hasLiveCandidates = signals.some(
      (signal) =>
        !isOperatorBlocked(signal) &&
        !isContextOnlySignal(signal) &&
        !isUnsupportedStoredSignal(signal) &&
        hasStoredSignalGameContext(signal) &&
        sourceSignalEligibility(signal, activeCurrentPatch).canStore,
    );
    const automaticIsPublic =
      automaticDecision.publicStatus === "public"
        ? true
        : priorAutomaticIsPublic && hasLiveCandidates
          ? true
          : priorAutomaticOwner && !hasPublicEvidence
            ? false
            : priorAutomaticIsPublic;

    const { data: applied, error: applyError } = await supabase.rpc("apply_cluster_visibility_refresh", {
      p_cluster_id: clusterId,
      p_expected_revision: Number(cluster.visibility_revision ?? 0),
      p_signal_patches: signalPatches,
      p_cluster_patch: {
        signal_count: signals.length,
        direct_report_count: clusterReports.length,
        verified_report_count: verifiedReportCount,
        public_signal_count: publicSignalCount,
        last_signal_at: lastObservedAt(signals),
        auto_public: automaticDecision.publicStatus === "public",
        // The RPC derives override-effective visibility from this automatic baseline.
        is_public: automaticIsPublic,
      },
    });
    if (applyError) throw new Error(`cluster visibility refresh apply failed: ${applyError.message}`);
    if (applied === true) return automaticDecision.publicStatus === "public" && !priorAutomaticOwner;
    if (attempt === 2) throw new Error(`cluster visibility refresh conflicted repeatedly: ${clusterId}`);
  }

  throw new Error(`cluster visibility refresh did not complete: ${clusterId}`);
}

export async function refreshClusterVisibility(clusterId: string, now = new Date()): Promise<void> {
  const supabase = createServiceClient();
  await refreshClusterStats(supabase, clusterId, now);
}

/**
 * Persist one prepared signal into its resolved cluster and refresh that
 * cluster's promotion stats. Shared by the batch `persistSignals` path and
 * the single-signal admin rescue path.
 */
async function persistOneSignal(
  supabase: ReturnType<typeof createServiceClient>,
  signal: PreparedSignal,
  reports: ApprovedReportRow[],
  clusterBySemantic: Map<string, string>,
  routableClusters: RoutableCluster[],
  now: Date,
  runId: string | null,
): Promise<{ clusterId: string | null; promoted: boolean; reobserved: boolean }> {
  const clusterId = await resolveClusterId(supabase, signal, reports, clusterBySemantic, routableClusters);
  // resolveClusterId returns null ONLY for provider context with no existing
  // cluster to support (a steam review, an official page). Store the signal
  // clusterless exactly as the batch path does — provider content never mints
  // a cluster, and failing the rescue would punish the operator for the
  // boundary holding.
  const touchedClusters = new Set<string>(clusterId ? [clusterId] : []);
  let persistence: SignalPersistence | null = null;
  let persistenceError: unknown = null;
  let promoted = false;

  try {
    persistence = await upsertSignal(supabase, signal, clusterId, now, runId);
    if (persistence.previousClusterId && persistence.previousClusterId !== clusterId) {
      touchedClusters.add(persistence.previousClusterId);
    }
  } catch (error) {
    persistenceError = error;
  } finally {
    for (const touchedClusterId of touchedClusters) {
      try {
        if (await refreshClusterStats(supabase, touchedClusterId, now)) promoted = true;
      } catch (error) {
        if (persistenceError === null) persistenceError = error;
      }
    }
  }

  if (persistenceError !== null) throw persistenceError;
  if (!persistence) throw new Error("automation signal persistence returned no result");
  return { clusterId, promoted, reobserved: persistence.kind === "reobserved" };
}

async function persistSignals(
  supabase: ReturnType<typeof createServiceClient>,
  signals: PreparedSignal[],
  result: AutomationResult,
  now: Date,
  routableClusters: RoutableCluster[],
  runId: string,
): Promise<{ persistedSteamReviewHashes: Set<string>; error: unknown | null }> {
  const persistedSteamReviewHashes = new Set<string>();
  const clusterBySemantic = new Map<string, string>();
  const touchedClusters = new Set<string>();
  let persistenceError: unknown = null;

  try {
    const reports = await loadApprovedReports(supabase);
    for (const signal of signals) {
      const clusterId = await resolveClusterId(supabase, signal, reports, clusterBySemantic, routableClusters);
      if (clusterId) touchedClusters.add(clusterId);
      const persistence = await upsertSignal(supabase, signal, clusterId, now, runId);
      if (signal.source === "steam_review" && signal.steam?.recommendationHash) {
        persistedSteamReviewHashes.add(signal.steam.recommendationHash);
      }
      if (persistence.kind === "reobserved") result.signalsReobserved += 1;
      else result.signalsInserted += 1;
      if (persistence.previousClusterId && persistence.previousClusterId !== clusterId) {
        touchedClusters.add(persistence.previousClusterId);
      }
    }
  } catch (error) {
    persistenceError = error;
  } finally {
    for (const clusterId of touchedClusters) {
      try {
        if (await refreshClusterStats(supabase, clusterId, now)) result.clustersPromoted += 1;
      } catch (error) {
        if (persistenceError === null) persistenceError = error;
      }
    }
  }

  return { persistedSteamReviewHashes, error: persistenceError };
}

async function quarantineStalePublicSignals(
  supabase: ReturnType<typeof createServiceClient>,
  result: AutomationResult,
  now: Date,
  currentPatch: CurrentPatchContext,
): Promise<void> {
  const publicSignals = await loadPublicSignalsForAudit(supabase);
  const staleSignals = publicSignals.filter(
    (signal) =>
      isContextOnlySignal(signal) ||
      isUnsupportedStoredSignal(signal) ||
      !hasStoredSignalGameContext(signal) ||
      !sourceSignalEligibility(signal, currentPatch).canPublish,
  );
  if (staleSignals.length === 0) return;

  const touchedClusters = new Set<string>();
  for (const signal of staleSignals) {
    if (!signal.id) continue;
    const eligibility = sourceSignalEligibility(signal, currentPatch);
    const unsupported = isUnsupportedStoredSignal(signal);
    const offTopic = !hasStoredSignalGameContext(signal);
    const contextOnly = isContextOnlySignal(signal);
    const hide = unsupported || offTopic || !eligibility.canPublish;
    const { error } = await supabase
      .from("source_signals")
      .update({
        public_status: hide ? "hidden" : "private",
        promoted_at: null,
        promotion_reason:
          contextOnly && !hide
            ? "source_context_only"
            : stalePromotionReason(unsupported ? "source_not_issue_report" : offTopic ? "off_topic" : eligibility.reason),
      })
      .eq("id", signal.id);
    if (error) throw new Error(`stale source signal quarantine failed: ${error.message}`);
    if (hide) result.staleSignalsHidden += 1;
    if (signal.cluster_id) touchedClusters.add(signal.cluster_id);
  }

  if (touchedClusters.size === 0) return;
  for (const clusterId of touchedClusters) {
    await refreshClusterStats(supabase, clusterId, now);
  }
}

async function createRunLedger(
  supabase: ReturnType<typeof createServiceClient>,
  mode: AutomationMode,
  budget: AutomationBudget,
  now: Date,
  patchBurstActive = false,
): Promise<string> {
  const { data, error } = await supabase
    .from("automation_runs")
    .insert({
      started_at: now.toISOString(),
      status: "running",
      mode,
      budget_monthly_usd: budget.monthlyBudgetUsd,
      budget_remaining_before_usd: budget.remainingMonthUsd,
      skips: patchBurstActive ? ["patch_burst_active"] : [],
      progress: {
        stage: "starting",
        searchesDone: 0,
        searchTotal: budget.maxSearchQueries,
        candidatesSeen: 0,
        prefilterRejected: 0,
        llmCallsUsed: 0,
        kept: 0,
        promoted: 0,
      } satisfies RunProgress,
    })
    .select("id")
    .single();
  if (error) throw new Error(`automation run create failed: ${error.message}`);
  const id = (data as { id?: string } | null)?.id;
  if (!id) throw new Error("automation run create returned no id");
  return id;
}

async function finalizeRunLedger(
  supabase: ReturnType<typeof createServiceClient>,
  runId: string,
  result: AutomationResult,
): Promise<void> {
  const legacyPatch = {
    finished_at: new Date().toISOString(),
    status: result.errors.length > 0 && result.status === "success" ? "partial" : result.status,
    estimated_cost_usd: result.estimatedCostUsd,
    // Historical column, kept only so the ledger schema and its readers stay
    // unchanged. The authenticated Reddit API is gone; nothing can raise it.
    reddit_posts_seen: 0,
    search_queries_used: result.searchQueriesUsed,
    search_results_seen: result.searchResultsSeen,
    llm_calls_used: result.llmCallsUsed,
    signals_inserted: result.signalsInserted,
    signals_deduped: result.signalsDeduped,
    clusters_promoted: result.clustersPromoted,
    intent: result.intent,
    signals_reobserved: result.signalsReobserved,
    stale_signals_hidden: result.staleSignalsHidden,
    candidates_rescued: result.candidatesRescued,
    skips: result.skips,
    errors: result.errors,
    funnel: {
      searchResultsSeen: result.searchResultsSeen,
      candidatesSeen: result.candidatesSeen,
      deduped: result.signalsDeduped,
      prefilterRejected: result.prefilterRejected,
      llmEligible: Math.max(0, result.candidatesSeen - result.signalsDeduped - result.prefilterRejected),
      llmCalls: result.llmCallsUsed,
      prepared: result.signalsPrepared,
      persisted: result.signalsInserted,
      kept: result.signalsPrepared,
      promoted: result.clustersPromoted,
      observations: result.observationsKept,
    },
    progress: snapshotProgress("done", result, result.searchQueriesUsed),
  };
  const { error } = await supabase
    .from("automation_runs")
    .update({ ...legacyPatch, operator_rules_matched: result.operatorRulesMatched })
    .eq("id", runId);
  if (!error) return;
  if (!isMissingSupabaseColumn(error, "automation_runs", "operator_rules_matched")) {
    throw new Error(`automation run finalize failed: ${error.message}`);
  }
  const { error: legacyError } = await supabase.from("automation_runs").update(legacyPatch).eq("id", runId);
  if (legacyError) throw new Error(`automation run finalize failed: ${legacyError.message}`);
}

const MAX_REJECTED_CANDIDATES_PER_RUN = 50;

async function persistRejectedCandidates(
  supabase: ReturnType<typeof createServiceClient>,
  runId: string,
  rejected: RejectedCandidate[],
  result: AutomationResult,
  now: Date,
): Promise<void> {
  // Steam review text is deliberately retained only on a kept, private lead.
  // Rejected reviews share one generic app URL, so putting them in the URL-keyed
  // rescue archive would merge unrelated reviews and retain text unnecessarily.
  const reviewableRejected = rejected.filter((candidate) => candidate.source !== "steam_review");
  if (reviewableRejected.length === 0) return;
  // Rescue memory: a URL that already lives in source_signals (typically via an
  // admin rescue) is a tracked lead — re-rejecting it would contradict the
  // operator's decision every run. Record a re-observation instead so the
  // lead's freshness reflects that the scanner saw it again. Best-effort: a URL
  // leaves the rejected pile ONLY after its re-observation fully commits, so a
  // mid-loop failure cannot lose candidates from both paths.
  const reobservedUrls = new Set<string>();
  const reobservedByCluster = new Map<string, string[]>();
  const markReobserved = (url: string) => {
    reobservedUrls.add(url);
    result.signalsReobserved += 1;
    result.skips.push("rescued_signal_reobserved");
  };
  try {
    const urls = [...new Set(reviewableRejected.map((candidate) => candidate.url))];
    const { data, error } = await supabase
      .from("source_signals")
      .select("id, canonical_url, cluster_id, seen_count")
      .in("canonical_url", urls);
    if (error) throw new Error(error.message);
    const tracked = new Map(
      ((data ?? []) as { id: string; canonical_url: string | null; cluster_id: string | null; seen_count: number | null }[])
        .filter((row) => row.canonical_url)
        .map((row) => [row.canonical_url as string, row]),
    );
    for (const [url, row] of tracked) {
      const { error: updateError } = await supabase
        .from("source_signals")
        .update({
          observed_at: now.toISOString(),
          last_seen_at: now.toISOString(),
          seen_count: Number(row.seen_count ?? 1) + 1,
          last_seen_run_id: runId,
        })
        .eq("id", row.id);
      if (updateError) throw new Error(updateError.message);
      await recordReobservationEvent(supabase, row.id, runId, now);
      if (row.cluster_id) {
        const clusterUrls = reobservedByCluster.get(row.cluster_id) ?? [];
        clusterUrls.push(url);
        reobservedByCluster.set(row.cluster_id, clusterUrls);
      } else {
        markReobserved(url);
      }
    }
    for (const [clusterId, clusterUrls] of reobservedByCluster) {
      if (await refreshClusterStats(supabase, clusterId, now)) result.clustersPromoted += 1;
      for (const url of clusterUrls) markReobserved(url);
    }
  } catch (error) {
    // Best-effort bookkeeping only — a failed read or update must not degrade
    // the run status; URLs not yet re-observed fall through to the rejected
    // pile below exactly as they would have without this block.
    result.skips.push("rescue_memory_read_failed");
    void error;
  }
  let candidates =
    reobservedUrls.size > 0
      ? reviewableRejected.filter((candidate) => !reobservedUrls.has(candidate.url))
      : reviewableRejected;
  if (candidates.length === 0) return;
  // Dedupe against the un-expired reject pile: the same page resurfaces in
  // search run after run (one patch-notes mirror was stored 7×). Refresh the
  // existing row — retention window AND current classification (reason, title,
  // snippet), so a re-screen that changes the reason is reflected — instead of
  // stacking duplicates. Same commitment rule as above: a URL is suppressed
  // only after its refresh succeeds.
  const refreshedUrls = new Set<string>();
  let feedbackColumnAvailable = true;
  try {
    const byUrl = new Map(candidates.map((candidate) => [candidate.url, candidate]));
    const { data, error } = await supabase
      .from("automation_rejected_candidates")
      .select("id, url")
      .in("url", [...byUrl.keys()])
      .gt("expires_at", now.toISOString());
    if (error) throw new Error(error.message);
    const refreshedExpiry = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    for (const row of (data ?? []) as { id: string; url: string }[]) {
      const candidate = byUrl.get(row.url);
      if (!candidate || refreshedUrls.has(row.url)) continue;
      const legacyPatch = {
        run_id: runId,
        title: candidate.title,
        snippet: candidate.snippet,
        reason: candidate.reason,
        source_published_at: candidate.sourcePublishedAt ?? null,
        expires_at: refreshedExpiry,
      };
      const refreshResult = await supabase
        .from("automation_rejected_candidates")
        .update(
          feedbackColumnAvailable
            ? { ...legacyPatch, feedback_rule_id: candidate.feedbackRuleId ?? null }
            : legacyPatch,
        )
        .eq("id", row.id);
      if (
        refreshResult.error &&
        feedbackColumnAvailable &&
        isMissingSupabaseColumn(refreshResult.error, "automation_rejected_candidates", "feedback_rule_id")
      ) {
        feedbackColumnAvailable = false;
        const { error: legacyError } = await supabase
          .from("automation_rejected_candidates")
          .update(legacyPatch)
          .eq("id", row.id);
        if (legacyError) throw new Error(legacyError.message);
      } else if (refreshResult.error) {
        throw new Error(refreshResult.error.message);
      }
      refreshedUrls.add(row.url);
    }
  } catch (error) {
    result.skips.push("reject_dedupe_read_failed");
    void error;
  }
  if (refreshedUrls.size > 0) {
    candidates = candidates.filter((candidate) => !refreshedUrls.has(candidate.url));
  }
  if (candidates.length === 0) return;
  const rows = candidates.slice(0, MAX_REJECTED_CANDIDATES_PER_RUN).map((candidate) => ({
    run_id: runId,
    title: candidate.title,
    url: candidate.url,
    source_domain: candidate.sourceDomain,
    source_published_at: candidate.sourcePublishedAt ?? null,
    snippet: candidate.snippet,
    reason: candidate.reason,
    feedback_rule_id: candidate.feedbackRuleId ?? null,
  }));
  const legacyRows = rows.map(({ run_id, title, url, source_domain, source_published_at, snippet, reason }) => ({
    run_id,
    title,
    url,
    source_domain,
    source_published_at,
    snippet,
    reason,
  }));
  let insertResult = await supabase.from("automation_rejected_candidates").insert(
    feedbackColumnAvailable ? rows : legacyRows,
  );
  if (
    insertResult.error &&
    feedbackColumnAvailable &&
    isMissingSupabaseColumn(insertResult.error, "automation_rejected_candidates", "feedback_rule_id")
  ) {
    feedbackColumnAvailable = false;
    insertResult = await supabase
      .from("automation_rejected_candidates")
      .insert(legacyRows);
  }
  if (insertResult.error) {
    result.status = result.status === "success" ? "partial" : result.status;
    result.errors.push(`rejected candidates insert failed: ${insertResult.error.message}`);
  }
}

async function deleteExpiredRejectedCandidates(
  supabase: ReturnType<typeof createServiceClient>,
  now: Date,
  result: AutomationResult,
): Promise<void> {
  const { error } = await supabase.from("automation_rejected_candidates").delete().lt("expires_at", now.toISOString());
  if (error) {
    result.status = result.status === "success" ? "partial" : result.status;
    result.errors.push(`expired rejected candidates cleanup failed: ${error.message}`);
  }
}

/**
 * Finalize without ever throwing: `executeAutomationRun`'s promise is handed out
 * detached (`StartedScan.completion`), so a rejection here would be an
 * unhandled-rejection crash for any fire-and-forget caller. If the finalize
 * write fails, the row stays `running` and the stale sweep marks it failed
 * later — that is the designed recovery path.
 */
async function finalizeRunLedgerSafely(
  supabase: ReturnType<typeof createServiceClient>,
  runId: string,
  result: AutomationResult,
): Promise<void> {
  try {
    await finalizeRunLedger(supabase, runId, result);
  } catch (error) {
    result.errors.push(toErrorMessage(error, "automation run finalize failed"));
    if (result.status === "success") result.status = "failed";
  }
}

/** Never rejects — always resolves to an AutomationResult (see finalizeRunLedgerSafely). */
async function executeAutomationRun(
  supabase: ReturnType<typeof createServiceClient>,
  runId: string,
  mode: AutomationMode,
  budget: AutomationBudget,
  budgetReadError: string | null,
  openRouterCircuitOpen: boolean,
  patchMetadata: CurrentPatchMetadata,
  patchSyncError: string | null,
  patchBurstActive: boolean,
  now: Date,
): Promise<AutomationResult> {
  const result: AutomationResult = {
    status: "success",
    searchQueriesUsed: 0,
    searchResultsSeen: 0,
    llmCallsUsed: 0,
    candidatesSeen: 0,
    prefilterRejected: 0,
    signalsPrepared: 0,
    signalsInserted: 0,
    signalsDeduped: 0,
    clustersPromoted: 0,
    intent: "broad_discovery",
    targetClusterTitles: [],
    signalsReobserved: 0,
    staleSignalsHidden: 0,
    candidatesRescued: 0,
    observationsKept: 0,
    operatorRulesMatched: 0,
    estimatedCostUsd: 0,
    llmCostUsd: 0,
    skips: [
      ...budget.skipReasons,
      ...(patchBurstActive ? ["patch_burst_active"] : []),
      ...(openRouterCircuitOpen ? ["openrouter_circuit_open"] : []),
    ],
    errors: [],
  };

  if (patchSyncError) {
    result.status = "partial";
    result.errors.push(patchSyncError);
  }

  if (budgetReadError) {
    result.status = "skipped";
    result.skips.push("budget_read_failed");
    result.errors.push(budgetReadError);
    await finalizeRunLedgerSafely(supabase, runId, result);
    return result;
  }
  const report = (stage: RunProgress["stage"]) =>
    writeProgress(supabase, runId, snapshotProgress(stage, result, budget.maxSearchQueries));

  let rejected: RejectedCandidate[] = [];
  const currentPatch: CurrentPatchContext = patchMetadata;

  try {
    if (mode !== "dry_run") {
      try {
        await runLifecyclePass(supabase, result, budget, currentPatch, now);
      } catch (error) {
        result.status = result.status === "success" ? "partial" : result.status;
        result.errors.push(toErrorMessage(error, "lifecycle pass failed"));
      }
    }

    const scanMemory = await loadScanMemory(supabase, currentPatch, now);
    result.intent = chooseScanIntent(scanMemory, searchRotationOffset(now));
    result.targetClusterTitles = scanMemory.targetClusterTitles;
    // Corroborate advances its title per TURN (offset / laneCount); computing the
    // lane count here — where scanMemory is in scope — keeps that rotation from
    // being aliased by the intent-lane offset (see buildMemorySearchQueries).
    const laneCount = eligibleLaneCount(scanMemory);
    await updateRunIntent(supabase, runId, result.intent);

    if (mode !== "dry_run") {
      await quarantineStalePublicSignals(supabase, result, now, currentPatch);
    }

    const clusterRouting = await loadClusterRoutingState(supabase);
    const clusterOptions = clusterRouting.semanticOptions;
    // Intake only. Re-canonicalizing an exact-URL scope widens what it matches,
    // which is right for "have I been taught about this page" and wrong for
    // re-evaluating stored evidence — refreshClusterStats keeps comparing scope
    // values exactly as recorded so a lesson can never move an evidence count.
    const feedbackRules = canonicalizeRuleScopes(await loadActiveScannerFeedbackRules(supabase));

    await report("searching");
    const steamCollection =
      mode === "dry_run" ? null : await collectSteamReviewInputs(supabase, result, now);
    const webInputs = await collectInputs(
      result,
      budget,
      now,
      currentPatch,
      result.intent,
      laneCount,
      () => report("searching"),
    );
    const inputs = [...(steamCollection?.inputs ?? []), ...webInputs];
    const storedSourceDates = await loadStoredSourceDates(supabase, currentPatch.version);
    const prepared = await prepareSignals(
      inputs,
      result,
      budget,
      currentPatch,
      clusterOptions,
      feedbackRules,
      storedSourceDates,
      now,
      () => report("screening"),
    );
    rejected = prepared.rejected;

    if (mode !== "dry_run") {
      await report("persisting");
      const signalPersistence = await persistSignals(
        supabase,
        prepared.prepared,
        result,
        now,
        clusterRouting.semanticRoutingClusters,
        runId,
      );
      if (signalPersistence.error !== null) {
        // A later write can fail after an earlier signal was committed. Mark the
        // ledger partial so admin/public find queries include the landed writes.
        result.status = result.signalsInserted > 0 || result.signalsReobserved > 0 ? "partial" : "failed";
        result.errors.push(toErrorMessage(signalPersistence.error, "automation persistence failed"));
      }
      // Observation lane persists after signals and never affects them: it is
      // best-effort by design and reports failures into the ledger only.
      await persistObservations(
        supabase,
        prepared.observations,
        currentPatch.version,
        result,
        currentPatch.publishedAt,
        storedSourceDates.byUrlHash,
      );
      if (steamCollection) {
        await persistSteamReviewCollection(
          supabase,
          steamCollection,
          prepared.prepared,
          prepared.rejected,
          signalPersistence.persistedSteamReviewHashes,
          result,
          now,
        );
      }
      await persistPlatformContextSnapshot(supabase, result, now);
      await persistSteamPlayerSnapshot(supabase, result, now);
    }

    if (result.errors.length > 0 && result.status === "success") result.status = "partial";
  } catch (error) {
    result.status = "failed";
    result.errors.push(toErrorMessage(error, "automation run crashed"));
  }

  if (mode !== "dry_run") {
    await persistRejectedCandidates(supabase, runId, rejected, result, now);
    await deleteExpiredRejectedCandidates(supabase, now, result);
  }

  await finalizeRunLedgerSafely(supabase, runId, result);
  return result;
}

export type StartedScan =
  | { status: "started"; runId: string; completion: Promise<AutomationResult> }
  | { status: "already_running"; runId: null };

export async function startAutomationScan(input: { mode: AutomationMode; now?: Date; scannerPolicy?: ScannerPolicy }): Promise<StartedScan> {
  const now = input.now ?? new Date();
  const supabase = createServiceClient();
  await sweepStaleRuns(supabase, now);
  if (await hasActiveRun(supabase, now)) return { status: "already_running", runId: null };

  const monthlyBudgetUsd = input.scannerPolicy?.monthlyLlmUsdCap ?? automationBudgetUsd();
  let patchMetadata = await getCurrentPatchMetadata(supabase);
  let patchSyncError: string | null = null;
  let budgetReadError: string | null = null;
  let spentMonthToDateUsd = 0;
  let tavilyCreditsMonthToDate = 0;
  let llmSpentMonthToDateUsd = 0;
  let openRouterCircuitOpen = false;
  try {
    const monthSpend = await loadMonthSpend(supabase, now);
    spentMonthToDateUsd = monthSpend.estimatedCostUsd;
    tavilyCreditsMonthToDate = monthSpend.tavilyCredits;
    llmSpentMonthToDateUsd = monthSpend.llmCostUsd;
    openRouterCircuitOpen = monthSpend.openRouterCircuitOpen;
  } catch (error) {
    budgetReadError = toErrorMessage(error, "automation spend read failed");
    openRouterCircuitOpen = true;
    spentMonthToDateUsd = monthlyBudgetUsd;
    llmSpentMonthToDateUsd = monthlyBudgetUsd;
  }
  if (!budgetReadError && input.mode !== "dry_run") {
    try {
      patchMetadata = (await syncOfficialPatchNote(supabase, { now })).patch;
    } catch (error) {
      patchSyncError = toErrorMessage(error, "official patch sync failed");
    }
  }
  const patchBurstActive = input.mode === "scheduled" && resolveBurstState(patchMetadata, now);
  const computedBudget = computeAutomationBudget({
    monthlyBudgetUsd,
    spentMonthToDateUsd,
    tavilyCreditsMonthToDate,
    llmSpentMonthToDateUsd,
    mode: input.mode,
    patchBurstActive,
    now,
    scannerPolicy: input.scannerPolicy,
  });
  const budget = openRouterCircuitOpen ? { ...computedBudget, maxLlmCalls: 0 } : computedBudget;

  const runId = await createRunLedger(supabase, input.mode, budget, now, patchBurstActive);
  const completion = executeAutomationRun(
    supabase,
    runId,
    input.mode,
    budget,
    budgetReadError,
    openRouterCircuitOpen,
    patchMetadata,
    patchSyncError,
    patchBurstActive,
    now,
  );
  return { status: "started", runId, completion };
}

/** Awaits the whole scan inline — used by the cron and tests. */
export async function runAutomationMonitor(input: { mode: AutomationMode; now?: Date; scannerPolicy?: ScannerPolicy }): Promise<AutomationResult> {
  const started = await startAutomationScan(input);
  if (started.status === "already_running") {
    return {
      status: "skipped",
      searchQueriesUsed: 0,
      searchResultsSeen: 0,
      llmCallsUsed: 0,
      candidatesSeen: 0,
      prefilterRejected: 0,
      signalsPrepared: 0,
      signalsInserted: 0,
      signalsDeduped: 0,
      clustersPromoted: 0,
      intent: "broad_discovery",
      targetClusterTitles: [],
      signalsReobserved: 0,
      staleSignalsHidden: 0,
      candidatesRescued: 0,
      observationsKept: 0,
      operatorRulesMatched: 0,
      estimatedCostUsd: 0,
      llmCostUsd: 0,
      skips: ["scan_already_running"],
      errors: [],
    };
  }
  return started.completion;
}

/** Zero-cost ledger trace: proves the cron fired and explains why it didn't scan. Best-effort. */
export async function insertSkippedScheduledRun(
  supabase: ReturnType<typeof createServiceClient>,
  reason: "paused" | "recent_run" | "scan_already_running" | "budget_zero" | "budget_capped" | "tavily_credit_cap" | "llm_budget_capped",
  now: Date,
): Promise<void> {
  try {
    await supabase.from("automation_runs").insert({
      started_at: now.toISOString(),
      finished_at: now.toISOString(),
      status: "skipped",
      mode: "scheduled",
      estimated_cost_usd: 0,
      reddit_posts_seen: 0,
      search_queries_used: 0,
      search_results_seen: 0,
      llm_calls_used: 0,
      signals_inserted: 0,
      signals_deduped: 0,
      clusters_promoted: 0,
      signals_reobserved: 0,
      stale_signals_hidden: 0,
      candidates_rescued: 0,
      skips: [reason],
      errors: [],
      funnel: {
        searchResultsSeen: 0,
        candidatesSeen: 0,
        deduped: 0,
        prefilterRejected: 0,
        llmEligible: 0,
        llmCalls: 0,
        prepared: 0,
        persisted: 0,
        kept: 0,
        promoted: 0,
      },
    });
  } catch {
    // best-effort by design
  }
}

export async function rescueCandidateSignal(
  supabase: ReturnType<typeof createServiceClient>,
  candidate: { title: string; url: string; sourceDomain: string | null; sourcePublishedAt?: string | null; snippet: string },
): Promise<void> {
  const now = new Date();
  const canonicalUrl = canonicalizeUrl(candidate.url);
  const source: SourceInput = {
    source: "web_search",
    id: canonicalUrl,
    title: candidate.title,
    body: candidate.snippet,
    url: canonicalUrl,
    observedAt: now.toISOString(),
    sourceDomain: candidate.sourceDomain,
    sourcePublishedAt: candidate.sourcePublishedAt ?? null,
  };

  const clusterRouting = await loadClusterRoutingState(supabase);
  const clusterOptions = clusterRouting.semanticOptions;

  const monthlyBudgetUsd = automationBudgetUsd();
  let budgetReadError: string | null = null;
  let spentMonthToDateUsd = 0;
  let tavilyCreditsMonthToDate = 0;
  let llmSpentMonthToDateUsd = 0;
  let openRouterCircuitOpen = false;
  try {
    const monthSpend = await loadMonthSpend(supabase, now);
    spentMonthToDateUsd = monthSpend.estimatedCostUsd;
    tavilyCreditsMonthToDate = monthSpend.tavilyCredits;
    llmSpentMonthToDateUsd = monthSpend.llmCostUsd;
    openRouterCircuitOpen = monthSpend.openRouterCircuitOpen;
  } catch (error) {
    budgetReadError = toErrorMessage(error, "automation spend read failed");
    openRouterCircuitOpen = true;
    spentMonthToDateUsd = monthlyBudgetUsd;
    llmSpentMonthToDateUsd = monthlyBudgetUsd;
  }
  const computedBudget = computeAutomationBudget({
    monthlyBudgetUsd,
    spentMonthToDateUsd,
    tavilyCreditsMonthToDate,
    llmSpentMonthToDateUsd,
    mode: "manual",
    now,
  });
  const budget: AutomationBudget = {
    ...computedBudget,
    allowPaidSearch: false,
    maxSearchQueries: 0,
    maxSearchResults: 0,
    maxLlmCalls: openRouterCircuitOpen ? 0 : Math.min(MAX_RESCUE_LLM_CALLS, computedBudget.maxLlmCalls),
  };
  const runId = await createRunLedger(supabase, "manual", budget, now);
  const result: AutomationResult = {
    status: "success",
    searchQueriesUsed: 0,
    searchResultsSeen: 0,
    llmCallsUsed: 0,
    candidatesSeen: 1,
    prefilterRejected: 0,
    signalsPrepared: 0,
    signalsInserted: 0,
    signalsDeduped: 0,
    clustersPromoted: 0,
    intent: "rescue_candidate",
    targetClusterTitles: clusterRouting.keywordClusters.map((cluster) => cluster.title),
    signalsReobserved: 0,
    staleSignalsHidden: 0,
    candidatesRescued: 0,
    observationsKept: 0,
    operatorRulesMatched: 0,
    estimatedCostUsd: 0,
    llmCostUsd: 0,
    skips: [...budget.skipReasons, ...(openRouterCircuitOpen ? ["openrouter_circuit_open"] : [])],
    errors: [],
  };
  if (budgetReadError) result.errors.push(budgetReadError);

  // Rescue deliberately skips preScreenCandidate and shouldKeepExtractedSignal —
  // an admin rescuing a candidate has already judged it relevant, so re-running
  // the automated relevance gates here would defeat the point of a rescue.
  try {
    const extraction = await extractSignalWithOpenRouter(
      { title: source.title, snippet: source.body, url: canonicalUrl },
      {
        llmCallsRemaining: budget.maxLlmCalls,
        llmBudgetRemainingUsd: budget.remainingLlmUsd,
        clusterOptions,
      },
    );
    result.llmCallsUsed = extraction.llmCallsUsed;
    result.llmCostUsd = extraction.llmCostUsd;
    result.estimatedCostUsd = extraction.llmCostUsd;
    if (extraction.fallbackReason && !result.skips.includes(extraction.fallbackReason)) {
      result.skips.push(extraction.fallbackReason);
    }
    recordOpenRouterRunSkip(result, extraction.fallbackReason);

    const externalHash = externalIdHash(source.source, source.id);
    const prepared: PreparedSignal = {
      ...source,
      canonicalUrl,
      externalHash,
      semantic: semanticFingerprint(extraction.issueTitle, extraction.category),
      extraction,
    };
    result.signalsPrepared = 1;

    const reports = await loadApprovedReports(supabase);
    const clusterBySemantic = new Map<string, string>();
    const persistence = await persistOneSignal(
      supabase,
      prepared,
      reports,
      clusterBySemantic,
      clusterRouting.semanticRoutingClusters,
      now,
      runId,
    );
    if (persistence.reobserved) result.signalsReobserved = 1;
    else result.signalsInserted = 1;
    if (persistence.promoted) result.clustersPromoted = 1;
    // Provider context stored without a cluster is a success with a caveat the
    // operator should be able to read off the ledger, not infer from a zero.
    if (persistence.clusterId === null) result.skips.push("provider_context_no_cluster");
    result.candidatesRescued = 1;
    if (result.errors.length > 0) result.status = "partial";
  } catch (error) {
    result.status = "failed";
    result.errors.push(toErrorMessage(error, "candidate rescue failed"));
    throw error;
  } finally {
    await finalizeRunLedgerSafely(supabase, runId, result);
  }
}
