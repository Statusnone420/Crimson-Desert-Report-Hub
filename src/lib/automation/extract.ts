import { CATEGORIES, PLATFORMS, type Category, type Platform } from "@/lib/constants";
import { classifySignal, summarize } from "@/lib/reddit";

type EnvLike = Record<string, string | undefined>;

export type SourceCandidate = {
  title: string;
  snippet: string;
  url: string;
};

export type ExtractedSignal = {
  issueTitle: string;
  category: Category;
  platform: Platform | null;
  confidence: "low" | "medium" | "high";
  summary: string;
  clusterSlug: string | null;
};

export type ExtractionProvider = "deterministic" | "openrouter";

export type ExtractionFallbackReason =
  | "openrouter_missing_config"
  | "llm_allowance_exhausted"
  | "llm_budget_capped"
  | "openrouter_provider_failure"
  | "openrouter_invalid_json";

export type ExtractionResult = ExtractedSignal & {
  extractionProvider: ExtractionProvider;
  extractionModel: string | null;
  llmCallsUsed: number;
  llmCostUsd: number;
  fallbackReason?: ExtractionFallbackReason;
};

type OpenRouterFetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

type OpenRouterFetch = (
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
  },
) => Promise<OpenRouterFetchResponse>;

export type ClusterOption = { slug: string; title: string };

export type OpenRouterExtractionOptions = {
  env?: EnvLike;
  fetcher?: OpenRouterFetch;
  llmCallsRemaining: number;
  llmBudgetRemainingUsd?: number;
  clusterOptions?: ClusterOption[];
};

const OPENROUTER_CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";

const MODEL_ROUTE = [
  "deepseek/deepseek-v4-flash",
  "qwen/qwen3-235b-a22b-2507",
  "deepseek/deepseek-v4-pro",
] as const;

type RoutedModel = (typeof MODEL_ROUTE)[number];

const MODEL_PRICE_USD_PER_M_TOKENS: Record<RoutedModel, { input: number; output: number }> = {
  "deepseek/deepseek-v4-flash": { input: 0.09, output: 0.18 },
  "qwen/qwen3-235b-a22b-2507": { input: 0.09, output: 0.1 },
  "deepseek/deepseek-v4-pro": { input: 0.435, output: 0.87 },
};

const ESTIMATED_INPUT_TOKENS_PER_EXTRACTION = 1500;
const ESTIMATED_OUTPUT_TOKENS_PER_EXTRACTION = 400;

const platformPatterns: { platform: Platform; patterns: RegExp[] }[] = [
  { platform: "pc_steam", patterns: [/\bpc\b/i, /\bsteam\b/i, /\brtx\b/i, /\bgtx\b/i] },
  { platform: "ps5_pro", patterns: [/ps5 pro/i] },
  { platform: "ps5", patterns: [/\bps5\b/i, /playstation 5/i] },
  { platform: "xbox_series_x", patterns: [/series x/i] },
  { platform: "xbox_series_s", patterns: [/series s/i] },
];

function asCategory(value: unknown): Category {
  if (typeof value === "string" && (CATEGORIES as readonly string[]).includes(value)) return value as Category;
  throw new Error("invalid extraction category");
}

function asPlatform(value: unknown): Platform | null {
  if (value == null || value === "") return null;
  if (typeof value === "string" && (PLATFORMS as readonly string[]).includes(value)) return value as Platform;
  throw new Error("invalid extraction platform");
}

function asConfidence(value: unknown): "low" | "medium" | "high" {
  if (value === "low" || value === "medium" || value === "high") return value;
  throw new Error("invalid extraction confidence");
}

function deterministicResult(
  candidate: SourceCandidate,
  fallbackReason?: ExtractionFallbackReason,
  llmCallsUsed = 0,
  llmCostUsd = 0,
): ExtractionResult {
  return {
    ...deterministicExtract(candidate),
    extractionProvider: "deterministic",
    extractionModel: null,
    llmCallsUsed,
    llmCostUsd,
    ...(fallbackReason ? { fallbackReason } : {}),
  };
}

function readOpenRouterContent(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return null;
  const message = (choices[0] as { message?: unknown } | undefined)?.message;
  const content = (message as { content?: unknown } | undefined)?.content;
  return typeof content === "string" ? content.trim() : null;
}

