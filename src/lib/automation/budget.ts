export type BudgetInput = {
  monthlyBudgetUsd: number;
  spentMonthToDateUsd: number;
  tavilyCreditsMonthToDate?: number;
  llmSpentMonthToDateUsd?: number;
  mode?: "scheduled" | "manual" | "dry_run";
  now: Date;
  scannerPolicy?: {
    minIntervalMinutes?: number;
    scheduledSearchCreditsPerRun?: number;
    monthlyTavilyCreditCap?: number;
    monthlyLlmUsdCap?: number;
  };
};

export type AutomationBudget = {
  monthlyBudgetUsd: number;
  remainingMonthUsd: number;
  remainingRuns: number;
  estimatedRunAllowanceUsd: number;
  monthlyTavilyCreditCap: number;
  remainingTavilyCredits: number;
  monthlyLlmUsdCap: number;
  remainingLlmUsd: number;
  allowPaidSearch: boolean;
  maxSearchQueries: number;
  maxSearchResults: number;
  maxLlmCalls: number;
  skipReasons: string[];
};

const DEFAULT_MIN_INTERVAL_MINUTES = 60;
const DEFAULT_MONTHLY_TAVILY_CREDIT_CAP = 1000;
const MAX_MONTHLY_TAVILY_CREDIT_CAP = 1000;
export const MAX_MONTHLY_LLM_USD_CAP = 2;
const SEARCH_QUERY_COST_USD = 0.008;
const OPENROUTER_FREE_ROUTER_MODEL = "openrouter/free";
export const OPENROUTER_AUTOMATION_MODEL = "deepseek/deepseek-v4-flash";

export const OPENROUTER_FREE_PROVIDER_ROUTING = {
  require_parameters: true,
  data_collection: "deny",
  zdr: true,
  max_price: { prompt: 0, completion: 0, request: 0, image: 0 },
} as const;

export const OPENROUTER_AUTOMATION_PROVIDER_ROUTING = {
  require_parameters: true,
  data_collection: "deny",
  sort: "price",
  max_price: { prompt: 0.1, completion: 0.2, request: 0, image: 0 },
} as const;

function positiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function countRemainingRunsThisMonth(now: Date, intervalMinutes = DEFAULT_MIN_INTERVAL_MINUTES): number {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0);
  const remainingMs = Math.max(0, end - now.getTime());
  return Math.max(1, Math.ceil(remainingMs / (positiveNumber(intervalMinutes, DEFAULT_MIN_INTERVAL_MINUTES) * 60 * 1000)));
}

export function rejectPaidOpenRouterModel(model: string): string {
  if (model !== OPENROUTER_FREE_ROUTER_MODEL && !model.endsWith(":free")) {
    throw new Error("OpenRouter model must be openrouter/free or end with :free");
  }
  return model;
}

export function resolveAutomationOpenRouterModel(model: string | undefined): string {
  const resolved = model?.trim() || OPENROUTER_AUTOMATION_MODEL;
  if (resolved !== OPENROUTER_AUTOMATION_MODEL) {
    throw new Error(`Automation model must be ${OPENROUTER_AUTOMATION_MODEL}`);
  }
  return resolved;
}

export function maxOpenRouterRequestCostUsd(prompt: string, maxCompletionTokens: number): number {
  const inputTokenCeiling = new TextEncoder().encode(prompt).byteLength;
  return (
    inputTokenCeiling * OPENROUTER_AUTOMATION_PROVIDER_ROUTING.max_price.prompt +
    Math.max(0, maxCompletionTokens) * OPENROUTER_AUTOMATION_PROVIDER_ROUTING.max_price.completion
  ) / 1_000_000;
}

function nonnegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function readOpenRouterUsageCostUsd(data: unknown): number | null {
  const usage = data && typeof data === "object" ? (data as { usage?: unknown }).usage : null;
  if (!usage || typeof usage !== "object") return null;
  return (
    nonnegativeNumber((usage as { cost?: unknown }).cost) ??
    nonnegativeNumber((usage as { cost_usd?: unknown }).cost_usd) ??
    nonnegativeNumber((usage as { total_cost?: unknown }).total_cost)
  );
}

