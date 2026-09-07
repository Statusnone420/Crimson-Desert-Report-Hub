export type BudgetInput = {
  monthlyBudgetUsd: number;
  spentMonthToDateUsd: number;
  tavilyCreditsMonthToDate?: number;
  llmSpentMonthToDateUsd?: number;
  mode?: "scheduled" | "manual" | "dry_run";
  patchBurstActive?: boolean;
  now: Date;
  scannerPolicy?: {
    minIntervalMinutes?: number;
    scheduledSearchCreditsPerRun?: number;
    monthlyTavilyCreditCap?: number;
    monthlyLlmUsdCap?: number;
  };
};

export type AutomationBudget = {
  modelPreset?: ScannerModelPreset;
  llmDeadlineAtMs?: number;
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
  /** Total Tavily credits available to this run, including search and extract. */
  maxTavilyCreditsPerRun: number;
  maxSearchResults: number;
  maxLlmCalls: number;
  skipReasons: string[];
};

const DEFAULT_MIN_INTERVAL_MINUTES = 60;
const DEFAULT_MONTHLY_TAVILY_CREDIT_CAP = 1000;
const MAX_MONTHLY_TAVILY_CREDIT_CAP = 1000;
export const MAX_MONTHLY_LLM_USD_CAP = 1;
export const DEFAULT_MONTHLY_LLM_USD_CAP = 0.5;
const SEARCH_QUERY_COST_USD = 0.008;
const SCHEDULED_RECON_CREDIT_RESERVE = 1;
const OPENROUTER_FREE_ROUTER_MODEL = "openrouter/free";
export const OPENROUTER_AUTOMATION_MODEL = "openai/gpt-5.6-luna";
export const OPENROUTER_DEEPSEEK_ROLLBACK_MODEL = "deepseek/deepseek-v4-flash";

export const SCANNER_MODEL_PRESETS = [
  { id: "gpt_5_6_luna", label: "GPT-5.6 Luna · Standard", model: OPENROUTER_AUTOMATION_MODEL },
  { id: "gpt_5_6_luna_flex", label: "GPT-5.6 Luna · Flex", model: OPENROUTER_AUTOMATION_MODEL, serviceTier: "flex" },
  { id: "deepseek_v4_flash_rollback", label: "DeepSeek V4 Flash · Manual rollback", model: OPENROUTER_DEEPSEEK_ROLLBACK_MODEL },
] as const;

export type ScannerModelPreset = (typeof SCANNER_MODEL_PRESETS)[number]["id"];

export function normalizeScannerModelPreset(value: unknown): ScannerModelPreset {
  // Preserve the prior migration: legacy DeepSeek settings select standard Luna.
  if (value === "deepseek_v4_flash") return "gpt_5_6_luna";
  return SCANNER_MODEL_PRESETS.find(({ id }) => id === value)?.id ?? "gpt_5_6_luna";
}

function scannerModelPreset(preset: ScannerModelPreset) {
  const selected = SCANNER_MODEL_PRESETS.find(({ id }) => id === preset);
  if (!selected) throw new Error("Unknown scanner model preset");
  return selected;
}

export type AutomationTask = "extraction" | "claim_mapping";

type ProviderRouting = {
  require_parameters: true;
  data_collection: "allow" | "deny";
  zdr?: true;
  only?: readonly ["OpenAI"];
  allow_fallbacks?: false;
  sort?: "price";
  max_price: { prompt: number; completion: number; request: 0; image: 0 };
};

type AutomationModelSettings = {
  provider: ProviderRouting;
  /** Luna can use gateway reasoning; the manual rollback keeps its prior route. */
  reasoning: { effort: "high"; exclude: true } | { effort: "none" };
  /** OpenRouter provider catalogs currently advertise this output-limit key. */
  outputTokenParameter: "max_tokens" | "max_completion_tokens";
  /** Sampling is model-specific; high-reasoning Luna does not accept temperature. */
  temperature?: 0;
  serviceTier?: "flex";
};

/**
 * These are total completion ceilings: OpenRouter bills reasoning tokens as
 * output tokens, so the Luna reserve deliberately includes both hidden reasoning
 * and the strict JSON object instead of budgeting only for visible JSON.
 */