function buildPrompt(candidate: SourceCandidate, clusterOptions: ClusterOption[] = []): string {
  const lines = [
    "Extract one Crimson Desert issue signal as strict JSON.",
    'Use category one of "performance", "crash_startup", "controls_gameplay", "graphics_visual", "audio", "quest_progression", "other".',
    'Use confidence one of "low", "medium", "high".',
    'Use platform one of "pc_steam", "ps5", "ps5_pro", "xbox_series_x", "xbox_series_s", "other", or null.',
    "Return only JSON with issueTitle, category, platform, confidence, summary.",
    `Title: ${candidate.title}`,
    `Snippet: ${candidate.snippet}`,
    `URL: ${candidate.url}`,
  ];
  if (clusterOptions.length > 0) {
    lines.push(
      "Known issue clusters (assign clusterSlug if one matches, else null): " +
        clusterOptions.map((c) => `${c.slug}: ${c.title}`).join(" | "),
    );
    lines.push("Return clusterSlug as one of the listed slugs or null.");
  }
  return lines.join("\n");
}

function extractionJsonSchema(clusterOptions: ClusterOption[]) {
  const clusterSlugs = clusterOptions.map((option) => option.slug);
  return {
    type: "object",
    additionalProperties: false,
    required: ["issueTitle", "category", "platform", "confidence", "summary", "clusterSlug"],
    properties: {
      issueTitle: { type: "string", minLength: 1, maxLength: 120 },
      category: { type: "string", enum: CATEGORIES },
      platform: { anyOf: [{ type: "string", enum: PLATFORMS }, { type: "null" }] },
      confidence: { type: "string", enum: ["low", "medium", "high"] },
      summary: { type: "string", minLength: 1, maxLength: 280 },
      clusterSlug:
        clusterSlugs.length > 0
          ? { anyOf: [{ type: "string", enum: clusterSlugs }, { type: "null" }] }
          : { type: "null" },
    },
  };
}

export function deterministicExtract(candidate: SourceCandidate): ExtractedSignal {
  const text = `${candidate.title} ${candidate.snippet}`;
  const classified = classifySignal(text);
  const platform = platformPatterns.find((entry) => entry.patterns.some((pattern) => pattern.test(text)))?.platform ?? null;
  const issueTitle = candidate.title.replace(/\s+/g, " ").trim().slice(0, 120) || "Crimson Desert community signal";
  return {
    issueTitle,
    category: classified.category,
    platform,
    confidence: classified.confidence,
    summary: summarize(issueTitle, candidate.snippet),
    clusterSlug: null,
  };
}

export function parseOpenRouterExtraction(content: string, validSlugs: string[] = []): ExtractedSignal {
  const parsed = JSON.parse(content) as {
    issueTitle?: unknown;
    category?: unknown;
    platform?: unknown;
    confidence?: unknown;
    summary?: unknown;
    clusterSlug?: unknown;
  };
  const category = asCategory(parsed.category);
  const platform = asPlatform(parsed.platform);
  const confidence = asConfidence(parsed.confidence);
  const issueTitle = typeof parsed.issueTitle === "string" ? parsed.issueTitle.trim().slice(0, 120) : "";
  const summary = typeof parsed.summary === "string" ? parsed.summary.trim().slice(0, 280) : "";
  if (!issueTitle) throw new Error("invalid extraction issueTitle");
  if (!summary) throw new Error("invalid extraction summary");
  const clusterSlug =
    typeof parsed.clusterSlug === "string" && validSlugs.includes(parsed.clusterSlug) ? parsed.clusterSlug : null;
  return {
    issueTitle,
    category,
    platform,
    confidence,
    summary,
    clusterSlug,
  };
}

type AttemptOutcome =
  | { ok: true; signal: ExtractedSignal; costUsd: number }
  | { ok: false; reason: "openrouter_provider_failure" | "openrouter_invalid_json" };

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function readUsageCostUsd(data: unknown, model: RoutedModel): number {
  const usage = data && typeof data === "object" ? (data as { usage?: unknown }).usage : null;
  if (!usage || typeof usage !== "object") return 0;

  const directCost =
    asNumber((usage as { cost?: unknown }).cost) ??
    asNumber((usage as { cost_usd?: unknown }).cost_usd) ??
    asNumber((usage as { total_cost?: unknown }).total_cost);
  if (directCost !== null) return directCost;

  const promptTokens =
    asNumber((usage as { prompt_tokens?: unknown }).prompt_tokens) ??
    asNumber((usage as { input_tokens?: unknown }).input_tokens) ??
    0;
  const completionTokens =
    asNumber((usage as { completion_tokens?: unknown }).completion_tokens) ??
    asNumber((usage as { output_tokens?: unknown }).output_tokens) ??
    0;
  const price = MODEL_PRICE_USD_PER_M_TOKENS[model];
  return (promptTokens * price.input + completionTokens * price.output) / 1_000_000;
}