export type OpenRouterGenerationFetcher = (
  url: string,
  init: {
    method: "GET";
    headers: Record<string, string>;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

const OPENROUTER_GENERATION_URL = "https://openrouter.ai/api/v1/generation";
const OPENROUTER_GENERATION_TIMEOUT_MS = 2_000;

function readOpenRouterResponseId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const id = (data as { id?: unknown }).id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

function readOpenRouterGenerationCostUsd(data: unknown): number | null {
  const generation = data && typeof data === "object" ? (data as { data?: unknown }).data : null;
  if (!generation || typeof generation !== "object") return null;
  return (
    nonnegativeNumber((generation as { total_cost?: unknown }).total_cost) ??
    nonnegativeNumber((generation as { usage?: unknown }).usage)
  );
}

/**
 * Resolve a request's cost from the immediate response, then OpenRouter's
 * generation audit endpoint when the immediate usage block is incomplete.
 */
export async function resolveOpenRouterCostUsd(
  data: unknown,
  apiKey: string,
  fetcher: OpenRouterGenerationFetcher,
): Promise<number | null> {
  const immediateCost = readOpenRouterUsageCostUsd(data);
  if (immediateCost !== null) return immediateCost;

  const responseId = readOpenRouterResponseId(data);
  if (!responseId) return null;

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), OPENROUTER_GENERATION_TIMEOUT_MS) : null;
  try {
    const response = await fetcher(
      `${OPENROUTER_GENERATION_URL}?id=${encodeURIComponent(responseId)}`,
      {
        method: "GET",
        headers: { authorization: `Bearer ${apiKey}` },
        ...(controller ? { signal: controller.signal } : {}),
      },
    );
    if (!response.ok) return null;
    return readOpenRouterGenerationCostUsd(await response.json());
  } catch {
    return null;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function computeAutomationBudget(input: BudgetInput): AutomationBudget {
  const usesScannerPolicy = input.scannerPolicy !== undefined;
  const monthlyBudgetUsd = Math.max(0, input.monthlyBudgetUsd);
  const remainingMonthUsd = Math.max(0, monthlyBudgetUsd - Math.max(0, input.spentMonthToDateUsd));
  const monthlyTavilyCreditCap = Math.max(
    0,
    Math.min(
      Math.floor(input.scannerPolicy?.monthlyTavilyCreditCap ?? DEFAULT_MONTHLY_TAVILY_CREDIT_CAP),
      MAX_MONTHLY_TAVILY_CREDIT_CAP,
    ),
  );
  const remainingTavilyCredits = Math.max(0, monthlyTavilyCreditCap - Math.max(0, input.tavilyCreditsMonthToDate ?? 0));
  const requestedLlmUsdCap = input.scannerPolicy?.monthlyLlmUsdCap ?? monthlyBudgetUsd;
  const monthlyLlmUsdCap = Math.max(0, Math.min(requestedLlmUsdCap, MAX_MONTHLY_LLM_USD_CAP));
  const remainingLlmUsd = Math.max(0, monthlyLlmUsdCap - Math.max(0, input.llmSpentMonthToDateUsd ?? 0));
  const remainingRuns = countRemainingRunsThisMonth(input.now, input.scannerPolicy?.minIntervalMinutes);
  const estimatedRunAllowanceUsd = remainingMonthUsd / remainingRuns;
  const skipReasons: string[] = [];

  if (!usesScannerPolicy && monthlyBudgetUsd > 0 && remainingMonthUsd <= 0) skipReasons.push("budget_capped");
  if (monthlyTavilyCreditCap === 0 || remainingTavilyCredits <= 0) skipReasons.push("tavily_credit_cap");
  if (monthlyLlmUsdCap === 0 || remainingLlmUsd <= 0) skipReasons.push("llm_budget_capped");
  const canSpendSearch =
    !skipReasons.some((reason) => reason !== "llm_budget_capped") &&
    (usesScannerPolicy || input.mode === "scheduled" || monthlyBudgetUsd === 0 || remainingMonthUsd >= SEARCH_QUERY_COST_USD);
  const requestedQueries =
    input.mode === "scheduled"
      ? Math.max(0, Math.min(3, Math.floor(input.scannerPolicy?.scheduledSearchCreditsPerRun ?? 1)))
      : 5;
  const maxSearchQueries = canSpendSearch ? Math.max(0, Math.min(requestedQueries, remainingTavilyCredits)) : 0;
  const allowPaidSearch = maxSearchQueries > 0;

  return {
    monthlyBudgetUsd,
    remainingMonthUsd,
    remainingRuns,
    estimatedRunAllowanceUsd,
    monthlyTavilyCreditCap,
    remainingTavilyCredits,
    monthlyLlmUsdCap,
    remainingLlmUsd,
    allowPaidSearch,
    maxSearchQueries,
    maxSearchResults: maxSearchQueries * 5,
    maxLlmCalls: remainingLlmUsd > 0 ? (allowPaidSearch ? Math.min(20, maxSearchQueries * 4) : 4) : 0,
    skipReasons,
  };
}
