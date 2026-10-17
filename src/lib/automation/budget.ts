import {
  createOpenRouterDiagnostic,
  reportOpenRouterDiagnostic,
  type OpenRouterDiagnostic,
  type OpenRouterKeyBudgetValidation,
  type OpenRouterDiagnosticCode,
  type OpenRouterDiagnosticReporter,
  type OpenRouterRoutingCategory,
  safeOpenRouterRoutingMessage,
} from "@/lib/automation/openRouterDiagnostics";
import { OpenRouterAttemptTrace, type OpenRouterAttemptReporter, type OpenRouterTraceJournal } from "@/lib/automation/openRouterTrace";
import { AI_PRICE_HEADROOM, type AiProfile, type AiReasoning } from "@/lib/aiSettings/types";

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
    /** Set only after loading a validated, owner-selected AI profile. */
    aiManaged?: boolean;
  };
};

export type AutomationBudget = {
  paidGuard?: import("./paidOperation").PaidOperationGuard;
  guardedRun?: import("./accounting.server").GuardedRun;
  openRouterTrace?: OpenRouterTraceJournal;
  checkpointDiagnostics?: import("@/lib/automation/diagnostics").ScannerDiagnostic[];
  openRouterDiagnostics?: OpenRouterDiagnostic[];
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
export const SEARCH_QUERY_COST_USD = 0.008;
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
  only?: readonly string[];
  allow_fallbacks?: false;
  sort?: "price";
  max_price: { prompt: number; completion: number; request: 0; image: 0 };
};

