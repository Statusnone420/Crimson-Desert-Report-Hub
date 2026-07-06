import { CATEGORIES, PLATFORMS, type Category, type Platform } from "@/lib/constants";
import { classifySignal, summarize } from "@/lib/reddit";
import { rejectPaidOpenRouterModel } from "@/lib/automation/budget";

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
  | "openrouter_paid_model"
  | "llm_allowance_exhausted"
  | "openrouter_provider_failure"
  | "openrouter_invalid_json";

export type ExtractionResult = ExtractedSignal & {
  extractionProvider: ExtractionProvider;
  extractionModel: string | null;
  llmCallUsed: boolean;
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
  clusterOptions?: ClusterOption[];
};

const OPENROUTER_CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";

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
  llmCallUsed = false,
): ExtractionResult {
  return {
    ...deterministicExtract(candidate),
    extractionProvider: "deterministic",
    extractionModel: null,
    llmCallUsed,
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

export async function extractSignalWithOpenRouter(
  candidate: SourceCandidate,
  options: OpenRouterExtractionOptions,
): Promise<ExtractionResult> {
  const env = options.env ?? process.env;
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  const model = env.OPENROUTER_FREE_MODEL?.trim();

  if (!apiKey || !model) return deterministicResult(candidate, "openrouter_missing_config");
  if (options.llmCallsRemaining <= 0) return deterministicResult(candidate, "llm_allowance_exhausted");

  try {
    rejectPaidOpenRouterModel(model);
  } catch {
    return deterministicResult(candidate, "openrouter_paid_model");
  }

  const fetcher = options.fetcher ?? (fetch as unknown as OpenRouterFetch);
  let response: OpenRouterFetchResponse;
  try {
    response = await fetcher(OPENROUTER_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You extract game issue reports and return only valid JSON.",
          },
          { role: "user", content: buildPrompt(candidate, options.clusterOptions ?? []) },
        ],
      }),
    });
  } catch {
    return deterministicResult(candidate, "openrouter_provider_failure", true);
  }

  if (!response.ok) return deterministicResult(candidate, "openrouter_provider_failure", true);

  try {
    const content = readOpenRouterContent(await response.json());
    if (!content) return deterministicResult(candidate, "openrouter_invalid_json", true);
    const validSlugs = (options.clusterOptions ?? []).map((option) => option.slug);
    return {
      ...parseOpenRouterExtraction(content, validSlugs),
      extractionProvider: "openrouter",
      extractionModel: model,
      llmCallUsed: true,
    };
  } catch {
    return deterministicResult(candidate, "openrouter_invalid_json", true);
  }
}
