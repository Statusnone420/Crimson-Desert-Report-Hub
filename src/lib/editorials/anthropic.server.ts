import "server-only";

import {
  classifyHttpError,
  errorMessage,
  messagesBody,
  readReplyText,
  readUsage,
  type MessagesOutcome,
  type MessagesRequest,
} from "@/lib/editorials/messages";

export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_COUNT_TOKENS_URL = "https://api.anthropic.com/v1/messages/count_tokens";
export const ANTHROPIC_VERSION = "2023-06-01";
const OVERLOADED = 529;

export type FetchLike = typeof fetch;

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

/**
 * POSTs one Messages API request and reads the reply. Retries once, on 529 only, inside
 * the same time limit. Prompts, replies and keys are never logged.
 */
export async function postMessages(input: {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  timeoutMs: number;
  fetchImpl?: FetchLike;
  readCost?: (body: unknown) => number | null;
}): Promise<MessagesOutcome> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const signal = AbortSignal.timeout(Math.max(1, input.timeoutMs));
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetchImpl(input.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...input.headers },
        body: JSON.stringify(input.body),
        signal,
        cache: "no-store",
      });
    } catch (error) {
      return { kind: "failed", reason: isAbort(error) ? "timeout" : "network" };
    }
    if (response.status === OVERLOADED && attempt === 0 && !signal.aborted) {
      await response.body?.cancel().catch(() => undefined);
      continue;
    }
    let body: unknown;
    try {
      body = await readJson(response);
    } catch (error) {
      return { kind: "failed", reason: isAbort(error) ? "timeout" : "network" };
    }
    if (!response.ok) return { kind: "rejected", status: response.status, reason: classifyHttpError(response.status, errorMessage(body)) };
    if (!body || typeof body !== "object") return { kind: "failed", reason: "malformed" };
    const reply = body as { content?: unknown; stop_reason?: unknown; usage?: unknown };
    return {
      kind: "ok",
      text: readReplyText(reply.content),
      stopReason: typeof reply.stop_reason === "string" ? reply.stop_reason : null,
      usage: readUsage(reply.usage),
      reportedCostUsd: input.readCost?.(body) ?? null,
    };
  }
}

/** Calls Anthropic's Messages API directly with the owner's API key. */
export function callAnthropic(request: MessagesRequest, apiKey: string, fetchImpl?: FetchLike): Promise<MessagesOutcome> {
  return postMessages({
    url: ANTHROPIC_MESSAGES_URL,
    headers: { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION },
    body: messagesBody(request),
    timeoutMs: request.timeoutMs,
    fetchImpl,
  });
}

/** The exact prompt size from Anthropic's free count_tokens endpoint, or null when it can't be read. */
export async function countAnthropicTokens(request: MessagesRequest, apiKey: string, fetchImpl: FetchLike = fetch): Promise<number | null> {
  const body = messagesBody(request);
  try {
    const response = await fetchImpl(ANTHROPIC_COUNT_TOKENS_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION },
      body: JSON.stringify({ model: body.model, system: body.system, messages: body.messages }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    const value = (await readJson(response) as { input_tokens?: unknown } | null)?.input_tokens;
    return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}