export const AUTOMATION_TASK_SETTINGS: Record<AutomationTask, { maxCompletionTokens: number }> = {
  extraction: { maxCompletionTokens: 3_200 },
  claim_mapping: { maxCompletionTokens: 2_048 },
};

/**
 * The models I have approved for the paid automation lane, default first. Every
 * entry must clear its own provider and data-collection policy, support structured
 * outputs, and stay under its price ceiling — or OpenRouter refuses to route it.
 *
 * This stays an allowlist rather than free text: an unrecognised value falls back
 * to deterministic extraction instead of spending on an unvetted model.
 */
export const APPROVED_AUTOMATION_MODELS = [OPENROUTER_AUTOMATION_MODEL, OPENROUTER_DEEPSEEK_ROLLBACK_MODEL] as const;

export const OPENROUTER_FREE_PROVIDER_ROUTING = {
  require_parameters: true,
  data_collection: "deny",
  zdr: true,
  max_price: { prompt: 0, completion: 0, request: 0, image: 0 },
} as const;

const OPENROUTER_LUNA_PROVIDER_ROUTING = {
  require_parameters: true,
  // First-party OpenAI may retain requests for abuse monitoring. The owner has
  // approved that policy; provider pinning keeps this from broadening the host.
  data_collection: "allow",
  // First-party OpenAI only. `allow_fallbacks: false` means a routing miss
  // fails closed rather than silently sending scanner text to another host.
  only: ["OpenAI"],
  allow_fallbacks: false,
  max_price: { prompt: 0.2, completion: 1.2, request: 0, image: 0 },
} as const;

const OPENROUTER_LUNA_FLEX_PROVIDER_ROUTING = {
  ...OPENROUTER_LUNA_PROVIDER_ROUTING,
  max_price: { prompt: 0.1, completion: 0.6, request: 0, image: 0 },
} as const;

/** The explicit manual rollback retains the previous ZDR routing posture. */
export const OPENROUTER_DEEPSEEK_ROLLBACK_PROVIDER_ROUTING = {
  require_parameters: true,
  data_collection: "deny",
  zdr: true,
  sort: "price",
  max_price: { prompt: 0.2, completion: 0.5, request: 0, image: 0 },
} as const;

const AUTOMATION_MODEL_SETTINGS: Record<(typeof APPROVED_AUTOMATION_MODELS)[number], AutomationModelSettings> = {
  [OPENROUTER_AUTOMATION_MODEL]: {
    provider: OPENROUTER_LUNA_PROVIDER_ROUTING,
    reasoning: { effort: "high", exclude: true },
    outputTokenParameter: "max_tokens",
  },
  [OPENROUTER_DEEPSEEK_ROLLBACK_MODEL]: {
    provider: OPENROUTER_DEEPSEEK_ROLLBACK_PROVIDER_ROUTING,
    reasoning: { effort: "none" },
    outputTokenParameter: "max_tokens",
    temperature: 0,
  },
};

/** Default-only alias retained for callers that need the active Luna route. */
export const OPENROUTER_AUTOMATION_PROVIDER_ROUTING = OPENROUTER_LUNA_PROVIDER_ROUTING;

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

export function resolveAutomationOpenRouterModel(model: string | undefined, modelPreset?: ScannerModelPreset): string {
  if (modelPreset !== undefined) return scannerModelPreset(modelPreset).model;
  const resolved = model?.trim() || OPENROUTER_AUTOMATION_MODEL;
  if (!(APPROVED_AUTOMATION_MODELS as readonly string[]).includes(resolved)) {
    throw new Error(`Automation model must be one of: ${APPROVED_AUTOMATION_MODELS.join(", ")}`);
  }
  return resolved;
}

export function automationModelSettings(model: string, modelPreset?: ScannerModelPreset): AutomationModelSettings {
  if (modelPreset !== undefined && scannerModelPreset(modelPreset).model !== model) {
    throw new Error("Scanner model preset and model do not match");
  }
  const settings = (AUTOMATION_MODEL_SETTINGS as Record<string, AutomationModelSettings | undefined>)[model];
  if (!settings) throw new Error(`Automation model must be one of: ${APPROVED_AUTOMATION_MODELS.join(", ")}`);
  if (modelPreset === "gpt_5_6_luna_flex") {
    return { ...settings, provider: OPENROUTER_LUNA_FLEX_PROVIDER_ROUTING, serviceTier: "flex" };
  }
  return settings;
}

