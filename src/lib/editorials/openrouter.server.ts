import "server-only";

import { postMessages, type FetchLike } from "@/lib/editorials/anthropic.server";
import { messagesBody, type MessagesOutcome, type MessagesRequest } from "@/lib/editorials/messages";
import type { ColumnModel } from "@/lib/editorials/models";

/**
 * OpenRouter's Anthropic-compatible Messages endpoint. It takes the same body as
 * Anthropic's (system blocks with cache_control, adaptive thinking, output_config
 * effort and format), so the column sends the same request with OpenRouter's model ids.
 * This uses the column's own key and never touches the scanner's OpenRouter settings.
 */
export const OPENROUTER_MESSAGES_URL = "https://openrouter.ai/api/v1/messages";

/** OpenRouter's ids for the allowlisted models. A model missing here is model_not_allowed on OpenRouter. */
export const OPENROUTER_MODEL_IDS: Partial<Record<ColumnModel, string>> = {
  "claude-opus-5-5": "anthropic/claude-opus-5.5",
  "claude-sonnet-5-5": "anthropic/claude-sonnet-5.5",
  "claude-fable-5-1": "anthropic/claude-fable-5.1",
  "claude-haiku-5-5": "anthropic/claude-haiku-5.5",
};

/** OpenRouter reports what it charged, in USD, as usage.cost. */
export function openRouterCost(body: unknown): number | null {
  const cost = (body as { usage?: { cost?: unknown } } | null)?.usage?.cost;
  return typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? cost : null;
}

export function callOpenRouter(request: MessagesRequest, apiKey: string, fetchImpl?: FetchLike): Promise<MessagesOutcome> {
  const model = OPENROUTER_MODEL_IDS[request.model];
  if (!model) return Promise.resolve({ kind: "rejected", status: 0, reason: "model_not_allowed" });
  return postMessages({
    url: OPENROUTER_MESSAGES_URL,
    headers: { authorization: `Bearer ${apiKey}` },
    // require_parameters keeps the request on endpoints that support every field sent,
    // so structured outputs, effort and caching are never silently dropped.
    body: { ...messagesBody(request, model), provider: { require_parameters: true } },
    timeoutMs: request.timeoutMs,
    fetchImpl,
    readCost: openRouterCost,
  });
}
