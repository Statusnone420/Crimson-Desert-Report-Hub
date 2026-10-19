import type { ColumnModel } from "@/lib/editorials/models";

/** USD per million tokens, pinned from Anthropic's list prices (Oct 2026). OpenRouter lists the same rates. */
export type TokenPrices = { input: number; output: number; cacheWrite: number; cacheRead: number };

export const PRICES_PER_MILLION: Record<ColumnModel, TokenPrices> = {
  "claude-fable-5-1": { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 0.25 },
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
};

/** Haiku 5.5 bills a whole request at these rates once its prompt passes 100k tokens, cache reads and writes included. */
export const HAIKU_LONG_PROMPT_PRICES: TokenPrices = { input: 0.5, output: 2.5, cacheWrite: 0.625, cacheRead: 0.05 };
export const HAIKU_LONG_PROMPT_TOKENS = 100_000;

export type TokenUsage = {
  inputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
};

export function promptTokens(usage: Pick<TokenUsage, "inputTokens" | "cacheWriteTokens" | "cacheReadTokens">): number {
  return usage.inputTokens + usage.cacheWriteTokens + usage.cacheReadTokens;
}

export function pricesFor(model: ColumnModel, prompt: number): TokenPrices {
  return model === "claude-haiku-5-5" && prompt > HAIKU_LONG_PROMPT_TOKENS ? HAIKU_LONG_PROMPT_PRICES : PRICES_PER_MILLION[model];
}

/** What a call cost, from the token usage the provider reported. */
export function costFromUsage(model: ColumnModel, usage: TokenUsage): number {
  const prices = pricesFor(model, promptTokens(usage));
  return (
    usage.inputTokens * prices.input
    + usage.cacheWriteTokens * prices.cacheWrite
    + usage.cacheReadTokens * prices.cacheRead
    + usage.outputTokens * prices.output
  ) / 1_000_000;
}

/**
 * The most a call can cost: every estimated prompt token at the dearer of the input and
 * cache-write rates, plus every allowed output token. Reserved before the call so the
 * ledger never runs behind the provider.
 */
export function worstCaseCost(model: ColumnModel, estimatedPromptTokens: number, maxOutputTokens: number): number {
  const prices = pricesFor(model, estimatedPromptTokens);
  return (estimatedPromptTokens * Math.max(prices.input, prices.cacheWrite) + maxOutputTokens * prices.output) / 1_000_000;
}