/**
 * OpenRouter answers a request no provider can serve with 404 and a message
 * naming the filter that excluded everything — the price ceiling, zero data
 * retention, or a required parameter. Nothing reaches a provider, so no
 * generation row exists: the body carries an error message and no `id`.
 *
 * That absent id is what makes this safe to record as free. A 404 that does
 * carry a generation id means a provider was reached, so it is not this case and
 * keeps the conservative worst-case-cost path.
 */
export function isOpenRouterRoutingRefusal(status: number, body: unknown): boolean {
  if (status !== 404) return false;
  if (readOpenRouterResponseId(body) !== null) return false;
  return /no (?:endpoints|allowed providers)/i.test(readOpenRouterErrorMessage(body) ?? "");
}

function readOpenRouterErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const error = (body as { error?: unknown }).error;
  const message =
    error && typeof error === "object" ? (error as { message?: unknown }).message : (body as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message : null;
}

export function maxOpenRouterRequestCostUsd(
  prompt: string,
  maxCompletionTokens: number,
  model = OPENROUTER_AUTOMATION_MODEL,
  modelPreset?: ScannerModelPreset,
): number {
  const { provider } = automationModelSettings(model, modelPreset);
  const inputTokenCeiling = new TextEncoder().encode(prompt).byteLength;
  return (
    inputTokenCeiling * provider.max_price.prompt +
    Math.max(0, maxCompletionTokens) * provider.max_price.completion
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

export type OpenRouterKeyBudget = {
  limitUsd: number | null;
  limitRemainingUsd: number | null;
  limitReset: "daily" | "weekly" | "monthly" | null;
  usageMonthlyUsd: number;
};

type OpenRouterKeyBudgetFetcher = (
  url: string,
  init: { method: "GET"; headers: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const OPENROUTER_CURRENT_KEY_URL = "https://openrouter.ai/api/v1/key";
const OPENROUTER_KEY_BUDGET_TIMEOUT_MS = 2_000;

export type OpenRouterKeyBudgetGate = {
  remainingLlmUsd: number;
  skipReason: "openrouter_key_budget_unverified" | "openrouter_key_limit_unsafe" | "llm_budget_capped" | null;
};

/** The provider's aggregate key limit also covers concurrent scanner paths. */
export function evaluateOpenRouterKeyBudget(
  snapshot: OpenRouterKeyBudget | null,
  budget: Pick<AutomationBudget, "monthlyLlmUsdCap" | "remainingLlmUsd">,
): OpenRouterKeyBudgetGate {
  const blocked = (skipReason: Exclude<OpenRouterKeyBudgetGate["skipReason"], null>): OpenRouterKeyBudgetGate =>
    ({ remainingLlmUsd: 0, skipReason });
  if (
    !snapshot || nonnegativeNumber(snapshot.usageMonthlyUsd) === null ||
    nonnegativeNumber(budget.monthlyLlmUsdCap) === null || nonnegativeNumber(budget.remainingLlmUsd) === null
  ) {
    return blocked("openrouter_key_budget_unverified");
  }
  if (
    snapshot.limitUsd === null || snapshot.limitReset === "daily" || snapshot.limitReset === "weekly" ||
    (typeof snapshot.limitUsd === "number" && snapshot.limitUsd > MAX_MONTHLY_LLM_USD_CAP)
  ) {
    return blocked("openrouter_key_limit_unsafe");
  }
  const limitUsd = nonnegativeNumber(snapshot.limitUsd);
  const limitRemainingUsd = nonnegativeNumber(snapshot.limitRemainingUsd);
  if (
    limitUsd === null || limitRemainingUsd === null ||
    (snapshot.limitReset !== "monthly" && snapshot.limitReset !== null) || limitRemainingUsd > limitUsd
  ) {
    return blocked("openrouter_key_budget_unverified");
  }
  const monthlyCap = Math.min(budget.monthlyLlmUsdCap, MAX_MONTHLY_LLM_USD_CAP);
  const remainingLlmUsd = Math.max(0, Math.min(
    budget.remainingLlmUsd,
    monthlyCap - snapshot.usageMonthlyUsd,
    limitRemainingUsd,
  ));
  return { remainingLlmUsd, skipReason: remainingLlmUsd > 0 ? null : "llm_budget_capped" };
}

/**
 * Read OpenRouter's aggregate, provider-enforced key budget. This is the
 * no-write authority for preview diagnostics: an application-local allowance
 * cannot safely coordinate concurrent serverless requests.
 */
export async function readOpenRouterKeyBudget(
  apiKey: string,
  fetcher: OpenRouterKeyBudgetFetcher = fetch as unknown as OpenRouterKeyBudgetFetcher,
): Promise<OpenRouterKeyBudget | null> {
  if (!apiKey.trim()) return null;
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timeout = setTimeout(() => { controller.abort(); resolve(null); }, OPENROUTER_KEY_BUDGET_TIMEOUT_MS);
  });
  const read = async (): Promise<OpenRouterKeyBudget | null> => {
    try {
      const response = await fetcher(OPENROUTER_CURRENT_KEY_URL, {
        method: "GET",
        headers: { authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const body = await response.json();
      const data = body && typeof body === "object" ? (body as { data?: unknown }).data : null;
      if (!data || typeof data !== "object") return null;

      const rawLimit = (data as { limit?: unknown }).limit;
      const rawRemaining = (data as { limit_remaining?: unknown }).limit_remaining;
      const rawReset = (data as { limit_reset?: unknown }).limit_reset;
      const limitUsd = rawLimit === null ? null : nonnegativeNumber(rawLimit);
      const limitRemainingUsd = rawRemaining === null ? null : nonnegativeNumber(rawRemaining);
      const usageMonthlyUsd = nonnegativeNumber((data as { usage_monthly?: unknown }).usage_monthly);
      const limitReset =
        rawReset === "daily" || rawReset === "weekly" || rawReset === "monthly" || rawReset === null ? rawReset : undefined;
      if (limitUsd === null && rawLimit !== null) return null;
      if (limitRemainingUsd === null && rawRemaining !== null) return null;
      if (usageMonthlyUsd === null || limitReset === undefined) return null;
      return { limitUsd, limitRemainingUsd, limitReset, usageMonthlyUsd };
    } catch {
      return null;
    }
  };
  try {
    return await Promise.race([read(), deadline]);
  } finally {
    clearTimeout(timeout);
  }
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
const OPENROUTER_GENERATION_RETRY_DELAYS_MS = [100, 250] as const;
const OPENROUTER_REQUEST_TIMEOUT_MS = 20_000;
const OPENROUTER_REQUEST_RETRY_DELAYS_MS = [100, 250] as const;

export class OpenRouterDeadlineExpiredError extends Error {
  constructor() {
    super("Scanner model time limit reached before the request started");
    this.name = "OpenRouterDeadlineExpiredError";
  }
}

export function llmDeadlineReached(deadlineAtMs?: number): boolean {
  return deadlineAtMs !== undefined && (!Number.isFinite(deadlineAtMs) || Date.now() >= deadlineAtMs);
}

/** Includes response-body parsing; abort alone cannot bound a stalled fetcher. */
export async function withOpenRouterRequestTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  deadlineAtMs?: number,
  maximumMs = OPENROUTER_REQUEST_TIMEOUT_MS,
): Promise<T> {
  if (llmDeadlineReached(deadlineAtMs)) throw new OpenRouterDeadlineExpiredError();
  const timeoutMs = Math.min(maximumMs, deadlineAtMs === undefined ? maximumMs : deadlineAtMs - Date.now());
  if (timeoutMs <= 0) throw new OpenRouterDeadlineExpiredError();
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error("OpenRouter request timed out; its cost is unverified"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation(controller.signal), timedOut]);
  } finally {
    clearTimeout(timeout);
  }
}

export async function waitForOpenRouterRetry(failedAttempt: number, deadlineAtMs?: number): Promise<boolean> {
  if (llmDeadlineReached(deadlineAtMs)) return false;
  const delay = OPENROUTER_REQUEST_RETRY_DELAYS_MS[failedAttempt] ?? OPENROUTER_REQUEST_RETRY_DELAYS_MS[1];
  const remaining = deadlineAtMs === undefined ? delay : Math.max(0, deadlineAtMs - Date.now());
  await new Promise((resolve) => setTimeout(resolve, Math.min(delay, remaining)));
  return !llmDeadlineReached(deadlineAtMs);
}

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

function shouldRetryOpenRouterGeneration(status: number): boolean {
  return status === 404 || status === 408 || status === 425 || status === 429 || status >= 500;
}

/**
 * Resolve a request's cost from the immediate response, then OpenRouter's
 * generation audit endpoint when the immediate usage block is incomplete.
 */
export async function resolveOpenRouterCostUsd(
  data: unknown,
  apiKey: string,
  fetcher: OpenRouterGenerationFetcher,
  deadlineAtMs?: number,
): Promise<number | null> {
  const immediateCost = readOpenRouterUsageCostUsd(data);
  if (immediateCost !== null) return immediateCost;

  const responseId = readOpenRouterResponseId(data);
  if (!responseId) return null;

  for (let attempt = 0; attempt <= OPENROUTER_GENERATION_RETRY_DELAYS_MS.length; attempt += 1) {
    if (llmDeadlineReached(deadlineAtMs)) return null;
    try {
      const { response, body } = await withOpenRouterRequestTimeout(async (signal) => {
        const response = await fetcher(
          `${OPENROUTER_GENERATION_URL}?id=${encodeURIComponent(responseId)}`,
          { method: "GET", headers: { authorization: `Bearer ${apiKey}` }, signal },
        );
        return { response, body: response.ok ? await response.json() : null };
      }, deadlineAtMs, OPENROUTER_GENERATION_TIMEOUT_MS);
      if (response.ok) {
        const costUsd = readOpenRouterGenerationCostUsd(body);
        if (costUsd !== null || attempt === OPENROUTER_GENERATION_RETRY_DELAYS_MS.length) return costUsd;
      }
      if (
        !response.ok &&
        (!shouldRetryOpenRouterGeneration(response.status) || attempt === OPENROUTER_GENERATION_RETRY_DELAYS_MS.length)
      ) {
        return null;
      }
    } catch {
      if (attempt === OPENROUTER_GENERATION_RETRY_DELAYS_MS.length || llmDeadlineReached(deadlineAtMs)) return null;
    }
    const delay = OPENROUTER_GENERATION_RETRY_DELAYS_MS[attempt];
    if (deadlineAtMs !== undefined && Date.now() + delay >= deadlineAtMs) return null;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  return null;
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
  const requestedLlmUsdCap = input.scannerPolicy?.monthlyLlmUsdCap ?? Math.min(monthlyBudgetUsd, DEFAULT_MONTHLY_LLM_USD_CAP);
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
      ? input.patchBurstActive
        ? 3
        : Math.max(0, Math.min(3, Math.floor(input.scannerPolicy?.scheduledSearchCreditsPerRun ?? 1)))
      : 5;
  const reconReserve =
    input.mode === "scheduled" && requestedQueries > 0 && remainingTavilyCredits > SCHEDULED_RECON_CREDIT_RESERVE
      ? SCHEDULED_RECON_CREDIT_RESERVE
      : 0;
  const requestedSearchQueries =
    input.mode === "scheduled" && input.patchBurstActive
      ? Math.max(0, requestedQueries - reconReserve)
      : requestedQueries;
  const requestedTavilyCredits =
    input.mode === "scheduled" ? requestedQueries + (input.patchBurstActive ? 0 : reconReserve) : requestedQueries;
  const searchCreditsAvailable = Math.max(0, remainingTavilyCredits - reconReserve);
  const maxSearchQueries = canSpendSearch ? Math.max(0, Math.min(requestedSearchQueries, searchCreditsAvailable)) : 0;
  const allowPaidSearch = maxSearchQueries > 0;
  const maxTavilyCreditsPerRun =
    input.mode === "scheduled"
      ? canSpendSearch
        ? Math.max(0, Math.min(requestedTavilyCredits, remainingTavilyCredits))
        : 0
      : remainingTavilyCredits;

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
    maxTavilyCreditsPerRun,
    maxSearchResults: maxSearchQueries * 5,
    maxLlmCalls: remainingLlmUsd > 0 ? (allowPaidSearch ? Math.min(20, maxSearchQueries * 4) : 4) : 0,
    skipReasons,
  };
}