type AutomationModelSettings = {
  provider: ProviderRouting;
  /** Luna can use gateway reasoning; the manual rollback keeps its prior route. */
  reasoning?: { effort: Exclude<AiReasoning, "default">; exclude?: true };
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
  // First-party OpenAI may retain requests for abuse monitoring. That policy is
  // accepted; provider pinning keeps this from broadening the host.
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

export function resolveAutomationOpenRouterModel(model: string | undefined, modelPreset?: ScannerModelPreset, profile?: AiProfile): string {
  if (profile) {
    automationModelSettings(profile.modelId, undefined, profile);
    return profile.modelId;
  }
  if (modelPreset !== undefined) return scannerModelPreset(modelPreset).model;
  const resolved = model?.trim() || OPENROUTER_AUTOMATION_MODEL;
  if (!(APPROVED_AUTOMATION_MODELS as readonly string[]).includes(resolved)) {
    throw new Error(`Automation model must be one of: ${APPROVED_AUTOMATION_MODELS.join(", ")}`);
  }
  return resolved;
}

/** A pinned provider may raise its price this far above the saved quote before scans stop routing. */
export const OPENROUTER_SCANNER_PRICE_HEADROOM = AI_PRICE_HEADROOM;

/**
 * Scanner requests let a pinned provider charge up to 4x the saved quote, so
 * a small provider price change does not stop AI. The scaled ceiling must still
 * fit the request's spending limit: when 4x does not fit, the largest scale
 * that fits is used, and never less than the quote. Setup tests keep the quote.
 */
export function scannerPricedRequest(
  budgetUsd: number,
  profile: AiProfile | undefined,
  build: (priceScale: number) => string,
  ceiling: (body: string, priceScale: number) => number,
): { body: string; ceilingUsd: number } {
  const quoted = build(1);
  const quotedCeiling = ceiling(quoted, 1);
  // Without a pinned provider, a higher ceiling would admit other, pricier providers.
  if (!profile?.metadata.endpoint || !(quotedCeiling > 0) || !Number.isFinite(budgetUsd)) return { body: quoted, ceilingUsd: quotedCeiling };
  // The 2% margin covers the few bytes that larger price digits add to the body.
  const scale = Math.min(OPENROUTER_SCANNER_PRICE_HEADROOM, Math.floor((budgetUsd * 0.98 / quotedCeiling) * 100) / 100);
  if (!(scale > 1)) return { body: quoted, ceilingUsd: quotedCeiling };
  const body = build(scale);
  const ceilingUsd = ceiling(body, scale);
  return ceilingUsd <= budgetUsd ? { body, ceilingUsd } : { body: quoted, ceilingUsd: quotedCeiling };
}

export function automationModelSettings(model: string, modelPreset?: ScannerModelPreset, profile?: AiProfile, priceScale = 1): AutomationModelSettings {
  if (profile) {
    if (!Number.isFinite(priceScale) || priceScale < 1 || priceScale > OPENROUTER_SCANNER_PRICE_HEADROOM) {
      throw new Error("The scanner price scale is outside its allowed range.");
    }
    const metadata = profile.metadata;
    const parameters = metadata.supportedParameters;
    if (profile.provider !== "openrouter" || metadata.provider !== "openrouter" || model !== profile.modelId || metadata.id !== model ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/@+~-]{0,199}$/.test(model) ||
      !metadata.inputModalities.includes("text") || !metadata.outputModalities.includes("text") || metadata.structuredOutput !== true ||
      !parameters?.includes("structured_outputs") || !parameters.includes("response_format") ||
      !["default", "none", "low", "medium", "high"].includes(profile.reasoning) ||
      !["standard", "zdr"].includes(profile.retention) ||
      !Number.isSafeInteger(profile.connectionVersion) || profile.connectionVersion < 0 ||
      !Number.isSafeInteger(profile.maxOutputTokens) || profile.maxOutputTokens < 1 ||
      (metadata.maxOutputTokens !== null && profile.maxOutputTokens > metadata.maxOutputTokens)) {
      throw new Error("The selected AI profile does not support the scanner request.");
    }
    const outputTokenParameter = parameters.includes("max_tokens") ? "max_tokens" :
      parameters.includes("max_completion_tokens") ? "max_completion_tokens" : null;
    const prompt = nonnegativeNumber(metadata.inputUsdPerMillion);
    const completion = nonnegativeNumber(metadata.outputUsdPerMillion);
    if (outputTokenParameter === null || prompt === null || completion === null || metadata.pricingSource === "unknown") {
      throw new Error("The selected AI profile has no verified output limit or token prices.");
    }
    if (metadata.pricingSupported !== true || metadata.pricingIssue !== null) {
      throw new Error("The selected AI profile has unsupported additional or tiered charges.");
    }
    if (profile.reasoning !== "default" && (metadata.reasoning !== true || !parameters.includes("reasoning") ||
      (metadata.reasoningEfforts !== null && !metadata.reasoningEfforts.includes(profile.reasoning)) ||
      (profile.reasoning === "none" && metadata.reasoningRequired === true))) {
      throw new Error("The selected AI profile does not support this reasoning setting.");
    }
    // Round up so the ceiling never falls below the scaled quote.
    const scaled = (price: number) => priceScale === 1 ? price : Math.ceil(price * priceScale * 1e6 - 1e-6) / 1e6;
    return {
      provider: {
        require_parameters: true,
        data_collection: profile.retention === "zdr" ? "deny" : "allow",
        ...(profile.retention === "zdr" ? { zdr: true as const } : {}),
        ...(metadata.endpoint ? { only: [metadata.endpoint.tag], allow_fallbacks: false as const } : {}),
        max_price: { prompt: scaled(prompt), completion: scaled(completion), request: 0, image: 0 },
      },
      ...(profile.reasoning === "default" ? {} : { reasoning: { effort: profile.reasoning, exclude: true as const } }),
      outputTokenParameter,
    };
  }
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

/** Diagnostic only. Unknown wording and mixed/private detail never establish a cause. */
export function openRouterRoutingRefusalCategory(status: number, body: unknown): OpenRouterRoutingCategory {
  if (!isOpenRouterRoutingRefusal(status, body)) return "unknown";
  const message = readOpenRouterErrorMessage(body)?.trim() ?? "";
  const patterns: [OpenRouterRoutingCategory, RegExp][] = [
    ["price", /^No endpoints found (?:that can handle the requested price|matching your (?:price limits|price ceiling))\.?$/i],
    ["privacy", /^No endpoints found matching your data policy(?: \((?:Zero data retention|ZDR)\))?\.?$/i],
    ["required_parameters", /^No endpoints found (?:that (?:can handle|support) the requested parameters|matching your required parameters)\.?$/i],
    ["provider_restriction", /^No endpoints found matching your provider (?:selection|restrictions)\.?$/i],
  ];
  return patterns.find(([, pattern]) => pattern.test(message))?.[0] ?? "unknown";
}

/** Diagnostic fields for a verified routing refusal; empty for any other response. */
export function openRouterRoutingRefusalDetails(status: number, body: unknown): { routingRefusal?: OpenRouterRoutingCategory; routingMessage?: string } {
  if (!isOpenRouterRoutingRefusal(status, body)) return {};
  const routingMessage = safeOpenRouterRoutingMessage(readOpenRouterErrorMessage(body));
  return { routingRefusal: openRouterRoutingRefusalCategory(status, body), ...(routingMessage ? { routingMessage } : {}) };
}

export function maxOpenRouterRequestCostUsd(
  prompt: string,
  maxCompletionTokens: number,
  model = OPENROUTER_AUTOMATION_MODEL,
  modelPreset?: ScannerModelPreset,
  profile?: AiProfile,
  priceScale = 1,
): number {
  const { provider } = automationModelSettings(model, modelPreset, profile, priceScale);
  const inputTokenCeiling = new TextEncoder().encode(prompt).byteLength;
  return (
    inputTokenCeiling * provider.max_price.prompt +
    Math.max(0, profile ? Math.min(maxCompletionTokens, profile.maxOutputTokens) : maxCompletionTokens) * provider.max_price.completion
  ) / 1_000_000;
}

/** Byte count is a conservative token ceiling and includes the JSON schema. */
export function openRouterRequestFitsContext(requestBody: string, maxCompletionTokens: number, profile?: AiProfile): boolean {
  if (!profile) return true;
  const context = profile.metadata.contextWindow;
  const promptBytes = new TextEncoder().encode(requestBody).byteLength;
  const maxPrompt = profile.metadata.endpoint?.maxPromptTokens;
  return context !== null && Number.isSafeInteger(context) && context > 0 &&
    (maxPrompt == null || promptBytes <= maxPrompt) &&
    promptBytes + Math.min(maxCompletionTokens, profile.maxOutputTokens) <= context;
}

/** Avoid inherited request mutation or extra work from optional gateway plugins. */
export const OPENROUTER_SCANNER_TEXT_OPTIONS = {
  modalities: ["text"],
  plugins: ["web", "file-parser", "response-healing", "context-compression", "auto-router", "fusion", "pareto-router"]
    .map((id) => ({ id, enabled: false })),
};

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
  init: { method: "GET"; headers: Record<string, string>; signal?: AbortSignal; redirect?: "error" },
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
  onDiagnostic?: OpenRouterDiagnosticReporter,
  onAttempt?: OpenRouterAttemptReporter,
  sharedDeadlineAtMs?: number,
): Promise<OpenRouterKeyBudget | null> {
  if (!apiKey.trim()) return null;
  const trace = new OpenRouterAttemptTrace("key_budget", 1, onAttempt, sharedDeadlineAtMs);
  if (onAttempt) await trace.start();
  const startedAtMs = Date.now();
  const diagnostic: { code: OpenRouterDiagnosticCode } = { code: "key_budget_transport_failure" };
  let httpStatus: number | null = null;
  let keyBudgetValidation: OpenRouterKeyBudgetValidation | undefined;
  let timedOut = false;
  let readError: unknown;
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timeout = setTimeout(() => { timedOut = true; controller.abort(); resolve(null); }, OPENROUTER_KEY_BUDGET_TIMEOUT_MS);
  });
  const read = async (): Promise<OpenRouterKeyBudget | null> => {
    try {
      trace.fetchStarted(OPENROUTER_KEY_BUDGET_TIMEOUT_MS, false);
      const response = await fetcher(OPENROUTER_CURRENT_KEY_URL, {
        method: "GET",
        headers: { authorization: `Bearer ${apiKey}` },
        redirect: "error",
        signal: controller.signal,
      });
      trace.headers(response.status);
      httpStatus = response.status;
      diagnostic.code = "key_budget_http_failure";
      if (!response.ok) return null;
      diagnostic.code = "key_budget_decode_failure";
      const body = await response.json();
      trace.body();
      diagnostic.code = "key_budget_validation_failure";
      const data = body && typeof body === "object" ? (body as { data?: unknown }).data : null;
      const fields = data && typeof data === "object" ? data as Record<string, unknown> : {};
      const numericValidation = (value: unknown) => value === undefined ? "missing" :
        value === null ? "null" : nonnegativeNumber(value) !== null ? "valid" : "invalid";
      const reset = fields.limit_reset;
      keyBudgetValidation = {
        limit: numericValidation(fields.limit),
        limit_remaining: numericValidation(fields.limit_remaining),
        limit_reset: reset === undefined ? "missing" : reset === null ? "null" :
          reset === "daily" || reset === "weekly" || reset === "monthly" ? "valid" : "invalid",
        usage_monthly: numericValidation(fields.usage_monthly),
        remainingWithinLimit: nonnegativeNumber(fields.limit) !== null && nonnegativeNumber(fields.limit_remaining) !== null
          ? (fields.limit_remaining as number) <= (fields.limit as number) : null,
      };
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
      // Parsing success is distinct from the spending gate (unsafe, exhausted, or inconsistent).
      diagnostic.code = "key_budget_response_parsed";
      return { limitUsd, limitRemainingUsd, limitReset, usageMonthlyUsd };
    } catch (error) {
      readError = error;
      return null;
    }
  };
  try {
    const snapshot = await Promise.race([read(), deadline]);
    clearTimeout(timeout);
    reportOpenRouterDiagnostic(onDiagnostic, {
      ...createOpenRouterDiagnostic(timedOut ? "key_budget_timeout" : diagnostic.code, startedAtMs, httpStatus, 1),
      ...(keyBudgetValidation ? { keyBudgetValidation } : {}),
    });
    await trace.finish(timedOut ? "timeout" : diagnostic.code === "key_budget_http_failure" ? "http_failure" :
      snapshot ? "success" : diagnostic.code === "key_budget_validation_failure" ? "validation_failure" :
      diagnostic.code === "key_budget_decode_failure" ? "decode_failure" : "transport_failure", "not_attempted", readError);
    return snapshot;
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
    redirect?: "error";
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
// Kept back from a scanner request so a slow answer can still be settled: one
// coalesced progress checkpoint (4s), three 2s generation lookups plus backoff
// (6.35s) and validation (1s).
const OPENROUTER_COST_AUDIT_RESERVE_MS = 12_000;

/**
 * A scanner request may use the remaining shared AI window, less the cost-audit
 * reserve. A fixed 20s cap cancelled slow but valid answers and left their cost
 * unknown. Without a shared deadline the 20s default still applies.
 */
export function openRouterScannerRequestMs(deadlineAtMs?: number): number {
  if (deadlineAtMs === undefined) return OPENROUTER_REQUEST_TIMEOUT_MS;
  return Math.max(0, deadlineAtMs - Date.now() - OPENROUTER_COST_AUDIT_RESERVE_MS);
}

export class OpenRouterDeadlineExpiredError extends Error {
  constructor() {
    super("Scanner model time limit reached before the request started");
    this.name = "OpenRouterDeadlineExpiredError";
  }
}

export class OpenRouterRequestTimeoutError extends Error {
  constructor() {
    super("OpenRouter request timed out; its cost is unverified");
    this.name = "OpenRouterRequestTimeoutError";
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
      reject(new OpenRouterRequestTimeoutError());
      controller.abort();
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

class OpenRouterGenerationDecodeError extends Error {
  constructor() {
    super("OpenRouter generation response could not be decoded");
    this.name = "OpenRouterGenerationDecodeError";
  }
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
  onDiagnostic?: OpenRouterDiagnosticReporter,
  responseHttpStatus: number | null = null,
  onAttempt?: OpenRouterAttemptReporter,
  parentId: string | null = null,
): Promise<number | null> {
  const startedAtMs = Date.now();
  const report = (code: OpenRouterDiagnosticCode, httpStatus: number | null, attempts: number): void => {
    reportOpenRouterDiagnostic(onDiagnostic, createOpenRouterDiagnostic(code, startedAtMs, httpStatus, attempts));
  };
  const immediateCost = readOpenRouterUsageCostUsd(data);
  if (immediateCost !== null) return immediateCost;
  report("response_cost_missing", responseHttpStatus, 0);

  const responseId = readOpenRouterResponseId(data);
  if (!responseId) {
    report("response_id_missing", responseHttpStatus, 0);
    return null;
  }

  for (let attempt = 0; attempt <= OPENROUTER_GENERATION_RETRY_DELAYS_MS.length; attempt += 1) {
    const attempts = attempt + 1;
    if (llmDeadlineReached(deadlineAtMs)) {
      report("generation_lookup_deadline", null, attempt);
      return null;
    }
    let httpStatus: number | null = null;
    const trace = new OpenRouterAttemptTrace("cost_audit", attempts, onAttempt, deadlineAtMs, parentId);
    if (onAttempt) await trace.start();
    try {
      const { response, body } = await withOpenRouterRequestTimeout(async (signal) => {
        trace.fetchStarted(OPENROUTER_GENERATION_TIMEOUT_MS);
        const response = await fetcher(
          `${OPENROUTER_GENERATION_URL}?id=${encodeURIComponent(responseId)}`,
          { method: "GET", headers: { authorization: `Bearer ${apiKey}` }, redirect: "error", signal },
        );
        trace.headers(response.status);
        httpStatus = response.status;
        if (!response.ok) return { response, body: null };
        try {
          const body = await response.json();
          trace.body();
          return { response, body };
        } catch {
          throw new OpenRouterGenerationDecodeError();
        }
      }, deadlineAtMs, OPENROUTER_GENERATION_TIMEOUT_MS);
      if (response.ok) {
        const costUsd = readOpenRouterGenerationCostUsd(body);
        if (costUsd !== null) {
          report("generation_lookup_verified", response.status, attempts);
          await trace.finish("success", "verified");
          return costUsd;
        }
        report("generation_lookup_cost_missing", response.status, attempts);
        await trace.finish("validation_failure");
        if (attempt === OPENROUTER_GENERATION_RETRY_DELAYS_MS.length) return null;
      }
      if (!response.ok) await trace.finish("http_failure");
      if (
        !response.ok &&
        (!shouldRetryOpenRouterGeneration(response.status) || attempt === OPENROUTER_GENERATION_RETRY_DELAYS_MS.length)
      ) {
        report("generation_lookup_http_failure", response.status, attempts);
        return null;
      }
      if (!response.ok) report("generation_lookup_http_failure", response.status, attempts);
    } catch (error) {
      await trace.finish(error instanceof OpenRouterRequestTimeoutError ? "timeout" :
        error instanceof OpenRouterDeadlineExpiredError ? "deadline" :
        error instanceof OpenRouterGenerationDecodeError ? "decode_failure" : "transport_failure", "not_attempted", error);
      if (error instanceof OpenRouterRequestTimeoutError) report("generation_lookup_timeout", httpStatus, attempts);
      else if (error instanceof OpenRouterGenerationDecodeError) report("generation_lookup_decode_failure", httpStatus, attempts);
      else report("generation_lookup_transport_failure", httpStatus, attempts);
      if (attempt === OPENROUTER_GENERATION_RETRY_DELAYS_MS.length || llmDeadlineReached(deadlineAtMs)) {
        if (llmDeadlineReached(deadlineAtMs) && !(error instanceof OpenRouterRequestTimeoutError)) {
          report("generation_lookup_deadline", null, attempts);
        }
        return null;
      }
    }
    const delay = OPENROUTER_GENERATION_RETRY_DELAYS_MS[attempt];
    if (deadlineAtMs !== undefined && Date.now() + delay >= deadlineAtMs) {
      report("generation_lookup_deadline", null, attempts);
      return null;
    }
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
  const monthlyLlmUsdCap = Math.max(0, Math.min(requestedLlmUsdCap, input.scannerPolicy?.aiManaged === true ? 1_000 : MAX_MONTHLY_LLM_USD_CAP));
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
