import { rejectPaidOpenRouterModel } from "@/lib/automation/budget";
import { routeToWatchlistCluster, type RoutableCluster } from "@/lib/automation/route";
import type { Category } from "@/lib/constants";

type EnvLike = Record<string, string | undefined>;

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

export type ClaimMappingClaim = {
  fixText: string;
  category: string | null;
};

export type ClaimMappingCluster = RoutableCluster & {
  description?: string | null;
};

export type ClaimMappingDecision = {
  matchKind: "llm_sure" | "llm_unsure" | "keyword_proposal" | "none";
  clusterId: string | null;
  clusterSlug: string | null;
  reason: string;
  llmCallsUsed: number;
  llmCostUsd: number;
  extractionModel: string | null;
};

export type ClaimMappingOptions = {
  env?: EnvLike;
  fetcher?: OpenRouterFetch;
  llmCallsRemaining: number;
  llmBudgetRemainingUsd?: number;
};

const OPENROUTER_CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_CLAIM_MODEL = "openrouter/free";
const CLAIM_MAPPING_COST_USD = 0;

function compactReason(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, 180) : fallback;
}

function keywordProposal(claim: ClaimMappingClaim, clusters: ClaimMappingCluster[], reason: string): ClaimMappingDecision {
  if (!claim.category) {
    return {
      matchKind: "none",
      clusterId: null,
      clusterSlug: null,
      reason,
      llmCallsUsed: 0,
      llmCostUsd: 0,
      extractionModel: null,
    };
  }

  const routed = routeToWatchlistCluster(
    {
      issueTitle: claim.fixText,
      summary: claim.fixText,
      category: claim.category as Category,
      llmClusterSlug: null,
    },
    clusters,
  );
  if (!routed) {
    return {
      matchKind: "none",
      clusterId: null,
      clusterSlug: null,
      reason,
      llmCallsUsed: 0,
      llmCostUsd: 0,
      extractionModel: null,
    };
  }

  return {
    matchKind: "keyword_proposal",
    clusterId: routed.id,
    clusterSlug: routed.slug,
    reason: "Needs review: keyword match is only a proposal.",
    llmCallsUsed: 0,
    llmCostUsd: 0,
    extractionModel: null,
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

function buildPrompt(claim: ClaimMappingClaim, clusters: ClaimMappingCluster[]): string {
  return [
    "Map this Pearl Abyss claimed fix to one known Crimson Desert issue cluster.",
    'Return JSON only: {"matchKind":"sure"|"unsure","clusterSlug":string|null,"reason":string}.',
    "Use matchKind sure only when the fix clearly addresses the same issue, not merely the same broad category.",
    "Use unsure for vague UI polish, unrelated changes, broad performance wording, or negated/ambiguous text.",
    `Claim: ${claim.fixText}`,
    `Claim category: ${claim.category ?? "unknown"}`,
    "Known clusters:",
    clusters
      .map((cluster) => `${cluster.slug}: ${cluster.title} (${cluster.category}) - ${cluster.description ?? ""}`)
      .join("\n"),
  ].join("\n");
}

function responseSchema(clusters: ClaimMappingCluster[]) {
  const slugs = clusters.map((cluster) => cluster.slug);
  return {
    type: "object",
    additionalProperties: false,
    required: ["matchKind", "clusterSlug", "reason"],
    properties: {
      matchKind: { type: "string", enum: ["sure", "unsure"] },
      clusterSlug:
        slugs.length > 0
          ? { anyOf: [{ type: "string", enum: slugs }, { type: "null" }] }
          : { type: "null" },
      reason: { type: "string", minLength: 1, maxLength: 180 },
    },
  };
}

export function parseOpenRouterClaimMapping(content: string, clusters: ClaimMappingCluster[]): ClaimMappingDecision {
  const parsed = JSON.parse(content) as { matchKind?: unknown; clusterSlug?: unknown; reason?: unknown };
  const bySlug = new Map(clusters.map((cluster) => [cluster.slug, cluster]));
  const slug = typeof parsed.clusterSlug === "string" ? parsed.clusterSlug : null;
  const cluster = slug ? bySlug.get(slug) : null;
  const reason = compactReason(parsed.reason, "LLM could not explain the mapping.");

  if (parsed.matchKind === "sure" && cluster) {
    return {
      matchKind: "llm_sure",
      clusterId: cluster.id,
      clusterSlug: cluster.slug,
      reason,
      llmCallsUsed: 0,
      llmCostUsd: 0,
      extractionModel: null,
    };
  }

  return {
    matchKind: "llm_unsure",
    clusterId: cluster?.id ?? null,
    clusterSlug: cluster?.slug ?? null,
    reason,
    llmCallsUsed: 0,
    llmCostUsd: 0,
    extractionModel: null,
  };
}

export async function mapClaimToClusterWithOpenRouter(
  claim: ClaimMappingClaim,
  clusters: ClaimMappingCluster[],
  options: ClaimMappingOptions,
): Promise<ClaimMappingDecision> {
  const fallback = () => keywordProposal(claim, clusters, "OpenRouter unavailable for claim mapping.");
  const env = options.env ?? process.env;
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return fallback();
  if (options.llmCallsRemaining <= 0) return fallback();
  if ((options.llmBudgetRemainingUsd ?? Number.POSITIVE_INFINITY) < CLAIM_MAPPING_COST_USD) return fallback();
  if (clusters.length === 0) {
    return {
      matchKind: "none",
      clusterId: null,
      clusterSlug: null,
      reason: "No known clusters available for claim mapping.",
      llmCallsUsed: 0,
      llmCostUsd: 0,
      extractionModel: null,
    };
  }

  let model: string;
  try {
    model = rejectPaidOpenRouterModel(env.OPENROUTER_FREE_MODEL?.trim() || DEFAULT_CLAIM_MODEL);
  } catch {
    return fallback();
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
        provider: { require_parameters: true },
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "crimson_desert_claim_mapping",
            strict: true,
            schema: responseSchema(clusters),
          },
        },
        messages: [
          { role: "system", content: "You map patch-note claimed fixes to known game issue clusters." },
          { role: "user", content: buildPrompt(claim, clusters) },
        ],
      }),
    });
  } catch {
    return { ...fallback(), llmCallsUsed: 1, llmCostUsd: 0, extractionModel: model };
  }

  if (!response.ok) return { ...fallback(), llmCallsUsed: 1, llmCostUsd: 0, extractionModel: model };

  try {
    const data = await response.json();
    const content = readOpenRouterContent(data);
    if (!content) return { ...fallback(), llmCallsUsed: 1, llmCostUsd: CLAIM_MAPPING_COST_USD, extractionModel: model };
    const parsed = parseOpenRouterClaimMapping(content, clusters);
    return {
      ...parsed,
      llmCallsUsed: 1,
      llmCostUsd: CLAIM_MAPPING_COST_USD,
      extractionModel: model,
    };
  } catch {
    return { ...fallback(), llmCallsUsed: 1, llmCostUsd: CLAIM_MAPPING_COST_USD, extractionModel: model };
  }
}
