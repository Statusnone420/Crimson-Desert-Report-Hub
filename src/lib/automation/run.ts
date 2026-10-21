import "server-only";
import { admitScannerRun, guardedFinalization, type GuardedRun } from "./accounting.server";
import { currentScannerExecution, scannerSourceFetch, withScannerExecution, withScannerEssential, withScannerRun } from "./executionContext.server";
import { ScannerAccountingError } from "./paidOperation";
import type { ScannerCheckpointFailure } from "./checkpointWrite";
import { reuseClaimMapping } from "./mappingCache.server";
import { hasCurrentPatchCheckins } from "@/lib/checkins.server";
import { aiRuntimeForBudget, applyAiRuntimeOptions, attachAiRuntime, loadAiRuntime, managedScannerPolicy, type AiRuntime } from "@/lib/aiSettings/runtime.server";

import {
  computeAutomationBudget,
  evaluateOpenRouterKeyBudget,
  readOpenRouterKeyBudget,
  SEARCH_QUERY_COST_USD,
  type ScannerModelPreset,
  type AutomationBudget,
} from "@/lib/automation/budget";
import { applyAutomationBudgetCeiling, loadMonthSpend } from "@/lib/automation/budgetState.server";
import {
  mapClaimToClusterWithOpenRouter,
  type ClaimMappingCluster,
  type ClaimMappingDecision,
  type ClaimMappingOptions,
} from "@/lib/automation/claimMapping";
import { canonicalizeUrl, hashValue, semanticFingerprint } from "@/lib/automation/dedupe";
import { countIndependentDomains, domainTier, isOfficialDomain, isProviderContextSource, isReconExtractDomain } from "@/lib/automation/domains";
import {
  evaluateCurrentPatchEligibility,
  extractSourcePatchVersions,
  storedSourceActiveAt,
  storedSourceFreshnessInput,
  type CurrentPatchContext,
  type CurrentPatchEligibilityReason,
} from "@/lib/automation/eligibility";
import { extractSignalWithOpenRouter, type ClusterOption, type ExtractionResult } from "@/lib/automation/extract";
import { isMostlyNonEnglish } from "@/lib/language";
import {
  canonicalizeRuleScopes,
  matchScannerFeedbackRule,
  storedRecordUrl,
  type ScannerFeedbackRule,
} from "@/lib/automation/feedback";
import { readActiveFeedbackRulePages } from "@/lib/automation/feedbackRules.server";
import { buildMemorySearchQueries, chooseScanIntent, eligibleLaneCount, type ScanIntent, type ScanMemory } from "@/lib/automation/memory";
import { countDistinctPlayerThreads, resolveSignalPublicStatus, shouldPromoteSignalCluster } from "@/lib/automation/promote";
import {
  hasCrimsonDesertContext,
  hasUnsupportedSourceContext,
  preScreenCandidate,
  shouldKeepExtractedSignal,
  type ObservationKind,
  type RelevanceSkipReason,
  type SignalRelevanceDecision,
} from "@/lib/automation/relevance";
import { categoriesCompatible, routeToWatchlistCluster, type RoutableCluster } from "@/lib/automation/route";
import { compareClusterRecency, createClusterRetriever, nearDuplicateAutoCluster } from "@/lib/automation/clusterRetrieval";
import {
  buildWireNewsQuery,
  tavilyExtract,
  TavilyExtractNoContentError,
  tavilySearch,
  WIRE_NEWS_TURN_INTERVAL,
  type SearchResult,
} from "@/lib/automation/search";
import { resolveBurstState } from "@/lib/automation/schedule";
import { getAutomationControlState, type AutomationSettingsClient, type ScannerPolicy } from "@/lib/automation/settings";
import { CATEGORIES, type Category, type Platform } from "@/lib/constants";
import { externalIdHash, forumAuthorKey } from "@/lib/crypto";
import { belongsToPatchFamily, isCurrentPatchVerified } from "@/lib/patchWatch";
import {
  features,
  steamForumEnabled,
  steamPulseEnabled,
} from "@/lib/env";
import { computeClusterLifecycle, type LifecycleClaimDecision } from "@/lib/lifecycle";
import {
  readClaimedFixesForCurrentPatch,
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
  fetchSteamReviewBatch,
  filterNewOrUpdatedSteamReviews,
  STEAM_REVIEW_SOURCE_URL,
  type SteamReviewBatch,
  type SteamReviewCandidate,
} from "@/lib/automation/steam";
import { fetchSteamForumTopics, fetchSteamThreadLatestReply, steamForumTopicId } from "@/lib/automation/steamForum";
import { createServiceClient } from "@/lib/supabase";
import { persistRunProgress, progressCheckpointEvidence } from "@/lib/automation/runProgress.server";
import { appendOpenRouterDiagnostics, type OpenRouterDiagnostic } from "@/lib/automation/openRouterDiagnostics";
import { hasPendingOpenRouterInference, parseOpenRouterTraceJournal, recordOpenRouterCheckpointFailure, upsertOpenRouterAttempt, type OpenRouterAttempt, type OpenRouterAttemptReporter, type OpenRouterTraceJournal } from "@/lib/automation/openRouterTrace";
import { recordClaimReviewProposals, type ClaimReviewLifecycleDecision, type ClaimReviewProposal } from "@/lib/claimReview";
import { isMissingSupabaseColumn, isMissingSupabaseRelation } from "@/lib/supabaseCompatibility";
import { captureContextSnapshots } from "@/lib/automation/contextSnapshots.server";
import { isJunkClusterTitle } from "@/lib/automation/junkTitle";
import {
  describeScannerDiagnostic,
  scannerDiagnostic,
  ScannerOperationError,
  type ScannerDiagnostic,
  type ScannerStage,
} from "@/lib/automation/diagnostics";

export type AutomationMode = "scheduled" | "manual" | "dry_run";

export type AutomationResult = {
  persistence?: "recorded" | "unconfirmed";
  accountingState?: "recorded" | "unresolved" | "anomalous";
  llmCostState?: "verified" | "reserved_unknown" | "not_attempted" | "unknown";
  progressWriteFailures?: ScannerCheckpointFailure[];
  openRouterTrace?: OpenRouterTraceJournal;
  openRouterDiagnostics?: OpenRouterDiagnostic[];
  diagnostics?: ScannerDiagnostic[];
  status: "success" | "partial" | "failed" | "skipped";
  searchQueriesUsed: number;
  searchResultsSeen: number;
  llmCallsUsed: number;
  llmSucceeded?: number;
  modelPreset?: ScannerModelPreset;
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
  llmCostState?: AutomationResult["llmCostState"];
  progressWriteFailures?: ScannerCheckpointFailure[];
  aiCompletionUnverified?: boolean;
  openRouterTrace?: OpenRouterTraceJournal;
  openRouterDiagnostics?: OpenRouterDiagnostic[];
  diagnostics?: ScannerDiagnostic[];
  llmSucceeded?: number;
  llmCostUsd?: number;
  modelPreset?: ScannerModelPreset | null;
  stage: "starting" | "searching" | "screening" | "persisting" | "done";
  searchesDone: number;
  searchTotal: number;
  candidatesSeen: number;
  prefilterRejected: number;
  llmCallsUsed: number;
  kept: number;
  promoted: number;
};

/** True when no further AI call may be made this run, whatever allowance it would use. */
function llmStopped(result: Pick<AutomationResult, "skips" | "llmCostUsd">, budget: AutomationBudget): boolean {
  if (aiRuntimeForBudget(budget)?.failed) return true;
  if (
    [
      "openrouter_unexpected_charge",
      "openrouter_cost_unverified",
      "openrouter_budget_exceeded",
      // Every later call would be refused the same way, so stop asking.
      "openrouter_no_route",
      "openrouter_context_limit",
    ].some((reason) => result.skips.includes(reason))
  ) {
    return true;
  }
  return result.llmCostUsd >= budget.remainingLlmUsd;
}

/**
 * The extra non-English calls ride on the run's paid AI lane: they are never
 * granted when that lane was switched off (`maxLlmCalls` 0 after an accounting
 * outage, a circuit pause or a spent budget), only when its calls ran out.
 */
export function paidAiEnabled(
  result: Pick<AutomationResult, "skips" | "llmCostUsd">,
  budget: AutomationBudget,
): boolean {
  return budget.maxLlmCalls > 0 && !llmStopped(result, budget);
}

/** Calls this run spent from the separate non-English allowance, one note each. */
function extraLanguageCallsUsed(result: AutomationResult): number {
  return result.skips.filter((skip) => skip === "language_extra_call").length;
}

/**
 * The lanes' shared calls left this run. Calls from the non-English allowance
 * do not use up shared calls; their cost still counts toward the monthly cap
 * through `llmCostUsd`.
 */
function remainingLlmCalls(result: AutomationResult, budget: AutomationBudget): number {
  if (llmStopped(result, budget)) return 0;
  return Math.max(0, budget.maxLlmCalls - (result.llmCallsUsed - extraLanguageCallsUsed(result)));
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
      reason === "openrouter_no_route" ||
      reason === "openrouter_context_limit" ||
      reason === "openrouter_provider_failure" ||
      reason === "openrouter_invalid_json" ||
      reason === "llm_budget_capped" ||
      reason === "llm_time_limit") &&
    !result.skips.includes(reason)
  ) {
    result.skips.push(reason);
  }
}

async function enforceProviderBudget(budget: AutomationBudget, onAttempt?: OpenRouterAttemptReporter): Promise<AutomationBudget> {
  if (budget.maxLlmCalls <= 0) return budget;
  const llmDeadlineAtMs = budget.llmDeadlineAtMs ?? Date.now() + 180_000;
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    return {
      ...budget,
      llmDeadlineAtMs,
      remainingLlmUsd: 0,
      maxLlmCalls: 0,
      skipReasons: budget.skipReasons.includes("openrouter_missing_config")
        ? budget.skipReasons
        : [...budget.skipReasons, "openrouter_missing_config"],
    };
  }
  const openRouterDiagnostics: OpenRouterDiagnostic[] = [];
  const keyBudget = await readOpenRouterKeyBudget(apiKey, undefined, (diagnostic) => {
    openRouterDiagnostics.push(diagnostic);
    if (diagnostic.code !== "key_budget_response_parsed") budget.openRouterDiagnostics = appendOpenRouterDiagnostics(undefined, openRouterDiagnostics);
  }, onAttempt, llmDeadlineAtMs);
  const checked = evaluateOpenRouterKeyBudget(keyBudget, budget);
  return {
    ...budget,
    llmDeadlineAtMs,
    ...(checked.skipReason && openRouterDiagnostics.length
      ? { openRouterDiagnostics: appendOpenRouterDiagnostics(undefined, openRouterDiagnostics) }
      : {}),
    remainingLlmUsd: checked.remainingLlmUsd,
    maxLlmCalls: checked.skipReason ? 0 : budget.maxLlmCalls,
    skipReasons: checked.skipReason ? [...budget.skipReasons, checked.skipReason] : budget.skipReasons,
  };
}

function recordOpenRouterDiagnostic(result: AutomationResult, diagnostic: OpenRouterDiagnostic): void {
  result.openRouterDiagnostics = appendOpenRouterDiagnostics(result.openRouterDiagnostics, [diagnostic]);
}

function appendScannerDiagnostic(result: AutomationResult, diagnostic: ScannerDiagnostic): void {
  if (!result.diagnostics?.some((item) => item.stage === diagnostic.stage && item.code === diagnostic.code)) {
    result.diagnostics = [...(result.diagnostics ?? []), diagnostic];
  }
  const detail = describeScannerDiagnostic(diagnostic);
  if (!result.errors.includes(detail)) result.errors.push(detail);
}

function recordScannerDiagnostic(result: AutomationResult, stage: ScannerStage, error: unknown): void {
  appendScannerDiagnostic(result, scannerDiagnostic(stage, error));
  if (result.status === "success") result.status = "partial";
}

function stopPaidAccounting(result: AutomationResult, budget: AutomationBudget, error: ScannerAccountingError): void {
  recordScannerDiagnostic(result, "paid_accounting", error);
  if (!result.skips.includes(error.code)) result.skips.push(error.code);
  budget.maxLlmCalls = 0;
  budget.allowPaidSearch = false;
}

/**
 * An unknown or anomalous cost stops the guard, and it then refuses every paid call.
 * A failed recon extract or a final search can stop it without throwing an accounting
 * error, so the run stops its paid work here, before the next AI call: that call takes
 * the free path instead of throwing `spending_blocked` and failing the run.
 */
function stopPaidWorkIfGuardStopped(result: AutomationResult, budget: AutomationBudget): void {
  const reason = budget.paidGuard?.blockedReason;
  if (reason && (budget.maxLlmCalls > 0 || budget.allowPaidSearch)) stopPaidAccounting(result, budget, new ScannerAccountingError(reason));
}

