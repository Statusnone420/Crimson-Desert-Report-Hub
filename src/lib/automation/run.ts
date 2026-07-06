import "server-only";

import { computeAutomationBudget, type AutomationBudget } from "@/lib/automation/budget";
import { canonicalizeUrl, hashValue, semanticFingerprint } from "@/lib/automation/dedupe";
import { extractSignalWithOpenRouter, type ClusterOption, type ExtractionResult } from "@/lib/automation/extract";
import { shouldPromoteSignalCluster } from "@/lib/automation/promote";
import { preScreenCandidate, shouldKeepExtractedSignal } from "@/lib/automation/relevance";
import { routeToWatchlistCluster, type RoutableCluster } from "@/lib/automation/route";
import { buildSearchQueries, tavilySearch, type SearchResult } from "@/lib/automation/search";
import type { Category, Platform } from "@/lib/constants";
import { externalIdHash } from "@/lib/crypto";
import { automationBudgetUsd, automationSubreddits, features } from "@/lib/env";
import { getCurrentPatchMetadata, syncOfficialPatchNote } from "@/lib/officialPatch.server";
import { fetchNewPosts, getRedditToken } from "@/lib/reddit.server";
import { createServiceClient } from "@/lib/supabase";

export type AutomationMode = "scheduled" | "manual" | "dry_run";

export type AutomationResult = {
  status: "success" | "partial" | "failed" | "skipped";
  redditPostsSeen: number;
  searchQueriesUsed: number;
  searchResultsSeen: number;
  llmCallsUsed: number;
  candidatesSeen: number;
  prefilterRejected: number;
  signalsInserted: number;
  signalsDeduped: number;
  clustersPromoted: number;
  estimatedCostUsd: number;
  skips: string[];
  errors: string[];
};

type SourceInput = {
  source: "reddit" | "web_search";
  id: string;
  title: string;
  body: string;
  url: string;
  observedAt: string;
  sourceDomain: string | null;
};

type PreparedSignal = SourceInput & {
  canonicalUrl: string;
  externalHash: string;
  semantic: string;
  extraction: ExtractionResult;
};

type ClusterRow = {
  id: string;
  category: Category;
  admin_visibility_override?: "force_public" | "force_hidden" | null;
  auto_public?: boolean | null;
};