function estimatedCallCostUsd(model: RoutedModel): number {
  const price = MODEL_PRICE_USD_PER_M_TOKENS[model];
  return (ESTIMATED_INPUT_TOKENS_PER_EXTRACTION * price.input + ESTIMATED_OUTPUT_TOKENS_PER_EXTRACTION * price.output) / 1_000_000;
}

function usageOrEstimatedCostUsd(data: unknown, model: RoutedModel): number {
  const usageCost = readUsageCostUsd(data, model);
  return usageCost > 0 ? usageCost : estimatedCallCostUsd(model);
}

async function attemptOpenRouterExtraction(
  candidate: SourceCandidate,
  fetcher: OpenRouterFetch,
  apiKey: string,
  model: RoutedModel,
  clusterOptions: ClusterOption[],
): Promise<AttemptOutcome> {
  let response: OpenRouterFetchResponse;
  try {
    response = await fetcher(OPENROUTER_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        provider: { require_parameters: true },
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "crimson_desert_issue_signal",
            strict: true,
            schema: extractionJsonSchema(clusterOptions),
          },
        },
        messages: [
          { role: "system", content: "You extract game issue reports and return only valid JSON." },
          { role: "user", content: buildPrompt(candidate, clusterOptions) },
        ],
      }),
    });
  } catch {
    return { ok: false, reason: "openrouter_provider_failure" };
  }
  if (!response.ok) return { ok: false, reason: "openrouter_provider_failure" };
  try {
    const data = await response.json();
    const content = readOpenRouterContent(data);
    if (!content) return { ok: false, reason: "openrouter_invalid_json" };
    const validSlugs = clusterOptions.map((option) => option.slug);
    return { ok: true, signal: parseOpenRouterExtraction(content, validSlugs), costUsd: usageOrEstimatedCostUsd(data, model) };
  } catch {
    return { ok: false, reason: "openrouter_invalid_json" };
  }
}

export async function extractSignalWithOpenRouter(
  candidate: SourceCandidate,
  options: OpenRouterExtractionOptions,
): Promise<ExtractionResult> {
  const env = options.env ?? process.env;
  const apiKey = env.OPENROUTER_API_KEY?.trim();

  if (!apiKey) return deterministicResult(candidate, "openrouter_missing_config");
  if (options.llmCallsRemaining <= 0) return deterministicResult(candidate, "llm_allowance_exhausted");
  if ((options.llmBudgetRemainingUsd ?? Number.POSITIVE_INFINITY) <= 0) return deterministicResult(candidate, "llm_budget_capped");

  const fetcher = options.fetcher ?? (fetch as unknown as OpenRouterFetch);
  const clusterOptions = options.clusterOptions ?? [];
  const maxAttempts = Math.min(MODEL_ROUTE.length, Math.max(1, options.llmCallsRemaining));
  let callsUsed = 0;
  let costUsd = 0;
  let lastReason: "openrouter_provider_failure" | "openrouter_invalid_json" = "openrouter_provider_failure";
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const model = MODEL_ROUTE[attempt];
    if (options.llmBudgetRemainingUsd !== undefined && options.llmBudgetRemainingUsd - costUsd < estimatedCallCostUsd(model)) {
      return deterministicResult(candidate, "llm_budget_capped", callsUsed, costUsd);
    }
    callsUsed += 1;
    const outcome = await attemptOpenRouterExtraction(candidate, fetcher, apiKey, model, clusterOptions);
    if (outcome.ok) costUsd += outcome.costUsd;
    if (outcome.ok) {
      return {
        ...outcome.signal,
        extractionProvider: "openrouter",
        extractionModel: model,
        llmCallsUsed: callsUsed,
        llmCostUsd: costUsd,
      };
    }
    lastReason = outcome.reason;
  }
  return deterministicResult(candidate, lastReason, callsUsed, costUsd);
}
