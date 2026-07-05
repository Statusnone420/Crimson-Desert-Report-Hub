import "server-only";

import { computeAutomationBudget, type AutomationBudget } from "@/lib/automation/budget";
import { canonicalizeUrl, hashValue, semanticFingerprint } from "@/lib/automation/dedupe";
import { extractSignalWithOpenRouter, type ExtractionResult } from "@/lib/automation/extract";
import { shouldPromoteSignalCluster } from "@/lib/automation/promote";
import { buildSearchQueries, tavilySearch, type SearchResult } from "@/lib/automation/search";
import type { Category, Platform } from "@/lib/constants";
import { externalIdHash } from "@/lib/crypto";
import { automationBudgetUsd, automationSubreddits, features } from "@/lib/env";
import { fetchNewPosts, getRedditToken } from "@/lib/reddit.server";
import { createServiceClient } from "@/lib/supabase";

export type AutomationMode = "scheduled" | "manual" | "dry_run";

export type AutomationResult = {
  status: "success" | "partial" | "failed" | "skipped";
  redditPostsSeen: number;
  searchQueriesUsed: number;
  searchResultsSeen: number;
  llmCallsUsed: number;
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

function independentSourceCount(rows: SourceSignalRow[]): number {
  return new Set(
    rows.map((row) => {
      const source = row.source_type ?? row.source ?? "unknown";
      return `${source}:${row.source_domain ?? source}`;
    }),
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
  const { data } = await supabase
    .from("automation_runs")
    .select("estimated_cost_usd")
    .gte("started_at", new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString());
  return ((data ?? []) as { estimated_cost_usd?: number | string | null }[]).reduce(
    (sum, row) => sum + Number(row.estimated_cost_usd ?? 0),
    0,
  );
}

async function collectInputs(result: AutomationResult, budget: AutomationBudget, now: Date): Promise<SourceInput[]> {
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
    for (const query of buildSearchQueries(budget.maxSearchQueries)) {
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
): Promise<PreparedSignal[]> {
  const prepared: PreparedSignal[] = [];
  const seenUrls = new Set<string>();
  const seenExternalIds = new Set<string>();
  const limit = Math.max(25, budget.maxSearchResults + 25);

  for (const signal of inputs.slice(0, limit)) {
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

    const extraction = await extractSignalWithOpenRouter(
      { title: signal.title, snippet: signal.body, url: canonicalUrl },
      { llmCallsRemaining: Math.max(0, budget.maxLlmCalls - result.llmCallsUsed) },
    );
    if (extraction.llmCallUsed) result.llmCallsUsed += 1;
    if (extraction.fallbackReason) result.skips.push(extraction.fallbackReason);

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
  const { data } = await supabase
    .from("bug_reports")
    .select("id, cluster_id, category, platform, issue_title")
    .eq("moderation_status", "approved");
  return (data ?? []) as ApprovedReportRow[];
}

async function loadApprovedExcerpts(supabase: ReturnType<typeof createServiceClient>): Promise<ApprovedExcerptRow[]> {
  const { data } = await supabase.from("approved_excerpts").select("id, report_id");
  return (data ?? []) as ApprovedExcerptRow[];
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
  const { data } = await supabase
    .from("source_signals")
    .select("cluster_id")
    .eq("semantic_fingerprint", semantic)
    .not("cluster_id", "is", null)
    .limit(1);
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
): Promise<string> {
  const cached = clusterBySemantic.get(signal.semantic);
  if (cached) return cached;

  const existingSignalCluster = await findExistingSignalCluster(supabase, signal.semantic);
  const reportCluster = existingSignalCluster ?? matchingReportCluster(signal, reports);
  const clusterId = reportCluster ?? (await createCluster(supabase, signal));
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
  const { data } = await supabase
    .from("issue_clusters")
    .select("id, category, admin_visibility_override, auto_public")
    .eq("id", clusterId)
    .limit(1);
  const row = ((data ?? []) as ClusterRow[])[0];
  if (!row) throw new Error(`automation cluster not found: ${clusterId}`);
  return row;
}

async function loadClusterSignals(
  supabase: ReturnType<typeof createServiceClient>,
  clusterId: string,
): Promise<SourceSignalRow[]> {
  const { data } = await supabase
    .from("source_signals")
    .select("id, source, source_type, source_domain, category, confidence, observed_at, extracted_facts")
    .eq("cluster_id", clusterId);
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
  const verifiedReportCount = excerpts.filter((excerpt) => reportIds.has(excerpt.report_id)).length;
  const directPlatforms = clusterReports.map((report) => report.platform);
  const signalPlatforms = signals.map(signalPlatform);

  const decision = shouldPromoteSignalCluster({
    independentSourceCount: independentSourceCount(signals),
    directReportCount: clusterReports.length,
    highestConfidence: highestConfidence(signals),
    hasClearCategory: isClearCategory(cluster.category),
    hasClearPlatform: [...directPlatforms, ...signalPlatforms].some(isClearPlatform),
    hasAdminForcePublic: cluster.admin_visibility_override === "force_public",
    hasAdminForceHidden: cluster.admin_visibility_override === "force_hidden",
  });

  await supabase
    .from("source_signals")
    .update({
      public_status: decision.publicStatus,
      promoted_at: decision.publicStatus === "public" ? now.toISOString() : null,
      promotion_reason: decision.reason,
    })
    .eq("cluster_id", clusterId);

  const publicSignalCount = decision.publicStatus === "public" ? signals.length : 0;
  await supabase
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

  return decision.publicStatus === "public" && !cluster.auto_public;
}

async function persistSignals(
  supabase: ReturnType<typeof createServiceClient>,
  signals: PreparedSignal[],
  result: AutomationResult,
  now: Date,
) {
  const reports = await loadApprovedReports(supabase);
  const excerpts = await loadApprovedExcerpts(supabase);
  const clusterBySemantic = new Map<string, string>();
  const touchedClusters = new Set<string>();

  for (const signal of signals) {
    const clusterId = await resolveClusterId(supabase, signal, reports, clusterBySemantic);
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
  });
  if (error) throw new Error(error.message);
}

export async function runAutomationMonitor(input: { mode: AutomationMode; now?: Date }): Promise<AutomationResult> {
  const now = input.now ?? new Date();
  const supabase = createServiceClient();
  const spentMonthToDateUsd = await loadMonthSpend(supabase, now);
  const budget = computeAutomationBudget({
    monthlyBudgetUsd: automationBudgetUsd(),
    spentMonthToDateUsd,
    now,
  });

  const result: AutomationResult = {
    status: "success",
    redditPostsSeen: 0,
    searchQueriesUsed: 0,
    searchResultsSeen: 0,
    llmCallsUsed: 0,
    signalsInserted: 0,
    signalsDeduped: 0,
    clustersPromoted: 0,
    estimatedCostUsd: 0,
    skips: [...budget.skipReasons],
    errors: [],
  };

  const inputs = await collectInputs(result, budget, now);
  const prepared = await prepareSignals(inputs, result, budget);

  if (input.mode !== "dry_run") {
    try {
      await persistSignals(supabase, prepared, result, now);
    } catch (error) {
      result.status = "failed";
      result.errors.push(toErrorMessage(error, "automation persistence failed"));
    }
  }

  if (result.errors.length > 0 && result.status === "success") result.status = "partial";
  await insertRunLedger(supabase, input.mode, budget, result, now);
  return result;
}
