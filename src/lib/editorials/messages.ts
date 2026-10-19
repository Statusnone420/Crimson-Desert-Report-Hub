import type { ColumnModel, WriterEffort } from "@/lib/editorials/models";
import type { TokenUsage } from "@/lib/editorials/pricing";

/** One system block. Cached blocks carry an ephemeral cache_control marker. */
export type SystemBlock = { text: string; cache: boolean };

export type MessagesRequest = {
  model: ColumnModel;
  system: SystemBlock[];
  user: string;
  maxTokens: number;
  effort: WriterEffort;
  /** A JSON Schema the reply must match (structured outputs). */
  schema: Record<string, unknown>;
  timeoutMs: number;
};

export type ProviderFailure = "provider_unavailable" | "model_not_allowed" | "invalid_request";

/**
 * What one call came back with.
 * - ok: a reply; usage and reported cost may still be missing.
 * - rejected: the provider answered with an HTTP error, so nothing was billed.
 * - failed: no readable answer (timeout, network, malformed body); billing is unknown.
 */
export type MessagesOutcome =
  | { kind: "ok"; text: string | null; stopReason: string | null; usage: TokenUsage | null; reportedCostUsd: number | null }
  | { kind: "rejected"; status: number; reason: ProviderFailure }
  | { kind: "failed"; reason: "timeout" | "network" | "malformed" };

/**
 * The Messages API body both providers accept. No temperature, top_p or top_k: these
 * models refuse non-default sampling values. Thinking is adaptive; effort sets its depth.
 */
export function messagesBody(request: MessagesRequest, model: string = request.model): Record<string, unknown> {
  return {
    model,
    max_tokens: request.maxTokens,
    system: request.system.map((block) => ({
      type: "text",
      text: block.text,
      ...(block.cache ? { cache_control: { type: "ephemeral" } } : {}),
    })),
    messages: [{ role: "user", content: request.user }],
    thinking: { type: "adaptive" },
    output_config: { effort: request.effort, format: { type: "json_schema", schema: request.schema } },
  };
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/** Token usage in the Messages API shape, or null when any field is missing or malformed. */
export function readUsage(value: unknown): TokenUsage | null {
  if (!value || typeof value !== "object") return null;
  const usage = value as Record<string, unknown>;
  const inputTokens = count(usage.input_tokens);
  const outputTokens = count(usage.output_tokens);
  const cacheWriteTokens = usage.cache_creation_input_tokens === undefined || usage.cache_creation_input_tokens === null ? 0 : count(usage.cache_creation_input_tokens);
  const cacheReadTokens = usage.cache_read_input_tokens === undefined || usage.cache_read_input_tokens === null ? 0 : count(usage.cache_read_input_tokens);
  if (inputTokens === null || outputTokens === null || cacheWriteTokens === null || cacheReadTokens === null) return null;
  return { inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens };
}

/** The reply text: every text block joined. Thinking blocks are never read. */
export function readReplyText(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  const text = content
    .filter((block): block is { type: "text"; text: string } => Boolean(block) && typeof block === "object"
      && (block as { type?: unknown }).type === "text" && typeof (block as { text?: unknown }).text === "string")
    .map((block) => block.text)
    .join("");
  return text || null;
}

/**
 * Sorts an HTTP error into the column's skip reasons. Credit, key and permission
 * problems, rate limits and outages all mean the provider is unavailable for now.
 */
export function classifyHttpError(status: number, message: string): ProviderFailure {
  if (status === 401 || status === 402 || status === 403 || status === 429 || status >= 500) return "provider_unavailable";
  if (/credit balance|insufficient credits|billing/i.test(message)) return "provider_unavailable";
  if (status === 404) return "model_not_allowed";
  if (/model/i.test(message) && /(not a valid|not found|invalid|unknown|does not exist|not available|not supported)/i.test(message)) return "model_not_allowed";
  return "invalid_request";
}

export function errorMessage(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const error = (body as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") return (error as { message: string }).message;
  return "";
}

/** Rough prompt size when no token count is available: about three characters per token. */
export function estimateTokens(request: Pick<MessagesRequest, "system" | "user">): number {
  const characters = request.system.reduce((total, block) => total + block.text.length, 0) + request.user.length;
  return Math.ceil(characters / 3);
}