type SourceSignalRow = {
  id?: string;
  canonical_url?: string | null;
  source?: string;
  source_type?: string | null;
  source_domain?: string | null;
  category?: Category | string | null;
  confidence?: "low" | "medium" | "high" | null;
  observed_at?: string | null;
  extracted_facts?: { platform?: Platform | null } | null;
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
const CONFIDENCE_RANK = { low: 0, medium: 1, high: 2 } as const;

function searchResultToInput(result: SearchResult): SourceInput {
  return {
    source: "web_search",
    id: result.url,
    title: result.title,
    body: result.snippet,
    url: result.url,
    observedAt: result.observedAt,
    sourceDomain: result.sourceDomain,
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

function highestConfidence(rows: SourceSignalRow[]): "low" | "medium" | "high" {
  return rows.reduce<"low" | "medium" | "high">((highest, row) => {
    const confidence = row.confidence ?? "low";
    return CONFIDENCE_RANK[confidence] > CONFIDENCE_RANK[highest] ? confidence : highest;
  }, "low");
}

function isClearCategory(category: string | null | undefined): boolean {
  return Boolean(category && category !== "other");
}

function isClearPlatform(platform: string | null | undefined): boolean {
  return Boolean(platform && platform !== "other");
}

function signalPlatform(row: SourceSignalRow): Platform | null {
  return row.extracted_facts?.platform ?? null;
}

function isObservedWithinWindow(row: SourceSignalRow, now: Date, windowMs: number): boolean {
  if (!row.observed_at) return false;
  const observedAt = new Date(row.observed_at).getTime();
  if (!Number.isFinite(observedAt)) return false;
  return observedAt >= now.getTime() - windowMs && observedAt <= now.getTime();
}

function independentSourceCount(rows: SourceSignalRow[], now: Date): number {
  const recentWindowMs = 14 * 24 * 60 * 60 * 1000;
  return new Set(
    rows
      .filter((row) => isObservedWithinWindow(row, now, recentWindowMs))
      .map((row) => row.canonical_url)
      .filter((url): url is string => Boolean(url)),
  ).size;
}

function lastObservedAt(rows: SourceSignalRow[]): string | null {
  return rows
    .map((row) => row.observed_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
}

async function loadMonthSpend(
  supabase: ReturnType<typeof createServiceClient>,
  now: Date,
): Promise<number> {
  const { data, error } = await supabase
    .from("automation_runs")
    .select("estimated_cost_usd")
    .gte("started_at", new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString());
  if (error) throw new Error(`automation spend read failed: ${error.message}`);
  return ((data ?? []) as { estimated_cost_usd?: number | string | null }[]).reduce(
    (sum, row) => sum + Number(row.estimated_cost_usd ?? 0),
    0,
  );
}

async function collectInputs(
  result: AutomationResult,
  budget: AutomationBudget,
  now: Date,
  patchVersion: string,
): Promise<SourceInput[]> {
  const inputs: SourceInput[] = [];
  const f = features();

  if (f.reddit) {
    try {
      const token = await getRedditToken();
      for (const subreddit of automationSubreddits()) {
        const posts = await fetchNewPosts(subreddit, token, 25);
        result.redditPostsSeen += posts.length;
        for (const post of posts) {
          inputs.push({
            source: "reddit",
            id: post.id,
            title: post.title,
            body: post.selftext ?? "",
            url: `https://www.reddit.com${post.permalink}`,
            observedAt: new Date(post.created_utc * 1000).toISOString(),
            sourceDomain: "reddit.com",
          });
        }
      }
    } catch (error) {
      result.status = "partial";
      result.errors.push(toErrorMessage(error, "reddit failed"));
    }
  } else {
    result.skips.push("reddit_disabled");
  }

  if (f.webSearch && budget.allowPaidSearch) {
    for (const query of buildSearchQueries(budget.maxSearchQueries, patchVersion)) {
      try {
        result.searchQueriesUsed += 1;
        result.estimatedCostUsd += SEARCH_QUERY_COST_USD;
        const found = await tavilySearch(query, { now });
        result.searchResultsSeen += found.length;
        inputs.push(...found.slice(0, 5).map(searchResultToInput));
      } catch (error) {
        result.status = "partial";
        result.errors.push(toErrorMessage(error, "search failed"));
      }
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
  patchVersion: string,
  clusterOptions: ClusterOption[],
): Promise<PreparedSignal[]> {
  const prepared: PreparedSignal[] = [];
  const seenUrls = new Set<string>();
  const seenExternalIds = new Set<string>();
  const limit = Math.max(25, budget.maxSearchResults + 25);
  const candidates = inputs.slice(0, limit);
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

    const externalHash = externalIdHash(signal.source, signal.id);
    if (seenUrls.has(canonicalUrl) || seenExternalIds.has(externalHash)) {
      result.signalsDeduped += 1;
      continue;
    }
    seenUrls.add(canonicalUrl);
    seenExternalIds.add(externalHash);

    // Cheap gate on raw source text, runs BEFORE any LLM call. Trade-off: a source
    // whose raw title+snippet has no symptom language is rejected without giving the
    // LLM a chance to rescue it. That rescue path was the waste this prefilter removes.
    const preScreen = preScreenCandidate(
      { title: signal.title, snippet: signal.body, sourceDomain: signal.sourceDomain },
      { currentPatchVersion: patchVersion },
    );
    if (!preScreen.keep) {
      result.skips.push(preScreen.reason);
      result.prefilterRejected += 1;
      continue;
    }

    const extraction = await extractSignalWithOpenRouter(
      { title: signal.title, snippet: signal.body, url: canonicalUrl },
      { llmCallsRemaining: Math.max(0, budget.maxLlmCalls - result.llmCallsUsed), clusterOptions },
    );
    if (extraction.llmCallUsed) result.llmCallsUsed += 1;
    if (extraction.fallbackReason) result.skips.push(extraction.fallbackReason);

    const relevance = shouldKeepExtractedSignal(extraction);
    if (!relevance.keep) {
      result.skips.push(relevance.reason);
      continue;
    }

    prepared.push({
      ...signal,
      canonicalUrl,
      externalHash,
      semantic: semanticFingerprint(extraction.issueTitle, extraction.category),
      extraction,
    });
    result.signalsInserted += 1;
  }

  return prepared;
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

type RoutableClusterRow = { id: string; slug: string; title: string; category: string };

async function loadRoutableClusters(supabase: ReturnType<typeof createServiceClient>): Promise<RoutableClusterRow[]> {
  const { data, error } = await supabase
    .from("issue_clusters")
    .select("id, slug, title, category")
    .not("slug", "like", "auto-%");
  if (error) throw new Error(`routable clusters read failed: ${error.message}`);
  return (data ?? []) as RoutableClusterRow[];
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
    .select("cluster_id")
    .eq("semantic_fingerprint", semantic)
    .not("cluster_id", "is", null)
    .limit(1);
  if (error) throw new Error(`existing signal cluster read failed: ${error.message}`);
  const rows = (data ?? []) as { cluster_id?: string | null }[];
  return rows[0]?.cluster_id ?? null;
}

async function createCluster(supabase: ReturnType<typeof createServiceClient>, signal: PreparedSignal): Promise<string> {
  const { data, error } = await supabase
    .from("issue_clusters")
    .insert({
      slug: clusterSlug(signal.semantic),
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
  if (error) throw new Error(error.message);
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
): Promise<string> {
  const cached = clusterBySemantic.get(signal.semantic);
  if (cached) return cached;

  const existingSignalCluster = await findExistingSignalCluster(supabase, signal.semantic);
  const routedCluster = routeToWatchlistCluster(
    {
      issueTitle: signal.extraction.issueTitle,
      summary: signal.extraction.summary,
      category: signal.extraction.category,
      llmClusterSlug: signal.extraction.clusterSlug,
    },
    routableClusters,
  );
  const clusterId =
    existingSignalCluster ?? routedCluster?.id ?? matchingReportCluster(signal, reports) ?? (await createCluster(supabase, signal));
  clusterBySemantic.set(signal.semantic, clusterId);
  return clusterId;
}

async function upsertSignal(
  supabase: ReturnType<typeof createServiceClient>,
  signal: PreparedSignal,
  clusterId: string,
  now: Date,
) {
  const rawExpiresAt = signal.body ? new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString() : null;
  const { error } = await supabase.from("source_signals").upsert(
    {
      source: signal.source,
      source_type: signal.source,
      source_url: signal.canonicalUrl,
      canonical_url: signal.canonicalUrl,
      external_id_hash: signal.externalHash,
      title: signal.title.slice(0, 240),
      source_domain: signal.sourceDomain,
      semantic_fingerprint: signal.semantic,
      cluster_id: clusterId,
      summary: signal.extraction.summary,
      extracted_facts: {
        issueTitle: signal.extraction.issueTitle,
        platform: signal.extraction.platform,
      },
      category: signal.extraction.category,
      confidence: signal.extraction.confidence,
      observed_at: signal.observedAt,
      raw_text: signal.body.slice(0, 8000) || null,
      raw_expires_at: rawExpiresAt,
      public_status: "private",
      extraction_provider: signal.extraction.extractionProvider,
      extraction_model: signal.extraction.extractionModel,
      cost_estimate_usd: 0,
    },
    { onConflict: "external_id_hash" },
  );
  if (error) throw new Error(error.message);
}

async function loadCluster(supabase: ReturnType<typeof createServiceClient>, clusterId: string): Promise<ClusterRow> {
  const { data, error } = await supabase
    .from("issue_clusters")
    .select("id, category, admin_visibility_override, auto_public")
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
    .select("id, canonical_url, source, source_type, source_domain, category, confidence, observed_at, extracted_facts")
    .eq("cluster_id", clusterId);
  if (error) throw new Error(`cluster signals read failed: ${error.message}`);
  return (data ?? []) as SourceSignalRow[];
}

async function refreshClusterStats(
  supabase: ReturnType<typeof createServiceClient>,
  clusterId: string,
  reports: ApprovedReportRow[],
  excerpts: ApprovedExcerptRow[],
  now: Date,
): Promise<boolean> {
  const [cluster, signals] = await Promise.all([loadCluster(supabase, clusterId), loadClusterSignals(supabase, clusterId)]);
  const clusterReports = reports.filter((report) => report.cluster_id === clusterId);
  const reportIds = new Set(clusterReports.map((report) => report.id));
  const verifiedReportCount = new Set(
    excerpts.filter((excerpt) => reportIds.has(excerpt.report_id)).map((excerpt) => excerpt.report_id),
  ).size;
  const directPlatforms = clusterReports.map((report) => report.platform);
  const signalPlatforms = signals.map(signalPlatform);

  const decision = shouldPromoteSignalCluster({
    independentSourceCount: independentSourceCount(signals, now),
    directReportCount: clusterReports.length,
    highestConfidence: highestConfidence(signals),
    hasClearCategory: isClearCategory(cluster.category),
    hasClearPlatform: [...directPlatforms, ...signalPlatforms].some(isClearPlatform),
    hasAdminForcePublic: cluster.admin_visibility_override === "force_public",
    hasAdminForceHidden: cluster.admin_visibility_override === "force_hidden",
  });

  const { error: signalUpdateError } = await supabase
    .from("source_signals")
    .update({
      public_status: decision.publicStatus,
      promoted_at: decision.publicStatus === "public" ? now.toISOString() : null,
      promotion_reason: decision.reason,
    })
    .eq("cluster_id", clusterId);
  if (signalUpdateError) throw new Error(`source signal promotion update failed: ${signalUpdateError.message}`);

  const publicSignalCount = decision.publicStatus === "public" ? signals.length : 0;
  const { error: clusterUpdateError } = await supabase
    .from("issue_clusters")
    .update({
      signal_count: signals.length,
      direct_report_count: clusterReports.length,
      verified_report_count: verifiedReportCount,
      public_signal_count: publicSignalCount,
      last_signal_at: lastObservedAt(signals),
      auto_public: decision.publicStatus === "public",
      is_public: decision.publicStatus === "public",
    })
    .eq("id", clusterId);
  if (clusterUpdateError) throw new Error(`issue cluster promotion update failed: ${clusterUpdateError.message}`);

  return decision.publicStatus === "public" && !cluster.auto_public;
}

async function persistSignals(
  supabase: ReturnType<typeof createServiceClient>,
  signals: PreparedSignal[],
  result: AutomationResult,
  now: Date,
  routableClusters: RoutableCluster[],
) {
  const reports = await loadApprovedReports(supabase);
  const excerpts = await loadApprovedExcerpts(supabase);
  const clusterBySemantic = new Map<string, string>();
  const touchedClusters = new Set<string>();

  for (const signal of signals) {
    const clusterId = await resolveClusterId(supabase, signal, reports, clusterBySemantic, routableClusters);
    await upsertSignal(supabase, signal, clusterId, now);
    touchedClusters.add(clusterId);
  }

  for (const clusterId of touchedClusters) {
    if (await refreshClusterStats(supabase, clusterId, reports, excerpts, now)) {
      result.clustersPromoted += 1;
    }
  }
}

async function insertRunLedger(
  supabase: ReturnType<typeof createServiceClient>,
  mode: AutomationMode,
  budget: AutomationBudget,
  result: AutomationResult,
  now: Date,
) {
  const { error } = await supabase.from("automation_runs").insert({
    started_at: now.toISOString(),
    finished_at: new Date().toISOString(),
    status: result.errors.length > 0 && result.status === "success" ? "partial" : result.status,
    mode,
    budget_monthly_usd: budget.monthlyBudgetUsd,
    budget_remaining_before_usd: budget.remainingMonthUsd,
    estimated_cost_usd: result.estimatedCostUsd,
    reddit_posts_seen: result.redditPostsSeen,
    search_queries_used: result.searchQueriesUsed,
    search_results_seen: result.searchResultsSeen,
    llm_calls_used: result.llmCallsUsed,
    signals_inserted: result.signalsInserted,
    signals_deduped: result.signalsDeduped,
    clusters_promoted: result.clustersPromoted,
    skips: result.skips,
    errors: result.errors,
    funnel: {
      candidatesSeen: result.candidatesSeen,
      deduped: result.signalsDeduped,
      prefilterRejected: result.prefilterRejected,
      llmCalls: result.llmCallsUsed,
      kept: result.signalsInserted,
      promoted: result.clustersPromoted,
    },
  });
  if (error) throw new Error(error.message);
}

export async function runAutomationMonitor(input: { mode: AutomationMode; now?: Date }): Promise<AutomationResult> {
  const now = input.now ?? new Date();
  const supabase = createServiceClient();
  const monthlyBudgetUsd = automationBudgetUsd();
  let budgetReadError: string | null = null;
  let spentMonthToDateUsd = 0;
  try {
    spentMonthToDateUsd = await loadMonthSpend(supabase, now);
  } catch (error) {
    budgetReadError = toErrorMessage(error, "automation spend read failed");
    spentMonthToDateUsd = monthlyBudgetUsd;
  }
  const budget = computeAutomationBudget({
    monthlyBudgetUsd,
    spentMonthToDateUsd,
    now,
  });

  const result: AutomationResult = {
    status: "success",
    redditPostsSeen: 0,
    searchQueriesUsed: 0,
    searchResultsSeen: 0,
    llmCallsUsed: 0,
    candidatesSeen: 0,
    prefilterRejected: 0,
    signalsInserted: 0,
    signalsDeduped: 0,
    clustersPromoted: 0,
    estimatedCostUsd: 0,
    skips: [...budget.skipReasons],
    errors: [],
  };

  if (budgetReadError) {
    result.status = "skipped";
    result.skips.push("budget_read_failed");
    result.errors.push(budgetReadError);
    await insertRunLedger(supabase, input.mode, budget, result, now);
    return result;
  }

  let currentPatch = await getCurrentPatchMetadata(supabase);
  if (input.mode !== "dry_run") {
    try {
      currentPatch = (await syncOfficialPatchNote(supabase, { now })).patch;
    } catch (error) {
      result.status = "partial";
      result.errors.push(toErrorMessage(error, "official patch sync failed"));
    }
  }

  const routableClusters = await loadRoutableClusters(supabase);
  const clusterOptions: ClusterOption[] = routableClusters.map((cluster) => ({ slug: cluster.slug, title: cluster.title }));

  const inputs = await collectInputs(result, budget, now, currentPatch.version);
  const prepared = await prepareSignals(inputs, result, budget, currentPatch.version, clusterOptions);

  if (input.mode !== "dry_run") {
    try {
      await persistSignals(supabase, prepared, result, now, routableClusters);
    } catch (error) {
      result.status = "failed";
      result.errors.push(toErrorMessage(error, "automation persistence failed"));
    }
  }

  if (result.errors.length > 0 && result.status === "success") result.status = "partial";
  await insertRunLedger(supabase, input.mode, budget, result, now);
  return result;
}