function snapshotProgress(stage: RunProgress["stage"], result: AutomationResult, searchTotal: number): RunProgress {
  return {
    ...(result.openRouterTrace ? { openRouterTrace: parseOpenRouterTraceJournal(result.openRouterTrace) ?? undefined,
      aiCompletionUnverified: hasPendingOpenRouterInference(result.openRouterTrace) } : {}),
    ...(result.openRouterDiagnostics?.length
      ? { openRouterDiagnostics: appendOpenRouterDiagnostics(undefined, result.openRouterDiagnostics) }
      : {}),
    ...(result.diagnostics?.length ? { diagnostics: [...result.diagnostics] } : {}),
    ...(result.progressWriteFailures?.length ? { progressWriteFailures: structuredClone(result.progressWriteFailures) } : {}),
    ...(result.llmCostState ? { llmCostState: result.llmCostState } : {}),
    stage,
    llmSucceeded: result.llmSucceeded ?? 0,
    llmCostUsd: result.llmCostUsd,
    modelPreset: result.modelPreset ?? null,
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

const PROGRESS_INTERVAL_MS = 10_000;

const STALE_RUN_MINUTES = 15;

/** Finalize crashed runs: a killed serverless function can never finalize its own row. */
export async function sweepStaleRuns(
  supabase: ReturnType<typeof createServiceClient>,
  now: Date,
): Promise<void> {
  try {
    const { error } = await supabase
      .from("automation_runs")
      .update({
        status: "failed",
        finished_at: now.toISOString(),
        errors: ["stale_running_run"],
      })
      .eq("status", "running")
      .lt("started_at", new Date(now.getTime() - STALE_RUN_MINUTES * 60 * 1000).toISOString());
    if (error) throw error;
  } catch (error) {
    throw new ScannerOperationError("stale_run_cleanup", error);
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
  try {
    const { data, error } = await supabase
      .from("automation_runs")
      .select("id")
      .eq("status", "running")
      .gte("started_at", new Date(now.getTime() - STALE_RUN_MINUTES * 60 * 1000).toISOString())
      .limit(1);
    if (error) throw error;
    return ((data ?? []) as { id: string }[]).length > 0;
  } catch (error) {
    throw new ScannerOperationError("active_run_read", error);
  }
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
  /** Latest activity the source shows (a forum thread's last reply), never a publication date. */
  sourceActiveAt?: string | null;
  steam?: Omit<SteamReviewCandidate, "reviewText">;
  /**
   * Present on threads read directly from the Steam Community forum, including
   * one merged into a search result for the same page (`viaSearch`). Carries the
   * opening-date status, the forum text fingerprint, the fingerprint of the
   * title and body this candidate sends to extraction, any processing proof
   * already stored for the thread on the current patch, and the keyed hash of
   * the opening post's author (never the name).
   */
  forum?: {
    forumTextHash: string;
    inputHash: string;
    postedAtStatus: "ok" | "missing" | "malformed";
    patchVersion: string;
    viaSearch?: boolean;
    proof: ForumProcessingProof | null;
    authorKey?: string | null;
  };
};

type PreparedSignal = SourceInput & {
  canonicalUrl: string;
  externalHash: string;
  semantic: string;
  extraction: ExtractionResult;
  /** The English title stored in place of a title in another language (see englishStorage). */
  storedTitle?: string;
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
  extracted_facts?: { platform?: Platform | null; sourcePatchVersions?: unknown; authorKey?: unknown } | null;
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
  patch_version: string | null;
};

type ApprovedExcerptRow = {
  id: string;
  report_id: string;
};

const SEARCH_ROTATION_WINDOW_MS = 60 * 60 * 1000;
const MAX_RESERVED_EXTRACTION_LLM_CALLS = 2;
const MAX_RESCUE_LLM_CALLS = 1;
// Hard cap on full-page recon fetches per run. Each fetch is one Tavily extract
// credit, so this bounds the extra cost of the "read the real thread before
// rejecting" lane regardless of how many borderline candidates a run surfaces.
const MAX_RECON_FETCHES_PER_RUN = 2;
/**
 * More than half of the game's Steam reviews are not in English. A post in
 * another language is stored only with the AI's English title and summary, so
 * nothing the owner cannot read reaches the console. Each scan has this many
 * extra AI calls for such posts, on top of the lanes' shared calls: they serve
 * a non-English post the shared calls did not reach, and admit up to this many
 * posts the word lists could not read at all (`languageReview`). At about
 * $0.0004 a call on the current model that is under $0.50 a month, and the
 * monthly AI cap still bounds every call.
 */
export const MAX_LANGUAGE_CALLS_PER_RUN = 3;

const VERSION_IN_TITLE = /\b\d+\.\d{1,2}(?:\.\d{1,2})?\b/g;

/**
 * The owner reads English only, so nothing in another language is stored or
 * shown. A post in another language is stored only when the AI read it and
 * answered in English, under the AI's title with version numbers removed: a
 * stored title is read back as source evidence for patch freshness, and this
 * title is the AI's wording, not the source's.
 */
export function englishStorage(
  signal: Pick<SourceInput, "title">,
  body: string,
  extraction: Pick<ExtractionResult, "extractionProvider" | "issueTitle" | "summary">,
): { nonEnglish: boolean; store: boolean; storedTitle?: string } {
  const nonEnglish = isMostlyNonEnglish(signal.title) || isMostlyNonEnglish(body);
  if (!nonEnglish) return { nonEnglish, store: true };
  if (
    extraction.extractionProvider !== "openrouter" ||
    isMostlyNonEnglish(extraction.issueTitle) ||
    isMostlyNonEnglish(extraction.summary)
  ) {
    return { nonEnglish, store: false };
  }
  const storedTitle = extraction.issueTitle.replace(VERSION_IN_TITLE, " ").replace(/\s+/g, " ").trim();
  return { nonEnglish, store: true, storedTitle: storedTitle || "Player report" };
}

/**
 * Whether a pre-screen rejection may become an AI language review. A thumbs-up
 * Steam review in another language is almost always praise, so the scarce
 * slots go to thumbs-down reviews and forum, Reddit or web posts.
 */
export function admitsLanguageReview(
  signal: Pick<SourceInput, "source" | "steam">,
  decision: SignalRelevanceDecision,
): boolean {
  return !decision.keep
    && decision.languageReview === true
    && (signal.source !== "steam_review" || signal.steam?.votedUp === false);
}

/** Free Steam page reads for stale-looking threads; each check reads at most two pages. */
const MAX_STEAM_THREAD_REPLY_CHECKS_PER_RUN = 5;

/**
 * A search result carries a Steam thread's opening date but never its latest
 * reply, so a thread players are still answering after the patch looked stale
 * and was dropped unread. Before screening, read a few such threads once for
 * their latest reply. The date gate then treats a reply after the patch the way
 * it treats the forum reader's: the thread can be stored as a private lead
 * (`active_after_patch`), never published on that alone. This runs before call
 * planning, so reservations and the loop judge the same dates.
 */
export async function withSteamThreadReplies(
  candidates: SourceInput[],
  {
    looksStale,
    readLatestReply,
    maxChecks = MAX_STEAM_THREAD_REPLY_CHECKS_PER_RUN,
    onCheck,
  }: {
    looksStale: (signal: SourceInput, canonicalUrl: string) => boolean;
    readLatestReply: (canonicalUrl: string) => Promise<string | null>;
    maxChecks?: number;
    onCheck?: (found: boolean) => void;
  },
): Promise<SourceInput[]> {
  // Keyed by topic id: a thread's base URL and its `?ctp=N` comment pages are
  // one thread, read once, and every copy gets the reply that read found.
  const latestByTopic = new Map<string, string | null>();
  const out: SourceInput[] = [];
  for (const signal of candidates) {
    let canonicalUrl: string | null = null;
    try {
      canonicalUrl = canonicalizeUrl(signal.url);
    } catch {
      // The main loop reports an invalid URL.
    }
    const topic = canonicalUrl ? steamForumTopicId(canonicalUrl) : null;
    if (!canonicalUrl || !topic || signal.source !== "web_search" || signal.sourceActiveAt || !looksStale(signal, canonicalUrl)) {
      out.push(signal);
      continue;
    }
    if (!latestByTopic.has(topic)) {
      if (latestByTopic.size >= maxChecks) {
        out.push(signal);
        continue;
      }
      const read = await readLatestReply(canonicalUrl).catch(() => null);
      latestByTopic.set(topic, read);
      onCheck?.(read !== null);
    }
    const latest = latestByTopic.get(topic) ?? null;
    out.push(latest ? { ...signal, sourceActiveAt: latest } : signal);
  }
  return out;
}

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

const PROMOTION_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

function domainCounts(rows: SourceSignalRow[], now: Date): { independentDomainCount: number; trustedDomainCount: number } {
  const hostnames = rows
    .filter((row) => isObservedWithinWindow(row, now, PROMOTION_WINDOW_MS))
    .map(signalDomain)
    .filter((domain): domain is string => Boolean(domain));
  return countIndependentDomains(hostnames);
}

/** A forum thread's comment pages are one thread; any other page is its own. */
function playerThreadKey(row: SourceSignalRow): string | null {
  const url = row.canonical_url ?? row.source_url ?? null;
  if (!url) return null;
  const topic = steamForumTopicId(url);
  return topic ? `steam-forum:${topic}` : url;
}

function storedAuthorKey(facts: unknown): string | null {
  const key = facts && typeof facts === "object" ? (facts as Record<string, unknown>).authorKey : null;
  return typeof key === "string" && /^[0-9a-f]{64}$/.test(key) ? key : null;
}

function distinctPlayerThreadCount(rows: SourceSignalRow[], now: Date): number {
  return countDistinctPlayerThreads(
    rows
      .filter((row) => isObservedWithinWindow(row, now, PROMOTION_WINDOW_MS))
      .map((row) => ({ threadKey: playerThreadKey(row), authorKey: storedAuthorKey(row.extracted_facts) })),
  );
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
    { title: signal.title, snippet: signal.body, sourcePublishedAt: assertedSourceDate, sourceActiveAt: signal.sourceActiveAt ?? null },
    currentPatch,
  ).canStore;
}

function sourceSignalEligibility(
  row: SourceSignalRow,
  currentPatch: CurrentPatchContext,
) {
  return evaluateCurrentPatchEligibility(
    storedSourceFreshnessInput(row),
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

/**
 * Publication dates retained source signals and this patch's observation shelf
 * already hold, keyed two ways for two different jobs:
 *
 *   - byCanonicalUrl feeds the source-date resolver's last precedence step, so
 *     a page we already have a verified date for keeps it when an undated
 *     sighting arrives. Exact URL only — a date describes one page.
 *   - byUrlHash is the row identity the persistence RPC uses. Its value carries
 *     the URL too because a community-ask campaign hash can span several pages,
 *     while a publication date belongs to exactly one of them.
 *
 * Only the narrowly identified rolling-deploy case where patch_observations is
 * absent skips that shelf. Permissions, timeouts and all other failures
 * stop the run before persistence can replace a date without knowing who owns
 * the stored one.
 */
type StoredObservationDates = {
  byCanonicalUrl: ReadonlyMap<string, string | null>;
  byUrlHash: ReadonlyMap<string, StoredObservationDate>;
};

async function loadStoredSourceDates(
  supabase: ReturnType<typeof createServiceClient>,
  patchVersion: string,
  inputs: SourceInput[],
): Promise<StoredObservationDates> {
  const byCanonicalUrl = new Map<string, string | null>();
  const byUrlHash = new Map<string, StoredObservationDate>();
  // Steam reviews share a store URL; their dates cannot identify another review.
  const urls = [...new Set(inputs.filter((input) => input.source !== "steam_review")
    .flatMap((input) => {
      try {
        return [canonicalizeUrl(input.url)];
      } catch {
        return [];
      }
    }))];
  for (let offset = 0; offset < urls.length; offset += 50) {
    const { data, error } = await supabase.from("source_signals")
      .select("canonical_url, source_published_at")
      .neq("source", "steam_review")
      .in("canonical_url", urls.slice(offset, offset + 50));
    if (error) throw new Error(`stored signal dates read failed: ${error.message}`);
    for (const row of data ?? []) {
      if (row.canonical_url && row.source_published_at) {
        byCanonicalUrl.set(row.canonical_url, row.source_published_at);
      }
    }
  }
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
      return { byCanonicalUrl, byUrlHash };
    }
    throw new Error(`stored observation dates read failed: ${response.error.message}`);
  }
  for (const row of (response.data ?? []) as {
    url?: string | null;
    url_hash?: string | null;
    source_published_at?: string | null;
  }[]) {
    if (row.url && row.source_published_at) byCanonicalUrl.set(row.url, row.source_published_at);
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
      .select("id, cluster_id, source, source_url, canonical_url, source_domain, title, summary, source_published_at, public_status, extracted_facts")
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

function searchRotationOffset(now: Date): number {
  return Math.floor(now.getTime() / SEARCH_ROTATION_WINDOW_MS);
}

const STEAM_PULSE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const STEAM_REVIEW_MAX_PAGES = 10;
const STEAM_REVIEW_RECEIPT_CHUNK_SIZE = 100;
// Scheduled scans run hourly; three hours of reply activity covers a late or
// skipped run. Already-processed unchanged threads are skipped, so the overlap
// costs no extraction calls.
const STEAM_FORUM_LOOKBACK_MS = 3 * 60 * 60 * 1000;
const STEAM_FORUM_MAX_PAGES = 3;
const STEAM_FORUM_MAX_TOPICS = 10;

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

    const firstBatch = await fetchSteamReviewBatch({ fetchImpl: scannerSourceFetch() });
    const reviewsByHash = new Map(
      firstBatch.reviews.map((review) => [review.recommendationHash, review] as const),
    );
    const seenCursors = new Set<string>();
    let cursor = firstBatch.cursor;
    let pagesFetched = 1;
    while (cursor && pagesFetched < STEAM_REVIEW_MAX_PAGES) {
      if (seenCursors.has(cursor)) throw new Error("Steam reviews pagination cursor repeated");
      seenCursors.add(cursor);
      const nextBatch = await fetchSteamReviewBatch({ cursor, fallbackTotals: firstBatch.totals, fetchImpl: scannerSourceFetch() });
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

export function forumSourceTextHash(title: string, text: string): string {
  return hashValue(`${title}\n${text}`);
}

/**
 * Threads from the game's Steam Community forum with a reply inside the lookback,
 * most recently active first. They enter as ordinary web candidates from
 * steamcommunity.com, the same shape a search result for the thread would have,
 * so the pre-screen, extraction and promotion rules apply unchanged. Recent
 * activity decides intake; the opening post's time is the publication date that
 * patch freshness judges. A reply after the patch keeps an older thread as a
 * stored lead (`active_after_patch`), but never makes it current evidence.
 * An opening time Steam shows but that cannot be read is passed through as is,
 * which the date gate rejects as invalid_source_date before any extraction call.
 * Author names never enter the candidate: only a keyed hash of the opening
 * post's author does, so separate threads from one player count once.
 *
 * Every thread carries any processing proof stored for it on the current patch.
 * Threads without matching proof come first and take the 10 slots; threads whose
 * forum text matches their proof follow, so a same-URL search result can still
 * merge with them and keep the forum's opening date. See mergeForumWithSearch
 * and isUnchangedForumWork for when proof skips extraction.
 */
async function collectSteamForumInputs(
  supabase: ReturnType<typeof createServiceClient>,
  result: AutomationResult,
  now: Date,
  currentPatch: CurrentPatchContext,
): Promise<SourceInput[]> {
  if (!steamForumEnabled()) return [];
  try {
    const secret = process.env.SESSION_SECRET;
    const topics = await fetchSteamForumTopics({
      since: new Date(now.getTime() - STEAM_FORUM_LOOKBACK_MS),
      now,
      maxPages: STEAM_FORUM_MAX_PAGES,
      fetchImpl: scannerSourceFetch(),
      authorKey: (name) => forumAuthorKey(name, secret),
    });
    const stored = await loadStoredForumThreads(
      supabase,
      topics.map((topic) => canonicalizeUrl(topic.url)),
      currentPatch,
    );
    try {
      await recordForumAuthorKeys(supabase, result, topics, stored, now);
    } catch (error) {
      // The key only lets a stored thread count toward the player-thread rule.
      // Missing it this run leaves that thread uncounted, so intake goes on.
      result.status = result.status === "success" ? "partial" : result.status;
      result.errors.push(toErrorMessage(error, "Steam forum author keys could not be saved"));
      result.skips.push("steam_forum_author_keys_failed");
    }
    const inputs: SourceInput[] = topics.map((topic) => {
      const forumTextHash = forumSourceTextHash(topic.title, topic.preview);
      return {
        source: "web_search",
        id: topic.url,
        title: topic.title,
        body: topic.preview,
        url: topic.url,
        observedAt: now.toISOString(),
        sourceDomain: "steamcommunity.com",
        sourcePublishedAt: topic.postedAtStatus === "malformed" ? topic.postedText : topic.postedAt,
        sourceActiveAt: topic.lastPostAt,
        forum: {
          forumTextHash,
          inputHash: forumTextHash,
          postedAtStatus: topic.postedAtStatus,
          patchVersion: currentPatch.version,
          proof: stored.get(canonicalizeUrl(topic.url))?.proof ?? null,
          authorKey: topic.authorKey,
        },
      };
    });
    const unchanged = (input: SourceInput) => input.forum?.proof?.forumTextHash === input.forum?.forumTextHash;
    return [
      ...inputs.filter((input) => !unchanged(input)).slice(0, STEAM_FORUM_MAX_TOPICS),
      ...inputs.filter(unchanged),
    ];
  } catch (error) {
    result.status = result.status === "success" ? "partial" : result.status;
    result.errors.push(toErrorMessage(error, "Steam forum collection failed"));
    result.skips.push("steam_forum_failed");
    return [];
  }
}

export type ForumProcessingProof = { forumTextHash: string; inputHash: string; patchVersion: string };

export function forumProcessingProof(value: unknown): ForumProcessingProof | null {
  if (!value || typeof value !== "object") return null;
  const proof = value as Record<string, unknown>;
  return typeof proof.forumTextHash === "string" && typeof proof.inputHash === "string" && typeof proof.patchVersion === "string"
    ? { forumTextHash: proof.forumTextHash, inputHash: proof.inputHash, patchVersion: proof.patchVersion }
    : null;
}

type StoredForumThread = {
  id: string;
  clusterId: string | null;
  facts: Record<string, unknown>;
  /** Processing proof stored on the current patch, or null. */
  proof: ForumProcessingProof | null;
};

/** Canonical URL -> the row already stored for the thread. */
async function loadStoredForumThreads(
  supabase: ReturnType<typeof createServiceClient>,
  canonicalUrls: string[],
  currentPatch: CurrentPatchContext,
): Promise<Map<string, StoredForumThread>> {
  const stored = new Map<string, StoredForumThread>();
  if (canonicalUrls.length === 0) return stored;
  const { data, error } = await supabase
    .from("source_signals")
    .select("id, cluster_id, canonical_url, extracted_facts")
    .in("canonical_url", canonicalUrls);
  if (error) throw new Error(`Steam forum memory read failed: ${error.message}`);
  for (const row of (data ?? []) as { id: string | null; cluster_id: string | null; canonical_url: string | null; extracted_facts: Record<string, unknown> | null }[]) {
    if (!row.id || !row.canonical_url) continue;
    const facts = row.extracted_facts ?? {};
    const proof = forumProcessingProof(facts.forumProcessed);
    stored.set(row.canonical_url, {
      id: row.id,
      clusterId: row.cluster_id ?? null,
      facts,
      proof: proof && proof.patchVersion === currentPatch.version ? proof : null,
    });
  }
  return stored;
}

/**
 * Saves the author key on threads kept by an earlier run. An unchanged thread
 * skips extraction and is never written again, so without this it could not
 * count toward the player-thread rule. Only the key is written; each cluster
 * that gains a key is checked again for publication.
 */
async function recordForumAuthorKeys(
  supabase: ReturnType<typeof createServiceClient>,
  result: AutomationResult,
  topics: { url: string; authorKey: string | null }[],
  stored: Map<string, StoredForumThread>,
  now: Date,
): Promise<void> {
  const touchedClusters = new Set<string>();
  for (const topic of topics) {
    const row = topic.authorKey ? stored.get(canonicalizeUrl(topic.url)) : undefined;
    if (!row || storedAuthorKey(row.facts) === topic.authorKey) continue;
    const facts = { ...row.facts, authorKey: topic.authorKey };
    const { error } = await supabase.from("source_signals").update({ extracted_facts: facts }).eq("id", row.id);
    if (error) throw new Error(`Steam forum author key write failed: ${error.message}`);
    row.facts = facts;
    if (row.clusterId) touchedClusters.add(row.clusterId);
  }
  for (const clusterId of touchedClusters) {
    if (await refreshClusterStats(supabase, clusterId, now)) result.clustersPromoted += 1;
  }
}

/**
 * True when a forum-linked candidate would send extraction the same work that
 * already succeeded on the current patch: its forum text matches the proof and,
 * when it was merged into a search result, so does the combined title and body.
 * Changed or richer search text, changed forum text, a new patch, or a missing
 * proof (no successful extraction yet) keep it eligible. Plain search results,
 * which carry no forum provenance, are never affected.
 */
export function isUnchangedForumWork(signal: SourceInput): boolean {
  const forum = signal.forum;
  if (!forum?.proof || forum.proof.patchVersion !== forum.patchVersion) return false;
  if (forum.proof.forumTextHash !== forum.forumTextHash) return false;
  return !forum.viaSearch || forum.proof.inputHash === forum.inputHash;
}

/**
 * One candidate per page. When search returned the same thread, the search
 * result is kept and takes the longer text, so a short forum preview never
 * replaces a richer snippet. The forum's opening time is authoritative for the
 * thread: a readable one replaces the search date, and an unreadable one stays
 * unreadable so the date gate still rejects it; only a missing one leaves the
 * search date in place. The merged candidate keeps the forum provenance (so its
 * processing proof is recorded and checked against the combined input) but
 * counts as a search result for call allocation. A forum-only thread whose text
 * matches its proof is dropped here: it has no search date to protect and no new
 * work. Search results and forum threads then alternate, search first.
 */
export function mergeForumWithSearch(
  forum: SourceInput[],
  web: SourceInput[],
): { inputs: SourceInput[]; unchangedForumThreads: number } {
  const webByUrl = new Map<string, number>();
  const merged = web.map((input, index) => {
    try {
      // prepareSignals keeps the first copy of a URL, so merge into that one.
      const url = canonicalizeUrl(input.url);
      if (!webByUrl.has(url)) webByUrl.set(url, index);
    } catch {
      // An invalid search URL is reported where prepareSignals canonicalizes it.
    }
    return input;
  });
  const forumOnly: SourceInput[] = [];
  let unchangedForumThreads = 0;
  for (const thread of forum) {
    const index = webByUrl.get(canonicalizeUrl(thread.url));
    if (index === undefined) {
      if (isUnchangedForumWork(thread)) unchangedForumThreads += 1;
      else forumOnly.push(thread);
      continue;
    }
    const search = merged[index];
    const body = thread.body.length > search.body.length ? thread.body : search.body;
    merged[index] = {
      ...search,
      body,
      sourcePublishedAt: thread.forum?.postedAtStatus === "missing" ? search.sourcePublishedAt : thread.sourcePublishedAt,
      sourceActiveAt: thread.sourceActiveAt ?? search.sourceActiveAt ?? null,
      ...(thread.forum
        ? { forum: { ...thread.forum, viaSearch: true, inputHash: forumSourceTextHash(search.title, body) } }
        : {}),
    };
  }
  const ordered: SourceInput[] = [];
  for (let index = 0; index < Math.max(merged.length, forumOnly.length); index += 1) {
    if (index < merged.length) ordered.push(merged[index]);
    if (index < forumOnly.length) ordered.push(forumOnly[index]);
  }
  return { inputs: ordered, unchangedForumThreads };
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
        const found = await tavilySearch(query, { now, startDate, paidGuard: budget.paidGuard });
        result.searchResultsSeen += found.length;
        inputs.push(...found.slice(0, 5).map(searchResultToInput));
      } catch (error) {
        result.status = "partial";
        if (error instanceof ScannerAccountingError) stopPaidAccounting(result, budget, error);
        else result.errors.push(toErrorMessage(error, "search failed"));
      }
      await report?.();
      if (!budget.allowPaidSearch) break;
    }
    if (wireSlot && budget.allowPaidSearch) {
      try {
        result.searchQueriesUsed += 1;
        result.estimatedCostUsd += SEARCH_QUERY_COST_USD;
        const found = await tavilySearch(buildWireNewsQuery(), { now, startDate, topic: "news", paidGuard: budget.paidGuard });
        result.searchResultsSeen += found.length;
        inputs.push(...found.slice(0, 5).map(searchResultToInput));
      } catch (error) {
        result.status = "partial";
        if (error instanceof ScannerAccountingError) stopPaidAccounting(result, budget, error);
        else result.errors.push(toErrorMessage(error, "wire news search failed"));
      }
      await report?.();
    }
  } else if (!f.webSearch) {
    result.skips.push("search_disabled");
  }

  return inputs;
}

type IntakeLane = "forum" | "search";

function intakeLane(signal: SourceInput): IntakeLane | null {
  if (signal.source === "steam_review") return null;
  return signal.forum && !signal.forum.viaSearch ? "forum" : "search";
}

/**
 * Splits the run's remaining extraction calls between search results and forum
 * threads so neither source can use them all while the other still has work.
 * The split is taken when the first search or forum candidate asks for calls
 * (Steam reviews, which come first, keep using the shared remainder as before):
 * with A calls left, forum threads may use floor(A / 2) and search results the
 * rest, so search gets the odd call because its credits are already spent.
 * A source is held to its share only while the other source still has a later
 * candidate that will reach extraction (`reachesExtraction`, which applies the
 * preparation loop's own duplicate, date, operator-rule and pre-screen gates);
 * once the other has none, it may use whatever the shared cap leaves. A
 * candidate that only reaches extraction through a recon rescue is not
 * reserved for. Every grant is also capped by the shared remainder, so the run
 * total never exceeds the existing cap.
 */
export function createLaneAllocation(
  candidates: SourceInput[],
  reachesExtraction: (index: number) => boolean,
  sharedRemaining: () => number,
) {
  const waiting: Record<IntakeLane, number> = { forum: 0, search: 0 };
  const counted = new Map<number, IntakeLane>();
  candidates.forEach((signal, index) => {
    const lane = intakeLane(signal);
    if (!lane || !reachesExtraction(index)) return;
    waiting[lane] += 1;
    counted.set(index, lane);
  });
  const usedByLane: Record<IntakeLane, number> = { forum: 0, search: 0 };
  let split: number | null = null;
  return {
    reached(index: number) {
      const lane = counted.get(index);
      if (lane) waiting[lane] -= 1;
    },
    callsFor(lane: IntakeLane | null): number {
      const shared = sharedRemaining();
      if (!lane) return shared;
      if (split === null) split = shared;
      const other: IntakeLane = lane === "forum" ? "search" : "forum";
      if (waiting[other] <= 0) return shared;
      const forumShare = Math.floor(split / 2);
      const share = lane === "forum" ? forumShare : split - forumShare;
      return Math.max(0, Math.min(shared, share - usedByLane[lane]));
    },
    used(lane: IntakeLane | null, calls: number) {
      if (lane) usedByLane[lane] += calls;
    },
  };
}

async function prepareSignals(
  inputs: SourceInput[],
  result: AutomationResult,
  budget: AutomationBudget,
  currentPatch: CurrentPatchContext,
  clusterOptionsFor: (text: string) => ClusterOption[],
  feedbackRules: ScannerFeedbackRule[],
  storedSourceDates: StoredObservationDates,
  now: Date,
  report?: () => Promise<void>,
  onAttempt?: OpenRouterAttemptReporter,
): Promise<{ prepared: PreparedSignal[]; rejected: RejectedCandidate[]; observations: ObservationCandidate[] }> {
  const prepared: PreparedSignal[] = [];
  const rejected: RejectedCandidate[] = [];
  const observations: ObservationCandidate[] = [];
  const seenObservationHashes = new Set<string>();
  const seenUrls = new Set<string>();
  const seenExternalIds = new Set<string>();
  let reconFetchesUsed = 0;
  let languageReviewsUsed = 0;

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
    // The shelf shows source text as is, so only English items go on it.
    if (isMostlyNonEnglish(signal.title) || isMostlyNonEnglish(snippet)) return;
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
  const intake = [
    ...inputs.filter((signal) => signal.source === "steam_review").slice(0, 100),
    ...inputs.filter((signal) => signal.source !== "steam_review").slice(0, limit),
  ];
  const candidates = steamForumEnabled()
    ? await withSteamThreadReplies(intake, {
        looksStale: (signal, canonicalUrl) => {
          const dates = resolveDates(signal, canonicalUrl, signal.body);
          return dates.providerDateStatus !== "invalid" && evaluateCurrentPatchEligibility(
            { title: signal.title, snippet: signal.body, sourcePublishedAt: dates.asserted, sourceActiveAt: null },
            currentPatch,
          ).reason === "stale_source";
        },
        readLatestReply: (url) => fetchSteamThreadLatestReply(url, { now, fetchImpl: scannerSourceFetch() }),
        onCheck: (found) => {
          result.skips.push("steam_thread_reply_check");
          if (!found) result.skips.push("steam_thread_reply_unavailable");
        },
      })
    : intake;
  result.candidatesSeen += candidates.length;

  // Replays the loop's gates up to extraction, in the same order and with the
  // same duplicate memory, so call reservation counts only real extraction work.
  const plannedUrls = new Set<string>();
  const plannedExternalIds = new Set<string>();
  const reachesExtraction = candidates.map((signal) => {
    let canonicalUrl: string;
    try {
      canonicalUrl = canonicalizeUrl(signal.url);
    } catch {
      return false;
    }
    const externalHash = signal.source === "steam_review"
      ? signal.id
      : externalIdHash(signal.source, signal.source === "web_search" ? canonicalUrl : signal.id);
    if ((signal.source !== "steam_review" && plannedUrls.has(canonicalUrl)) || plannedExternalIds.has(externalHash)) {
      return false;
    }
    if (signal.source !== "steam_review") plannedUrls.add(canonicalUrl);
    plannedExternalIds.add(externalHash);
    const dates = resolveDates(signal, canonicalUrl, signal.body);
    if (dates.providerDateStatus === "invalid") return false;
    const rule = signal.source === "steam_review"
      ? null
      : matchScannerFeedbackRule({ url: canonicalUrl, sourceDomain: signal.sourceDomain }, feedbackRules, now);
    if (rule?.action === "block") return false;
    if (isUnchangedForumWork(signal)) return false;
    if (rule?.action === "allow") return true;
    // Language reviews are not reserved here: they run on their own extra
    // allowance (MAX_LANGUAGE_CALLS_PER_RUN), never on the lanes' shared calls.
    return preScreenCandidate(
      {
        title: signal.title,
        snippet: signal.body,
        url: canonicalUrl,
        sourceDomain: signal.sourceDomain,
        sourcePublishedAt: dates.asserted,
        sourceActiveAt: signal.sourceActiveAt ?? null,
      },
      { currentPatchVersion: currentPatch.version, currentPatchPublishedAt: currentPatch.publishedAt },
    ).keep;
  });
  const allocation = createLaneAllocation(
    candidates,
    (index) => reachesExtraction[index] ?? false,
    () => remainingLlmCalls(result, budget),
  );

  for (const [candidateIndex, signal] of candidates.entries()) {
    allocation.reached(candidateIndex);
    const lane = intakeLane(signal);
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
                sourceActiveAt: signal.sourceActiveAt ?? null,
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
    const screened: SignalRelevanceDecision = operatorAllowed ? { keep: true as const } : preScreenCandidate(
      {
        title: signal.title,
        snippet: signal.body,
        url: canonicalUrl,
        sourceDomain: signal.sourceDomain,
        sourcePublishedAt: snippetDates.asserted,
        sourceActiveAt: signal.sourceActiveAt ?? null,
      },
      { currentPatchVersion: currentPatch.version, currentPatchPublishedAt: currentPatch.publishedAt },
    );
    // A post in another language that the word lists cannot read goes to the AI
    // instead of being dropped, up to MAX_LANGUAGE_CALLS_PER_RUN per scan. The run
    // log's "language_review", "non_english_ai" and "non_english_kept" notes show
    // whether these calls find real reports.
    const wantsLanguageReview = admitsLanguageReview(signal, screened);
    // A thread already read on this patch with this same text is skipped here,
    // before it can take a language review from a post that is new.
    if (wantsLanguageReview && isUnchangedForumWork(signal)) {
      result.skips.push("steam_forum_unchanged");
      result.signalsDeduped += 1;
      await report?.();
      continue;
    }
    const languageReview =
      wantsLanguageReview &&
      languageReviewsUsed < MAX_LANGUAGE_CALLS_PER_RUN &&
      paidAiEnabled(result, budget);
    if (languageReview) {
      languageReviewsUsed += 1;
      result.skips.push("language_review");
    }
    const preScreen: SignalRelevanceDecision = languageReview ? { keep: true } : screened;
    if (!preScreen.keep) {
      if (
        preScreen.reason === "source_not_issue_report" &&
        // A post in another language reaches the AI through a language review
        // only, so MAX_LANGUAGE_CALLS_PER_RUN holds: the rescue's English context
        // words ("bug", "thread") say little about such a post.
        !preScreen.languageReview &&
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
        // unbilled goes free. Four cases:
        //
        //   1. Page text returned      -> billed. Charge.
        //   2. Answered, no text       -> Tavily replies 200 with the URL in
        //      (nothing thrown)           `failed_results` and bills nothing, which
        //                                 tavilyExtract reports as null. Free.
        //   3. Answered, empty         -> 200 with no text and no refusal. Tavily may
        //      (TavilyExtractNoContentError) have billed it, so the one reserved
        //                                 credit is charged. The page is skipped and
        //                                 the run continues: a warning, not a failure.
        //   4. Threw                   -> a timeout, 5xx, or unparseable body can
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
          // Only sites whose pages Tavily can read. Reddit, for one, is judged on
          // its search snippet and never takes a recon slot.
          isReconExtractDomain(signal.sourceDomain) &&
          reconFetchesUsed < MAX_RECON_FETCHES_PER_RUN &&
          result.searchQueriesUsed < budget.maxTavilyCreditsPerRun
        ) {
          reconFetchesUsed += 1;
          result.skips.push("candidate_recon");
          let reconThrew = false;
          let reconEmpty = false;
          try {
            reconText = await tavilyExtract(canonicalUrl, { now: new Date(signal.observedAt), paidGuard: budget.paidGuard });
          } catch (error) {
            reconThrew = true;
            if (error instanceof TavilyExtractNoContentError) reconEmpty = true;
            else {
              result.status = "partial";
              if (error instanceof ScannerAccountingError) stopPaidAccounting(result, budget, error);
              else result.errors.push(toErrorMessage(error, "recon extract failed"));
            }
            reconText = null;
          }
          if (reconText !== null || reconThrew) {
            result.searchQueriesUsed += 1;
            result.estimatedCostUsd += SEARCH_QUERY_COST_USD;
          }
          if (reconText === null) {
            // Say which empty outcome happened: the operator console must not report
            // an unbilled refusal, a charged empty page and an error as the same thing.
            result.skips.push(reconEmpty ? "candidate_recon_empty" : reconThrew ? "candidate_recon_failed" : "candidate_recon_unavailable");
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
              sourceActiveAt: signal.sourceActiveAt ?? null,
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

        // A rescued forum-linked candidate is judged and remembered by the text
        // extraction actually reads: the fetched page, not the thin snippet.
        const rescued: SourceInput = reconText !== null && signal.forum
          ? { ...signal, forum: { ...signal.forum, inputHash: forumSourceTextHash(signal.title, effectiveBody) } }
          : signal;
        if (isUnchangedForumWork(rescued)) {
          result.skips.push("steam_forum_unchanged");
          result.signalsDeduped += 1;
          await report?.();
          continue;
        }
        stopPaidWorkIfGuardStopped(result, budget);
        const extraction = await extractSignalWithOpenRouter(
          { title: signal.title, snippet: effectiveBody, url: canonicalUrl },
          applyAiRuntimeOptions(budget, {
            onDiagnostic: (diagnostic) => recordOpenRouterDiagnostic(result, diagnostic),
            onAttempt,
            paidGuard: budget.paidGuard,
            modelPreset: budget.modelPreset,
            llmDeadlineAtMs: budget.llmDeadlineAtMs,
            llmCallsRemaining: allocation.callsFor(lane),
            llmBudgetRemainingUsd: Math.max(0, budget.remainingLlmUsd - result.llmCostUsd),
            clusterOptions: clusterOptionsFor(`${signal.title} ${effectiveBody}`),
          }),
        );
        result.llmCallsUsed += extraction.llmCallsUsed;
        allocation.used(lane, extraction.llmCallsUsed);
        if (extraction.extractionProvider === "openrouter") result.llmSucceeded = (result.llmSucceeded ?? 0) + 1;
        result.llmCostUsd += extraction.llmCostUsd ?? 0;
        result.estimatedCostUsd += extraction.llmCostUsd ?? 0;
        if (extraction.fallbackReason) result.skips.push(extraction.fallbackReason);
        recordOpenRouterRunSkip(result, extraction.fallbackReason);

        // The same English-only rule as the main path (see englishStorage).
        const rescueStorage = englishStorage(signal, effectiveBody, extraction);
        const relevance = rescueStorage.store
          ? shouldKeepExtractedSignal(extraction, `${signal.title} ${effectiveBody}`, { honorAiVerdict: rescueStorage.nonEnglish })
          : { keep: false as const, reason: "language_needs_ai" as const };
        if (relevance.keep) {
          result.skips.push("candidate_rescued");
          result.candidatesRescued += 1;
          prepared.push({
            ...rescued,
            ...(rescueStorage.storedTitle ? { storedTitle: rescueStorage.storedTitle } : {}),
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

    if (isUnchangedForumWork(signal)) {
      result.skips.push("steam_forum_unchanged");
      result.signalsDeduped += 1;
      await report?.();
      continue;
    }
    stopPaidWorkIfGuardStopped(result, budget);
    // A post in another language needs the AI to be stored at all (see
    // englishStorage). When the lanes' shared calls are spent, it may use the
    // separate non-English allowance instead, one call each.
    const nonEnglishInput = isMostlyNonEnglish(signal.title) || isMostlyNonEnglish(signal.body);
    const laneCalls = allocation.callsFor(lane);
    const extraLanguageCall =
      nonEnglishInput &&
      laneCalls <= 0 &&
      extraLanguageCallsUsed(result) < MAX_LANGUAGE_CALLS_PER_RUN &&
      paidAiEnabled(result, budget);
    const extraction = await extractSignalWithOpenRouter(
      { title: signal.title, snippet: signal.body, url: canonicalUrl },
      applyAiRuntimeOptions(budget, {
        onDiagnostic: (diagnostic) => recordOpenRouterDiagnostic(result, diagnostic),
        onAttempt,
        paidGuard: budget.paidGuard,
        modelPreset: budget.modelPreset,
        llmDeadlineAtMs: budget.llmDeadlineAtMs,
        llmCallsRemaining: extraLanguageCall ? 1 : laneCalls,
        llmBudgetRemainingUsd: Math.max(0, budget.remainingLlmUsd - result.llmCostUsd),
        clusterOptions: clusterOptionsFor(`${signal.title} ${signal.body}`),
      }),
    );
    result.llmCallsUsed += extraction.llmCallsUsed;
    if (extraLanguageCall) {
      for (let call = 0; call < extraction.llmCallsUsed; call += 1) result.skips.push("language_extra_call");
    } else {
      allocation.used(lane, extraction.llmCallsUsed);
    }
    if (extraction.extractionProvider === "openrouter") result.llmSucceeded = (result.llmSucceeded ?? 0) + 1;
    result.llmCostUsd += extraction.llmCostUsd ?? 0;
    result.estimatedCostUsd += extraction.llmCostUsd ?? 0;
    if (extraction.fallbackReason) result.skips.push(extraction.fallbackReason);
    recordOpenRouterRunSkip(result, extraction.fallbackReason);

    const storage = englishStorage(signal, signal.body, extraction);
    if (!storage.store) {
      result.skips.push("language_needs_ai");
      rejected.push({
        source: signal.source,
        title: signal.title,
        url: canonicalUrl,
        sourceDomain: signal.sourceDomain,
        sourcePublishedAt: snippetDates.asserted,
        snippet: signal.body.slice(0, 500),
        reason: "language_needs_ai",
        steamRecommendationHash: signal.steam?.recommendationHash ?? null,
      });
      await report?.();
      continue;
    }
    if (storage.nonEnglish) result.skips.push("non_english_ai");
    // A post in another language is judged on what the AI wrote too: the
    // source's own words may be ones the lists cannot read. A post that only a
    // language review let in matched no symptom word at all, so it is kept only
    // when the AI itself says it reports a problem: praise must not become a lead.
    const relevance: SignalRelevanceDecision = operatorAllowed
      ? { keep: true as const }
      : languageReview && extraction.isReport !== true
        ? { keep: false as const, reason: "source_not_issue_report" as const }
        : shouldKeepExtractedSignal(
            extraction,
            storage.nonEnglish
              ? `${signal.title} ${signal.body} ${extraction.issueTitle} ${extraction.summary}`
              : `${signal.title} ${signal.body}`,
            { honorAiVerdict: storage.nonEnglish },
          );
    if (storage.nonEnglish && relevance.keep) result.skips.push("non_english_kept");
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
      ...(storage.storedTitle ? { storedTitle: storage.storedTitle } : {}),
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
    .select("id, cluster_id, category, platform, issue_title, patch_version")
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
  signal_count?: number | string | null;
};

type RoutableClusterRow = SemanticClusterCandidate;

export const MAX_SEMANTIC_NAMED_CLUSTER_OPTIONS = 24;
export const MAX_SEMANTIC_AUTO_CLUSTER_OPTIONS = 8;
const ROUTABLE_CLUSTER_PAGE_SIZE = 1000;
const ROUTABLE_CLUSTER_COLUMNS =
  "id, slug, title, category, description, last_signal_at, created_at, lifecycle_reason, signal_count";

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

/**
 * The known clusters one source may be assigned to: the newest named clusters,
 * as before, plus the automatic clusters that share the most distinctive words
 * with that source, across categories and ages. The newest-first window let
 * older topics fall out of reach, so each new wording started its own cluster.
 * Empty clusters are left out; a match should accumulate where signals are.
 */
export function createSemanticClusterOptions(clusters: SemanticClusterCandidate[]): (text: string) => ClusterOption[] {
  const named = clusters
    .filter((cluster) => !isAutoCluster(cluster))
    .sort(compareClusterRecency)
    .slice(0, MAX_SEMANTIC_NAMED_CLUSTER_OPTIONS);
  const isEmpty = (cluster: SemanticClusterCandidate) =>
    cluster.signal_count !== null && cluster.signal_count !== undefined && Number(cluster.signal_count) === 0;
  const retrieve = createClusterRetriever(
    clusters.filter((cluster) => isActiveAutoCluster(cluster) && !isEmpty(cluster)),
    MAX_SEMANTIC_AUTO_CLUSTER_OPTIONS,
  );
  const toOption = (cluster: SemanticClusterCandidate): ClusterOption => ({
    slug: cluster.slug,
    title: cluster.title,
    category: cluster.category,
    description: cluster.description ?? null,
  });
  return (text) => [...named, ...retrieve(text)].map(toOption);
}

type ClusterRoutingState = {
  /** All explicitly named clusters preserve the existing keyword route path. */
  keywordClusters: RoutableClusterRow[];
  /**
   * Named clusters plus every active automatic cluster. An automatic cluster is
   * reached only by a parser-validated sure assignment from the options that
   * one source was offered.
   */
  semanticRoutingClusters: RoutableClusterRow[];
  semanticOptionsFor: (text: string) => ClusterOption[];
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
  return {
    keywordClusters,
    semanticRoutingClusters: [...keywordClusters, ...allClusters.filter(isActiveAutoCluster)],
    semanticOptionsFor: createSemanticClusterOptions(allClusters),
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
  onAttempt?: OpenRouterAttemptReporter,
): Promise<void> {
  const [clusters, claimedRegister] = await Promise.all([
    loadLifecycleClusters(supabase),
    readClaimedFixesForCurrentPatch(supabase),
  ]);
  const claims = claimedRegister.fixes;
  const claimDecisionByCluster = new Map<string, ClaimMappingDecision>();
  const claimReviewProposals: ClaimReviewProposal[] = [];
  const initialLlmCallsRemaining = remainingLlmCalls(result, budget);
  const extractionReserve = budget.allowPaidSearch
    ? Math.min(MAX_RESERVED_EXTRACTION_LLM_CALLS, Math.floor(initialLlmCallsRemaining / 2))
    : 0;
  let claimLlmCallsRemaining = initialLlmCallsRemaining - extractionReserve;
  const claimOffset = claims.length > 0 ? Math.floor(now.getTime() / SEARCH_ROTATION_WINDOW_MS) % claims.length : 0;
  const orderedClaims = [...claims.slice(claimOffset), ...claims.slice(0, claimOffset)];

  for (const claim of orderedClaims) {
    const llmCallsRemaining = Math.min(claimLlmCallsRemaining, remainingLlmCalls(result, budget));
    const mappingOptions: ClaimMappingOptions = applyAiRuntimeOptions(budget, {
      onDiagnostic: (diagnostic) => recordOpenRouterDiagnostic(result, diagnostic),
      onAttempt,
      paidGuard: budget.paidGuard,
      modelPreset: budget.modelPreset,
      llmDeadlineAtMs: budget.llmDeadlineAtMs,
      llmCallsRemaining,
      llmBudgetRemainingUsd: Math.max(0, budget.remainingLlmUsd - result.llmCostUsd),
    });
    const decision = aiRuntimeForBudget(budget)?.failed ? await mapClaimToClusterWithOpenRouter(claim, clusters, mappingOptions) :
      await reuseClaimMapping(supabase, claim, clusters, currentPatch, mappingOptions,
      () => mapClaimToClusterWithOpenRouter(claim, clusters, mappingOptions), now,
      (error) => recordScannerDiagnostic(result, "mapping_cache", error));
    result.llmCallsUsed += decision.llmCallsUsed;
    if (decision.llmCallsUsed > 0 && (decision.matchKind === "llm_sure" || decision.matchKind === "llm_unsure")) result.llmSucceeded = (result.llmSucceeded ?? 0) + 1;
    result.llmCostUsd += decision.llmCostUsd;
    result.estimatedCostUsd += decision.llmCostUsd;
    recordOpenRouterRunSkip(result, decision.skipReason);
    claimLlmCallsRemaining = Math.max(0, claimLlmCallsRemaining - decision.llmCallsUsed);
    if (!decision.clusterId) continue;
    if (decision.matchKind !== "none") {
      claimReviewProposals.push({
        fixText: claim.fixText,
        clusterId: decision.clusterId,
        proposalKind: decision.matchKind,
        proposalReason: needsReviewReason(decision.reason, "Claim mapping needs review."),
      });
    }
    const existing = claimDecisionByCluster.get(decision.clusterId);
    if (!existing || decisionRank(decision) > decisionRank(existing)) {
      claimDecisionByCluster.set(decision.clusterId, decision);
    }
  }

  // The durable resolver is the live path whenever its RPC exists. A missing
  // function is the pre-migration rolling-deploy fallback. A claimed-fixes
  // read failure must not look like an empty register: that would skip the
  // resolver and let the legacy writer clear Needs review prose.
  const durable = await recordClaimReviewProposals(supabase, { proposals: claimReviewProposals, now });
  const durableByCluster = durable.status === "available"
    ? new Map(durable.decisions.map((decision) => [decision.clusterId, decision]))
    : new Map<string, ClaimReviewLifecycleDecision>();

  for (const cluster of clusters) {
    const durableDecision = durableByCluster.get(cluster.id);
    // The durable RPC already writes its matching cluster state under the same
    // lock as its pairing/audit record. A second write here would advance the
    // lifecycle revision after the card was issued and make every operator
    // action stale before it reaches the desk.
    if (durableDecision) continue;
    const claimDecision = toLifecycleClaimDecision(claimDecisionByCluster.get(cluster.id));
    const computed = computeClusterLifecycle({
      currentStatus: cluster.fix_status,
      fixClaimedAt: cluster.fix_claimed_at ?? null,
      fixClaimedPatchVersion: cluster.fix_claimed_patch_version ?? null,
      currentPatchVersion: currentPatch.version,
      adminOverride: Boolean(cluster.admin_override),
      now,
      claimDecision,
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

/**
 * The routable cluster a source was stored in on an earlier observation. The
 * source stays when the new extraction names the cluster's category, or when the
 * stored record already matched its cluster and the new label differs only by
 * "other" (see `categoriesCompatible`), so an adopted category survives an unsure
 * re-extraction. Any other change of category means the page may now describe
 * another problem, so it routes afresh.
 */
async function findStoredSignalCluster(
  supabase: ReturnType<typeof createServiceClient>,
  signal: PreparedSignal,
  routableClusters: RoutableCluster[],
): Promise<string | null> {
  const { data, error } = await supabase
    .from("source_signals")
    .select("cluster_id, category")
    .eq("external_id_hash", signal.externalHash)
    .not("cluster_id", "is", null)
    .limit(1);
  if (error) throw new Error(`stored signal cluster read failed: ${error.message}`);
  const stored = ((data ?? []) as { cluster_id?: string | null; category?: string | null }[])[0];
  const cluster = stored?.cluster_id ? routableClusters.find((candidate) => candidate.id === stored.cluster_id) : undefined;
  if (!cluster) return null;
  const category = String(cluster.category);
  const extracted = signal.extraction.category;
  return category === extracted || (stored?.category === category && categoriesCompatible(category, extracted)) ? cluster.id : null;
}

/** The routed cluster when it is the model's validated sure assignment, not a keyword fallback. */
function sureSemanticRoute(signal: PreparedSignal, routed: RoutableCluster | null): RoutableCluster | null {
  return signal.extraction.clusterAssignment === "sure" && routed?.slug === signal.extraction.clusterSlug ? routed : null;
}

/**
 * A signal stored in a cluster whose category differs from its own only by
 * "other" (see `categoriesCompatible`) takes the cluster's category, so the
 * record and its cluster agree. That covers a sure assignment across the two, a
 * same-scan duplicate reaching the cluster from the route cache, and a
 * re-observed source staying in the cluster it was stored in.
 */
function adoptedClusterCategory(
  signal: PreparedSignal,
  clusterId: string | null,
  routableClusters: RoutableCluster[],
): Category | null {
  const cluster = clusterId ? routableClusters.find((candidate) => candidate.id === clusterId) : undefined;
  const category = cluster ? String(cluster.category) : null;
  return category
    && category !== signal.extraction.category
    && categoriesCompatible(category, signal.extraction.category)
    && (CATEGORIES as readonly string[]).includes(category)
    ? (category as Category)
    : null;
}

/** The signal as it is stored: in its cluster's category, with a fingerprint to match. */
function withAdoptedCategory(
  signal: PreparedSignal,
  clusterId: string | null,
  routableClusters: RoutableCluster[],
): PreparedSignal {
  const category = adoptedClusterCategory(signal, clusterId, routableClusters);
  if (!category) return signal;
  // The stored fingerprint must match the stored category, so a later source
  // with the same title and the cluster's category finds this record.
  return {
    ...signal,
    extraction: { ...signal.extraction, category },
    semantic: semanticFingerprint(signal.extraction.issueTitle, category),
  };
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
  // A page or "no issue" title is not an issue: store the signal clusterless.
  if (isJunkClusterTitle(signal.extraction.issueTitle)) return null;
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
  // A source seen before stays in its cluster when nothing more specific
  // applies: a reworded re-extraction of the same kind of problem must not move
  // it into a fresh cluster and leave the old one empty. A sure model
  // assignment still moves it.
  const sureRoute = sureSemanticRoute(signal, routedCluster);
  const storedCluster = existingSignalCluster || sureRoute
    ? null
    : await findStoredSignalCluster(supabase, signal, routableClusters);
  const preferredCluster = existingSignalCluster ?? sureRoute?.id ?? storedCluster ?? routedCluster?.id ?? null;
  // A reworded duplicate of an automatic cluster joins it instead of starting a
  // new one (or, for provider context, staying unclustered).
  const nearDuplicate = preferredCluster || reportCluster
    ? null
    : nearDuplicateAutoCluster(signal.extraction.issueTitle, signal.extraction.category, routableClusters)?.id ?? null;
  if (isProviderContextSource({ source: signal.source, domain: signal.sourceDomain, url: signal.canonicalUrl })) {
    // Steam reviews and the publisher's own pages are private provider context,
    // never player evidence. Either may support a cluster whose public-safe
    // metadata already exists, but neither may create durable titles or
    // descriptions from provider content. The guard lives HERE because an
    // operator rescue deliberately skips the pre-screen — marking an official
    // rejection Relevant stores the signal, and it must still never mint a
    // cluster. The canonical url rides along because the domain column is
    // nullable, and a candidate stored without one must not slip the guard.
    const clusterId = preferredCluster ?? reportCluster ?? nearDuplicate;
    if (clusterId) clusterBySemantic.set(signal.semantic, clusterId);
    return clusterId ?? null;
  }
  const existingAutoCluster =
    preferredCluster || reportCluster
      ? null
      : await findAutoClusterBySlug(supabase, clusterSlug(signal.semantic));
  let clusterId = preferredCluster ?? reportCluster ?? existingAutoCluster ?? nearDuplicate;
  if (!clusterId) {
    clusterId = await createCluster(supabase, signal);
    // The routing list was read before this batch. A cluster created here joins
    // it, so a rewording later in the same batch can join this cluster instead
    // of starting another (nearDuplicateAutoCluster).
    routableClusters.push({
      id: clusterId,
      slug: clusterSlug(signal.semantic),
      title: signal.extraction.issueTitle,
      category: signal.extraction.category,
    });
  }
  clusterBySemantic.set(signal.semantic, clusterId);
  return clusterId;
}

type SignalPersistence = {
  kind: "inserted" | "reobserved";
  previousClusterId: string | null;
  observationError: unknown | null;
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
    title: (signal.storedTitle ?? signal.title).slice(0, 240),
    source_domain: signal.sourceDomain,
    source_published_at: signal.sourcePublishedAt ?? null,
    semantic_fingerprint: signal.semantic,
    cluster_id: clusterId,
    summary: signal.extraction.summary,
    extracted_facts: {
      issueTitle: signal.extraction.issueTitle,
      platform: signal.extraction.platform,
      sourcePatchVersions: extractSourcePatchVersions(`${signal.title} ${signal.body}`),
      ...(signal.forum && signal.extraction.extractionProvider === "openrouter"
        ? {
            forumProcessed: {
              forumTextHash: signal.forum.forumTextHash,
              inputHash: signal.forum.inputHash,
              patchVersion: signal.forum.patchVersion,
            },
          }
        : {}),
      ...(signal.steam
        ? {
            steamVotedUp: signal.steam.votedUp,
            playtimeAtReviewMinutes: signal.steam.playtimeAtReviewMinutes,
            sourceUpdatedAt: signal.steam.sourceUpdatedAt,
          }
        : {}),
      ...(storedSourceActiveAt({ sourceActiveAt: signal.sourceActiveAt })
        ? { sourceActiveAt: signal.sourceActiveAt as string }
        : {}),
      ...(signal.forum?.authorKey ? { authorKey: signal.forum.authorKey } : {}),
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
    .select("id, seen_count, first_seen_at, cluster_id, extracted_facts")
    .eq("external_id_hash", signal.externalHash)
    .limit(1);
  if (existingError) throw new Error(`source signal memory read failed: ${existingError.message}`);

  const existing = ((existingRows ?? []) as SourceSignalRow[])[0];
  if (existing?.id) {
    // A search-only sighting or a failed re-extraction writes no proof; keep the
    // proof an earlier successful forum extraction left, so overlap with search
    // cannot erase it.
    const priorProof = forumProcessingProof((existing.extracted_facts as Record<string, unknown> | null | undefined)?.forumProcessed);
    const priorAuthorKey = storedAuthorKey(existing.extracted_facts);
    const withProof = {
      ...baseRow.extracted_facts,
      ...(!("forumProcessed" in baseRow.extracted_facts) && priorProof ? { forumProcessed: priorProof } : {}),
      // A search sighting carries no author: keep the one the forum gave.
      ...(!("authorKey" in baseRow.extracted_facts) && priorAuthorKey ? { authorKey: priorAuthorKey } : {}),
    };
    // The same rule for activity: a sighting without the forum's last-reply time
    // (or with an older one) keeps the latest activity already stored.
    const priorActiveAt = storedSourceActiveAt(existing.extracted_facts);
    const nextActiveAt = storedSourceActiveAt(withProof);
    const facts = priorActiveAt && (!nextActiveAt || Date.parse(priorActiveAt) > Date.parse(nextActiveAt))
      ? { ...withProof, sourceActiveAt: priorActiveAt }
      : withProof;
    const { error } = await supabase
      .from("source_signals")
      .update({
        ...baseRow,
        extracted_facts: facts,
        first_seen_at: existing.first_seen_at ?? now.toISOString(),
        last_seen_at: now.toISOString(),
        seen_count: Number(existing.seen_count ?? 1) + 1,
        last_seen_run_id: runId,
      })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
    // The source move has committed. Return its outcome even if the separate
    // event write fails, so callers refresh both clusters and count the write.
    let observationError: unknown = null;
    try {
      await recordReobservationEvent(supabase, existing.id, runId, now);
    } catch (error) {
      observationError = error;
    }
    return { kind: "reobserved", previousClusterId: existing.cluster_id ?? null, observationError };
  }

  const { error } = await supabase.from("source_signals").insert({
    ...baseRow,
    first_seen_at: now.toISOString(),
    last_seen_at: now.toISOString(),
    seen_count: 1,
    last_seen_run_id: runId,
  });
  if (error) throw new Error(error.message);
  return { kind: "inserted", previousClusterId: null, observationError: null };
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
    if (!isCurrentPatchVerified(activeCurrentPatch)) {
      throw new Error("Current patch unavailable; issue visibility was not refreshed.");
    }
    const hasCheckins = await hasCurrentPatchCheckins(supabase, clusterId, activeCurrentPatch.version);
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
    // Only a report filed on the current patch family can publish or retain an
    // issue. Older reports still count in the cluster stats, but they cannot keep
    // a stale issue on the current board or vouch for a new lead riding on it.
    const currentPatchReportCount = clusterReports.filter(
      (report) => typeof report.patch_version === "string" && belongsToPatchFamily(report.patch_version, activeCurrentPatch.version),
    ).length;
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
    // The same publishable set as the domain counts, so the stale-source,
    // off-topic, provider-context and operator guards hold for threads too.
    const playerThreads = distinctPlayerThreadCount(publishableSignals, now);

    const automaticDecision = shouldPromoteSignalCluster({
      independentDomainCount,
      trustedDomainCount,
      distinctPlayerThreadCount: playerThreads,
      directReportCount: currentPatchReportCount,
      hasAdminForcePublic: false,
      hasAdminForceHidden: false,
    });
    const decision = cluster.admin_visibility_override
      ? shouldPromoteSignalCluster({
          independentDomainCount,
          trustedDomainCount,
          distinctPlayerThreadCount: playerThreads,
          directReportCount: currentPatchReportCount,
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
    const hasPublicEvidence = publicSignalCount > 0 || currentPatchReportCount > 0;
    const hasLiveCandidates = signals.some(
      (signal) =>
        !isOperatorBlocked(signal) &&
        !isContextOnlySignal(signal) &&
        !isUnsupportedStoredSignal(signal) &&
        hasStoredSignalGameContext(signal) &&
        sourceSignalEligibility(signal, activeCurrentPatch).canStore,
    );
    const retainsAutomaticPublicIssue =
      priorAutomaticOwner && priorAutomaticIsPublic && hasCheckins;
    const automaticIsPublic =
      automaticDecision.publicStatus === "public"
        ? true
        : priorAutomaticIsPublic && (hasLiveCandidates || retainsAutomaticPublicIssue)
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
        // auto_public records that the engine put the issue on the board. It stays
        // set through the live-candidate and check-in holds so the engine can still
        // demote the issue when the hold ends; clearing it would make the issue look
        // curated, and curated visibility is never withdrawn by the engine.
        auto_public: automaticDecision.publicStatus === "public" || (priorAutomaticOwner && automaticIsPublic),
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
): Promise<{ clusterId: string | null; promoted: boolean; reobserved: boolean; error: unknown | null }> {
  const clusterId = await resolveClusterId(supabase, signal, reports, clusterBySemantic, routableClusters);
  // resolveClusterId returns null for provider context with no existing
  // cluster to support (a steam review, an official page) and for a junk
  // title (a page name or a "no issue" placeholder). Store the signal
  // clusterless exactly as the batch path does — provider content never mints
  // a cluster, and failing the rescue would punish the operator for the
  // boundary holding.
  const touchedClusters = new Set<string>(clusterId ? [clusterId] : []);
  let persistence: SignalPersistence | null = null;
  let persistenceError: unknown = null;
  let promoted = false;

  try {
    persistence = await upsertSignal(supabase, withAdoptedCategory(signal, clusterId, routableClusters), clusterId, now, runId);
    if (persistence.previousClusterId && persistence.previousClusterId !== clusterId) {
      touchedClusters.add(persistence.previousClusterId);
    }
    persistenceError = persistence.observationError;
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

  if (!persistence) throw persistenceError ?? new Error("automation signal persistence returned no result");
  return { clusterId, promoted, reobserved: persistence.kind === "reobserved", error: persistenceError };
}

// Adds or takes one signal from a cluster's count in the routing list. A cluster
// created in this batch carries no count, and is left without one.
function countRoutedSignal(clusters: RoutableCluster[], clusterId: string | null, delta: number): void {
  if (!clusterId) return;
  const cluster = clusters.find((candidate) => candidate.id === clusterId) as
    | (RoutableCluster & { signal_count?: number | string | null })
    | undefined;
  if (!cluster || cluster.signal_count === null || cluster.signal_count === undefined) return;
  cluster.signal_count = Math.max(0, Number(cluster.signal_count) + delta);
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
      const persistence = await upsertSignal(supabase, withAdoptedCategory(signal, clusterId, routableClusters), clusterId, now, runId);
      if (signal.source === "steam_review" && signal.steam?.recommendationHash) {
        persistedSteamReviewHashes.add(signal.steam.recommendationHash);
      }
      if (persistence.kind === "reobserved") result.signalsReobserved += 1;
      else result.signalsInserted += 1;
      if (persistence.previousClusterId !== clusterId) {
        if (persistence.previousClusterId) touchedClusters.add(persistence.previousClusterId);
        // The routing list was read before this batch, and the stats refresh waits
        // for its end. Keep the list's counts current meanwhile, so a cluster this
        // move left empty is skipped like any emptied cluster, and a rewording
        // later in the batch does not undo the move (nearDuplicateAutoCluster).
        countRoutedSignal(routableClusters, persistence.previousClusterId, -1);
        countRoutedSignal(routableClusters, clusterId, 1);
      }
      if (persistence.observationError !== null) throw persistence.observationError;
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

const REPORT_BACKED_SWEEP_CHUNK = 100;

/**
 * Re-evaluate every issue whose automatic visibility disagrees with its approved
 * reports: an engine-published baseline (including one saved under an admin
 * override) whose reports all come from an earlier patch family, or a baseline
 * that is not engine-published although a report is on the current patch family
 * (an approval recorded while no current patch existed, for example). Visibility is otherwise recomputed only when a scan
 * touches the cluster, so such an issue would stay on the board until a new
 * signal happened to route into it. There is no per-scan cap or cursor: written
 * report intake is retired, so this set holds only clusters that already have
 * approved reports and cannot grow with scanner traffic. Refreshing all of them
 * means a held issue can never take the turn of a stale one, and skipped or
 * failed scans cannot leave part of the set unvisited.
 */
async function refreshReportBackedPublicClusters(
  supabase: ReturnType<typeof createServiceClient>,
  result: AutomationResult,
  now: Date,
  currentPatch: CurrentPatchContext,
): Promise<void> {
  const reports = await loadApprovedReports(supabase);
  const currentByCluster = new Map<string, boolean>();
  for (const report of reports) {
    if (!report.cluster_id) continue;
    const current = typeof report.patch_version === "string" && belongsToPatchFamily(report.patch_version, currentPatch.version);
    currentByCluster.set(report.cluster_id, (currentByCluster.get(report.cluster_id) ?? false) || current);
  }
  const reportClusterIds = [...currentByCluster.keys()].sort();
  for (let offset = 0; offset < reportClusterIds.length; offset += REPORT_BACKED_SWEEP_CHUNK) {
    const { data, error } = await supabase
      .from("issue_clusters")
      .select("id, admin_visibility_override, auto_public, is_public, visibility_restore_auto_public, visibility_restore_is_public")
      .in("id", reportClusterIds.slice(offset, offset + REPORT_BACKED_SWEEP_CHUNK));
    if (error) throw new Error(`report-backed cluster read failed: ${error.message}`);
    for (const row of (data ?? []) as ClusterRow[]) {
      // Judge the engine-owned baseline, as refreshClusterStats does: under an
      // override the effective flags are forced, and a stale public baseline
      // would be restored the moment the override returns to Auto.
      const baselinePublic = row.admin_visibility_override
        ? (row.visibility_restore_is_public ?? row.is_public ?? false)
        : (row.is_public ?? false);
      const baselineOwned = row.admin_visibility_override
        ? (row.visibility_restore_auto_public ?? row.auto_public ?? false)
        : (row.auto_public ?? false);
      const hasCurrentReport = currentByCluster.get(row.id) ?? false;
      if ((baselinePublic && baselineOwned) !== hasCurrentReport && await refreshClusterStats(supabase, row.id, now)) {
        result.clustersPromoted += 1;
      }
    }
  }
}

async function createRunLedger(
  supabase: ReturnType<typeof createServiceClient>,
  mode: AutomationMode,
  budget: AutomationBudget,
  now: Date,
  patchBurstActive = false,
  attemptId?: string,
): Promise<string> {
  try {
    const { data, error } = await supabase
      .from("automation_runs")
      .insert({
        ...(attemptId ? { id: attemptId } : {}),
        started_at: now.toISOString(),
        status: "running",
        mode,
        budget_monthly_usd: budget.monthlyBudgetUsd,
        budget_remaining_before_usd: budget.remainingMonthUsd,
        skips: patchBurstActive ? ["patch_burst_active"] : [],
        progress: initialRunProgress(budget),
      })
      .select("id")
      .single();
    if (error) throw error;
    const id = (data as { id?: string } | null)?.id;
    if (!id) throw new Error("run record did not return an identifier");
    return id;
  } catch (error) {
    throw new ScannerOperationError("run_create", error);
  }
}

function initialRunProgress(budget: AutomationBudget): RunProgress {
  return { stage: "starting", searchesDone: 0, searchTotal: budget.maxSearchQueries, candidatesSeen: 0,
    prefilterRejected: 0, llmCallsUsed: 0, kept: 0, promoted: 0,
    ...(budget.openRouterTrace ? { openRouterTrace: parseOpenRouterTraceJournal(budget.openRouterTrace) ?? undefined,
      aiCompletionUnverified: hasPendingOpenRouterInference(budget.openRouterTrace) } : {}),
    ...(budget.openRouterDiagnostics?.length ? { openRouterDiagnostics: appendOpenRouterDiagnostics(undefined, budget.openRouterDiagnostics) } : {}),
    ...(budget.checkpointDiagnostics?.length ? { diagnostics: budget.checkpointDiagnostics } : {}) };
}

/** The ledger exists before preflight. Checkpoint failures stay visible, without changing spending decisions. */
async function createBudgetedRun(supabase: ReturnType<typeof createServiceClient>, mode: AutomationMode,
  input: AutomationBudget, now: Date, patchBurstActive = false, attemptId?: string, aiRuntime: AiRuntime | null = null): Promise<{ runId: string; budget: AutomationBudget }> {
  const context = currentScannerExecution()!;
  const pending: AutomationBudget = { ...input, llmDeadlineAtMs: input.maxLlmCalls > 0 ? Math.min(Date.now() + 180_000, context.workDeadlineAtMs) : undefined };
  if (aiRuntime?.blockedReason) {
    pending.maxLlmCalls = 0;
    pending.skipReasons = [...pending.skipReasons, aiRuntime.blockedReason];
  }
  const admission = await admitScannerRun(supabase, { mode, budget: pending,
    progress: initialRunProgress(pending), patchBurst: patchBurstActive, attemptId, now });
  if (admission.status !== "admitted" && admission.status !== "unavailable") throw new ScannerAdmissionSkipped(admission.status);
  if (admission.status === "admitted") {
    pending.guardedRun = admission.run;
    pending.paidGuard = admission.run.guard;
  } else {
    // Only an exactly absent admission RPC permits this pre-migration path.
    pending.maxLlmCalls = 0;
    pending.allowPaidSearch = false;
    pending.maxSearchQueries = 0;
    pending.maxTavilyCreditsPerRun = 0;
    pending.skipReasons = [...pending.skipReasons, "accounting_unavailable"];
    await sweepStaleRuns(supabase, now);
    if (await hasActiveRun(supabase, now)) throw new ScannerAdmissionSkipped("already_running");
  }
  const runId = admission.status === "admitted" ? admission.run.id :
    await createRunLedger(supabase, mode, pending, now, patchBurstActive, attemptId);
  // Managed profiles use the same durable reservations as dashboard tests. The
  // legacy key gate deliberately keeps its prior one-dollar policy otherwise.
  const budget = aiRuntime ? pending : await enforceProviderBudget(pending, async (attempt) => {
    pending.openRouterTrace = upsertOpenRouterAttempt(pending.openRouterTrace, attempt);
  });
  attachAiRuntime(budget, aiRuntime);
  return { runId, budget };
}

async function recordAiRuntimeHealth(budget: AutomationBudget, result: AutomationResult): Promise<void> {
  try { await aiRuntimeForBudget(budget)?.record(result); }
  catch {
    if (!result.errors.includes("AI health event could not be saved.")) result.errors.push("AI health event could not be saved.");
    if (!result.skips.includes("ai_health_unavailable")) result.skips.push("ai_health_unavailable");
    if (result.status === "success") result.status = "partial";
  }
}

function surfaceAiRuntimeBlock(budget: AutomationBudget, result: AutomationResult): void {
  const reason = aiRuntimeForBudget(budget)?.blockedReason;
  if (!reason || reason === "openrouter_circuit_open") return;
  result.errors.push(reason === "ai_connection_changed" ? "AI connection changed; test and activate the model again." :
    "AI settings could not be loaded or validated; model requests are stopped.");
  if (result.status === "success") result.status = "partial";
}

class ScannerAdmissionSkipped extends Error {
  constructor(readonly reason: "already_running" | "paused" | "recent_run") { super(`Scanner admission: ${reason}`); }
}

async function finalizeRunLedger(
  supabase: ReturnType<typeof createServiceClient>,
  runId: string,
  result: AutomationResult,
  guardedRun?: GuardedRun,
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
  if (guardedRun) {
    const saved = await guardedFinalization(supabase, guardedRun, { ...legacyPatch, operator_rules_matched: result.operatorRulesMatched });
    if (saved.status !== "recorded") throw new Error("Scanner finalization was not acknowledged");
    result.persistence = "recorded";
    result.accountingState = saved.accountingState as AutomationResult["accountingState"];
    result.status = saved.runStatus as AutomationResult["status"];
    result.estimatedCostUsd = Number(saved.estimatedCostUsd);
    result.searchQueriesUsed = Number(saved.tavilyCredits);
    result.llmCallsUsed = Number(saved.llmCalls);
    result.llmCostUsd = Number(saved.llmCostUsd);
    result.llmCostState = saved.llmCostState as AutomationResult["llmCostState"];
    return;
  }
  const { error } = await supabase
    .from("automation_runs")
    .update({ ...legacyPatch, operator_rules_matched: result.operatorRulesMatched })
    .eq("id", runId).eq("status", "running").select("id").single();
  if (!error) { result.persistence = "recorded"; return; }
  if (!isMissingSupabaseColumn(error, "automation_runs", "operator_rules_matched")) {
    throw new Error(`automation run finalize failed: ${error.message}`);
  }
  const { error: legacyError } = await supabase.from("automation_runs").update(legacyPatch).eq("id", runId).eq("status", "running").select("id").single();
  if (legacyError) throw new Error(`automation run finalize failed: ${legacyError.message}`);
  result.persistence = "recorded";
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
  guardedRun?: GuardedRun,
): Promise<void> {
  if (guardedRun?.guard.blockedReason && !result.diagnostics?.some((item) => item.stage === "paid_accounting")) {
    recordScannerDiagnostic(result, "paid_accounting", new ScannerAccountingError(guardedRun.guard.blockedReason));
    if (!result.skips.includes(guardedRun.guard.blockedReason)) result.skips.push(guardedRun.guard.blockedReason);
  }
  try {
    await withScannerEssential(() => finalizeRunLedger(supabase, runId, result, guardedRun));
  } catch (error) {
    result.persistence = "unconfirmed";
    appendScannerDiagnostic(result, scannerDiagnostic("run_finalize", error));
    result.status = "failed";
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
  patchSyncDiagnostic: ScannerDiagnostic | null,
  patchBurstActive: boolean,
  now: Date,
): Promise<AutomationResult> {
  const result: AutomationResult = {
    ...(budget.openRouterTrace ? { openRouterTrace: parseOpenRouterTraceJournal(budget.openRouterTrace) ?? undefined } : {}),
    ...(budget.openRouterDiagnostics?.length
      ? { openRouterDiagnostics: appendOpenRouterDiagnostics(undefined, budget.openRouterDiagnostics) }
      : {}),
    ...(budget.modelPreset ? { modelPreset: budget.modelPreset } : {}),
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
  // Free Steam and Twitch captures start before any paid work and are awaited
  // only before finalization, so a paid-lane failure cannot cost a capture.
  const contextCapture = mode === "dry_run" ? undefined : captureContextSnapshots(supabase, result, now);
  surfaceAiRuntimeBlock(budget, result);
  for (const diagnostic of budget.checkpointDiagnostics ?? []) {
    appendScannerDiagnostic(result, diagnostic);
    result.status = "partial";
  }

  if (patchSyncDiagnostic) {
    appendScannerDiagnostic(result, patchSyncDiagnostic);
    result.status = "partial";
  }

  if (budgetReadError) {
    result.status = "failed";
    result.skips.push("budget_read_failed");
    appendScannerDiagnostic(result, scannerDiagnostic("budget_read", budgetReadError));
    await contextCapture;
    await finalizeRunLedgerSafely(supabase, runId, result, budget.guardedRun);
    return result;
  }
  if (!isCurrentPatchVerified(patchMetadata)) {
    result.status = "failed";
    result.skips.push("current_patch_unavailable");
    appendScannerDiagnostic(result, { stage: "patch_read", code: "current_patch_unavailable" });
    await contextCapture;
    await finalizeRunLedgerSafely(supabase, runId, result, budget.guardedRun);
    return result;
  }
  const validatedIds = new Set<string>();
  let lastProgressStage: RunProgress["stage"] | undefined;
  let lastProgressAt = 0;
  // Callers await reports; a local deadline can still leave remote completion unknown.
  // The running-status fence protects the final ledger from a late checkpoint.
  // Stage changes save immediately; counters within a stage coalesce for 10s.
  // No timer queues old snapshots: the final ledger always saves every counter.
  const report = async (stage: RunProgress["stage"], checkpoint?: OpenRouterAttempt) => {
    if (stage === lastProgressStage && Date.now() - lastProgressAt < PROGRESS_INTERVAL_MS) return;
    lastProgressStage = stage;
    try {
      await persistRunProgress(supabase, runId, {
        progress: snapshotProgress(stage, result, budget.maxSearchQueries),
        intent: result.intent,
      }, { timeoutMs: 4_000, guardedRun: budget.guardedRun });
    } catch (error) {
      recordScannerDiagnostic(result, "progress_write", error);
      const evidence = progressCheckpointEvidence(error);
      if (evidence) {
        const failures = result.progressWriteFailures ?? [];
        result.progressWriteFailures = failures.length >= 4 ? [failures[0], ...failures.slice(-2), { ...evidence, runStage: stage }]
          : [...failures, { ...evidence, runStage: stage }];
      }
      if (checkpoint) result.openRouterTrace = recordOpenRouterCheckpointFailure(result.openRouterTrace, checkpoint, progressCheckpointEvidence(error));
    } finally {
      // Failed writes also consume this interval; an outage cannot cause a storm.
      lastProgressAt = Date.now();
    }
  };
  const onAttempt: OpenRouterAttemptReporter = async (attempt) => {
    result.openRouterTrace = upsertOpenRouterAttempt(result.openRouterTrace, attempt);
    if (attempt.outcome === "success" && ["extraction", "claim_mapping"].includes(attempt.operation)) validatedIds.add(attempt.id);
    await report(lastProgressStage ?? "starting", attempt);
  };

  let rejected: RejectedCandidate[] = [];
  const currentPatch: CurrentPatchContext = patchMetadata;

  try {
    if (mode !== "dry_run") {
      try {
        await runLifecyclePass(supabase, result, budget, currentPatch, now, onAttempt);
      } catch (error) {
        if (error instanceof ScannerAccountingError) {
          stopPaidAccounting(result, budget, error);
        }
        result.status = result.status === "success" ? "partial" : result.status;
        if (error instanceof ScannerOperationError) recordScannerDiagnostic(result, "scan", error);
        else if (!(error instanceof ScannerAccountingError)) result.errors.push(toErrorMessage(error, "lifecycle pass failed"));
      }
    }

    const scanMemory = await loadScanMemory(supabase, currentPatch, now);
    result.intent = chooseScanIntent(scanMemory, searchRotationOffset(now));
    result.targetClusterTitles = scanMemory.targetClusterTitles;
    // Corroborate advances its title per TURN (offset / laneCount); computing the
    // lane count here — where scanMemory is in scope — keeps that rotation from
    // being aliased by the intent-lane offset (see buildMemorySearchQueries).
    const laneCount = eligibleLaneCount(scanMemory);

    if (mode !== "dry_run") {
      await quarantineStalePublicSignals(supabase, result, now, currentPatch);
      try {
        await refreshReportBackedPublicClusters(supabase, result, now, currentPatch);
      } catch (error) {
        result.status = result.status === "success" ? "partial" : result.status;
        result.errors.push(toErrorMessage(error, "report-backed visibility sweep failed"));
      }
    }

    const clusterRouting = await loadClusterRoutingState(supabase);
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
    const forumInputs = mode === "dry_run" ? [] : await collectSteamForumInputs(supabase, result, now, currentPatch);
    const combined = mergeForumWithSearch(forumInputs, webInputs);
    if (combined.unchangedForumThreads > 0) result.skips.push("steam_forum_unchanged");
    const inputs = [...(steamCollection?.inputs ?? []), ...combined.inputs];
    const storedSourceDates = await loadStoredSourceDates(supabase, currentPatch.version, inputs);
    const prepared = await prepareSignals(
      inputs,
      result,
      budget,
      currentPatch,
      clusterRouting.semanticOptionsFor,
      feedbackRules,
      storedSourceDates,
      now,
      () => report("screening"),
      onAttempt,
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
    }

    if (result.errors.length > 0 && result.status === "success") result.status = "partial";
  } catch (error) {
    result.status = "failed";
    if (error instanceof ScannerAccountingError) {
      recordScannerDiagnostic(result, "paid_accounting", error);
      result.skips.push(error.code);
    } else result.errors.push(toErrorMessage(error, "automation run crashed"));
  }

  if (mode !== "dry_run" && Date.now() < currentScannerExecution()!.workDeadlineAtMs - 20_000) {
    // Final bookkeeping must not strand an otherwise completed run as running.
    try {
      await persistRejectedCandidates(supabase, runId, rejected, result, now);
    } catch (error) {
      recordScannerDiagnostic(result, "scan", error);
    }
    try {
      await deleteExpiredRejectedCandidates(supabase, now, result);
    } catch (error) {
      recordScannerDiagnostic(result, "retention", error);
    }
  }
  await contextCapture;

  if (validatedIds.size) result.llmSucceeded = Math.max(result.llmSucceeded ?? 0, validatedIds.size);
  if (mode !== "dry_run") await recordAiRuntimeHealth(budget, result);
  await finalizeRunLedgerSafely(supabase, runId, result, budget.guardedRun);
  return result;
}

export type StartedScan =
  | { status: "started"; runId: string; completion: Promise<AutomationResult> }
  | { status: "already_running"; runId: null; skipReason?: "paused" | "recent_run" };

export function startAutomationScan(input: {
  mode: AutomationMode;
  now?: Date;
  scannerPolicy?: ScannerPolicy;
  attemptId?: string;
}): Promise<StartedScan> {
  return withScannerExecution(async () => {
    try { return await startAutomationScanInner(input); }
    catch (error) {
      if (error instanceof ScannerAdmissionSkipped) return { status: "already_running" as const, runId: null,
        ...(error.reason === "already_running" ? {} : { skipReason: error.reason }) };
      throw error;
    }
  });
}
async function startAutomationScanInner(input: { mode: AutomationMode; now?: Date; scannerPolicy?: ScannerPolicy; attemptId?: string }): Promise<StartedScan> {
  const now = input.now ?? new Date();
  const traceStage = (stage: ScannerStage) => {
    if (input.attemptId) console.info(JSON.stringify({ event: "scanner_stage_started", id: input.attemptId, stage }));
  };
  traceStage("database_check");
  const supabase = createServiceClient();

  let scannerPolicy: ScannerPolicy;
  traceStage("policy_read");
  try {
    scannerPolicy = applyAutomationBudgetCeiling(
      input.scannerPolicy ?? await getAutomationControlState(supabase as unknown as AutomationSettingsClient),
    );
  } catch (error) {
    throw new ScannerOperationError("policy_read", error);
  }
  let monthlyBudgetUsd = scannerPolicy.monthlyLlmUsdCap;
  let patchMetadata: CurrentPatchMetadata;
  traceStage("patch_read");
  try {
    patchMetadata = await getCurrentPatchMetadata(supabase);
  } catch (error) {
    throw new ScannerOperationError("patch_read", error);
  }
  let patchSyncDiagnostic: ScannerDiagnostic | null = null;
  let budgetReadError: string | null = null;
  let spentMonthToDateUsd = 0;
  let tavilyCreditsMonthToDate = 0;
  let llmSpentMonthToDateUsd = 0;
  let openRouterCircuitOpen = false;
  traceStage("budget_read");
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
  const patchBurstActive = input.mode === "scheduled" && resolveBurstState(patchMetadata, now);
  const aiRuntime = await loadAiRuntime(supabase, now, openRouterCircuitOpen);
  scannerPolicy = managedScannerPolicy(scannerPolicy, aiRuntime);
  monthlyBudgetUsd = scannerPolicy.monthlyLlmUsdCap;
  if (budgetReadError) {
    spentMonthToDateUsd = monthlyBudgetUsd;
    llmSpentMonthToDateUsd = monthlyBudgetUsd;
  }
  const computedBudget = computeAutomationBudget({
    monthlyBudgetUsd,
    spentMonthToDateUsd,
    tavilyCreditsMonthToDate,
    llmSpentMonthToDateUsd,
    mode: input.mode,
    patchBurstActive,
    now,
    scannerPolicy,
  });
  traceStage("run_create");
  const { budget, runId } = await createBudgetedRun(supabase, input.mode,
    { ...computedBudget, ...(aiRuntime ? {} : { modelPreset: scannerPolicy.modelPreset }), maxLlmCalls: openRouterCircuitOpen ? 0 : computedBudget.maxLlmCalls },
    now, patchBurstActive, input.attemptId, aiRuntime);
  traceStage("scan");
  const execute = async () => {
    if (!budgetReadError && input.mode !== "dry_run") {
      traceStage("patch_sync");
      try { patchMetadata = (await syncOfficialPatchNote(supabase, { now, fetcher: scannerSourceFetch() })).patch; }
      catch (error) { patchSyncDiagnostic = scannerDiagnostic("patch_sync", error); }
    }
    return executeAutomationRun(
    supabase,
    runId,
    input.mode,
    budget,
    budgetReadError,
    openRouterCircuitOpen,
    patchMetadata,
    patchSyncDiagnostic,
    patchBurstActive,
    now,
    );
  };
  const completion = budget.guardedRun ? withScannerRun({ id: runId, token: budget.guardedRun.token }, execute) : execute();
  return { status: "started", runId, completion };
}

/** Awaits the whole scan inline — used by the cron and tests. */
export async function runAutomationMonitor(input: {
  mode: AutomationMode;
  now?: Date;
  scannerPolicy?: ScannerPolicy;
  attemptId?: string;
}): Promise<AutomationResult> {
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
      skips: [started.skipReason ?? "scan_already_running"],
      errors: [],
    };
  }
  return started.completion;
}

/**
 * Zero-cost ledger trace: proves the cron fired and explains why it didn't scan.
 * `capture` adds the outcome codes and errors of free captures the wake made.
 */
export async function insertSkippedScheduledRun(
  supabase: ReturnType<typeof createServiceClient>,
  reason: "paused" | "recent_run" | "scan_already_running" | "budget_zero" | "budget_capped" | "tavily_credit_cap" | "llm_budget_capped",
  now: Date,
  capture?: { skips: string[]; errors: string[] },
): Promise<void> {
  try {
    const { error } = await supabase.from("automation_runs").insert({
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
      skips: [reason, ...(capture?.skips ?? [])],
      errors: capture?.errors ?? [],
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
    if (error) throw error;
  } catch (error) {
    throw new ScannerOperationError("skip_write", error);
  }
}

export function rescueCandidateSignal(
  supabase: ReturnType<typeof createServiceClient>,
  candidate: { title: string; url: string; sourceDomain: string | null; sourcePublishedAt?: string | null; snippet: string },
): Promise<void> {
  return withScannerExecution(() => rescueCandidateSignalInner(supabase, candidate));
}
async function rescueCandidateSignalInner(
  supabase: ReturnType<typeof createServiceClient>,
  candidate: Parameters<typeof rescueCandidateSignal>[1],
): Promise<void> {
  const currentPatch = await getCurrentPatchMetadata(supabase);
  if (!isCurrentPatchVerified(currentPatch)) {
    throw new Error("Current patch unavailable; candidate rescue was not started.");
  }
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

  let scannerPolicy = applyAutomationBudgetCeiling(
    await getAutomationControlState(supabase as unknown as AutomationSettingsClient),
  );
  let monthlyBudgetUsd = scannerPolicy.monthlyLlmUsdCap;
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
  const aiRuntime = await loadAiRuntime(supabase, now, openRouterCircuitOpen);
  scannerPolicy = managedScannerPolicy(scannerPolicy, aiRuntime);
  monthlyBudgetUsd = scannerPolicy.monthlyLlmUsdCap;
  if (budgetReadError) {
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
    scannerPolicy,
  });
  const { budget, runId } = await createBudgetedRun(supabase, "manual", {
    ...computedBudget,
    allowPaidSearch: false,
    maxSearchQueries: 0,
    maxSearchResults: 0,
    ...(aiRuntime ? {} : { modelPreset: scannerPolicy.modelPreset }),
    maxLlmCalls: openRouterCircuitOpen ? 0 : Math.min(MAX_RESCUE_LLM_CALLS, computedBudget.maxLlmCalls),
  }, now, false, undefined, aiRuntime);
  const execute = async () => {
  const result: AutomationResult = {
    ...(budget.openRouterTrace ? { openRouterTrace: parseOpenRouterTraceJournal(budget.openRouterTrace) ?? undefined } : {}),
    ...(budget.openRouterDiagnostics?.length
      ? { openRouterDiagnostics: appendOpenRouterDiagnostics(undefined, budget.openRouterDiagnostics) }
      : {}),
    ...(budget.modelPreset ? { modelPreset: budget.modelPreset } : {}),
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
  surfaceAiRuntimeBlock(budget, result);
  for (const diagnostic of budget.checkpointDiagnostics ?? []) {
    appendScannerDiagnostic(result, diagnostic);
    result.status = "partial";
  }
  const onAttempt: OpenRouterAttemptReporter = async (attempt) => {
    result.openRouterTrace = upsertOpenRouterAttempt(result.openRouterTrace, attempt);
    if (attempt.operation === "extraction" && attempt.outcome === "success") result.llmSucceeded = 1;
  };

  // Rescue deliberately skips preScreenCandidate and shouldKeepExtractedSignal —
  // an admin rescuing a candidate has already judged it relevant, so re-running
  // the automated relevance gates here would defeat the point of a rescue.
  try {
    if (!source.sourcePublishedAt) {
      const storedDates = await loadStoredSourceDates(supabase, currentPatch.version, [source]);
      source.sourcePublishedAt = resolveAssertedSourceDate({
        title: source.title, sourceText: source.body, canonicalUrl,
        storedDatesByCanonicalUrl: storedDates.byCanonicalUrl,
      }, currentPatch, now.getTime()).value;
    }
    const extraction = await extractSignalWithOpenRouter(
      { title: source.title, snippet: source.body, url: canonicalUrl },
      applyAiRuntimeOptions(budget, {
        onDiagnostic: (diagnostic) => recordOpenRouterDiagnostic(result, diagnostic),
        onAttempt,
        paidGuard: budget.paidGuard,
        modelPreset: budget.modelPreset,
        llmDeadlineAtMs: budget.llmDeadlineAtMs,
        llmCallsRemaining: budget.maxLlmCalls,
        llmBudgetRemainingUsd: budget.remainingLlmUsd,
        clusterOptions: clusterRouting.semanticOptionsFor(`${source.title} ${source.body}`),
      }),
    );
    result.llmCallsUsed = extraction.llmCallsUsed;
    result.llmSucceeded = extraction.extractionProvider === "openrouter" ? 1 : 0;
    result.llmCostUsd = extraction.llmCostUsd;
    result.estimatedCostUsd = extraction.llmCostUsd;
    if (extraction.fallbackReason && !result.skips.includes(extraction.fallbackReason)) {
      result.skips.push(extraction.fallbackReason);
    }
    recordOpenRouterRunSkip(result, extraction.fallbackReason);

    // English only (see englishStorage): a rescue may not store text in another
    // language either.
    const storage = englishStorage(source, source.body, extraction);
    if (!storage.store) {
      result.skips.push("language_needs_ai");
      throw new Error("This post is not in English and the AI could not put it into English, so nothing was stored. Try again when the AI is available.");
    }
    const externalHash = externalIdHash(source.source, source.id);
    const prepared: PreparedSignal = {
      ...source,
      ...(storage.storedTitle ? { storedTitle: storage.storedTitle } : {}),
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
    if (persistence.error !== null) throw persistence.error;
    // Provider context stored without a cluster is a success with a caveat the
    // operator should be able to read off the ledger, not infer from a zero.
    if (persistence.clusterId === null) {
      result.skips.push(isJunkClusterTitle(extraction.issueTitle) ? "junk_title_no_cluster" : "provider_context_no_cluster");
    }
    result.candidatesRescued = 1;
    if (result.errors.length > 0) result.status = "partial";
  } catch (error) {
    result.status = result.signalsInserted + result.signalsReobserved > 0 ? "partial" : "failed";
    if (error instanceof ScannerAccountingError) stopPaidAccounting(result, budget, error);
    else result.errors.push(toErrorMessage(error, "candidate rescue failed"));
    throw error;
  } finally {
    await recordAiRuntimeHealth(budget, result);
    await finalizeRunLedgerSafely(supabase, runId, result, budget.guardedRun);
    if (result.persistence !== "recorded") throw new ScannerOperationError("run_finalize", new Error("Rescue completion was not acknowledged"));
  }
  };
  return budget.guardedRun ? withScannerRun({ id: runId, token: budget.guardedRun.token }, execute) : execute();
}
