import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { callAnthropic, countAnthropicTokens, type FetchLike } from "@/lib/editorials/anthropic.server";
import { columnMonthlyCapUsd, columnRequestCapUsd } from "@/lib/editorials/budget";
import { estimateTokens, type MessagesOutcome, type MessagesRequest, type ProviderFailure } from "@/lib/editorials/messages";
import type { ColumnModel, ColumnProvider } from "@/lib/editorials/models";
import { callOpenRouter, OPENROUTER_MODEL_IDS } from "@/lib/editorials/openrouter.server";
import { costFromUsage, worstCaseCost, type TokenUsage } from "@/lib/editorials/pricing";
import { ColumnNotSetUpError } from "@/lib/editorials/settings.server";
import { isMissingSupabaseRpc } from "@/lib/supabaseCompatibility";

export type LedgerOperation = "writer" | "checker" | "test_writer" | "test_checker";
export const TEST_DRAFTS_PER_DAY = 10;
/** Structured outputs add a system prompt the character estimate can't see. */
const SCHEMA_OVERHEAD_TOKENS = 1_500;

export type ProviderTarget = { provider: ColumnProvider; apiKey: string; fetchImpl?: FetchLike };

/** Whether the selected provider carries the model at all. */
export function providerCarries(provider: ColumnProvider, model: ColumnModel): boolean {
  return provider === "anthropic" || OPENROUTER_MODEL_IDS[model] !== undefined;
}

/** Prompt size: Anthropic's token count when available, else about three characters per token. */
export async function promptSize(request: MessagesRequest, target: ProviderTarget): Promise<number> {
  const counted = target.provider === "anthropic" ? await countAnthropicTokens(request, target.apiKey, target.fetchImpl) : null;
  return counted ?? estimateTokens(request);
}

function call(request: MessagesRequest, target: ProviderTarget): Promise<MessagesOutcome> {
  return target.provider === "anthropic"
    ? callAnthropic(request, target.apiKey, target.fetchImpl)
    : callOpenRouter(request, target.apiKey, target.fetchImpl);
}

export type MeteredResult =
  | { kind: "ok"; text: string | null; stopReason: string | null; costUsd: number }
  | { kind: "blocked"; reason: "request_cap" | "monthly_cap" | "test_daily_cap" }
  | { kind: "rejected"; reason: ProviderFailure }
  | { kind: "failed" };

type Settlement = { state: "settled" | "estimated"; usd: number; usage: TokenUsage | null };

/**
 * How a finished call settles. A rejected request (any HTTP error) was not billed and
 * settles at $0. A call with no readable answer settles at its reservation as an
 * estimate. Anthropic is settled from its token usage and the pinned prices; OpenRouter
 * from the cost it reports, falling back to the same usage arithmetic as an estimate.
 */
export function settlementFor(outcome: MessagesOutcome, provider: ColumnProvider, model: ColumnModel, reservedUsd: number): Settlement {
  if (outcome.kind === "rejected") return { state: "settled", usd: 0, usage: null };
  if (outcome.kind === "failed") return { state: "estimated", usd: reservedUsd, usage: null };
  if (provider === "openrouter" && outcome.reportedCostUsd !== null) return { state: "settled", usd: outcome.reportedCostUsd, usage: outcome.usage };
  if (outcome.usage) return { state: provider === "anthropic" ? "settled" : "estimated", usd: costFromUsage(model, outcome.usage), usage: outcome.usage };
  return { state: "estimated", usd: reservedUsd, usage: null };
}

/**
 * Reserve the worst case in the column's ledger, make the call, then settle it. Every
 * provider shares this one ledger and budget; the scanner's ledger is never touched.
 */
export async function meteredCall(input: {
  client: SupabaseClient;
  operation: LedgerOperation;
  request: MessagesRequest;
  promptTokens: number;
  target: ProviderTarget;
  monthlyCapSetting: number | null;
}): Promise<MeteredResult> {
  const { client, request, target } = input;
  const reservedUsd = worstCaseCost(request.model, input.promptTokens + SCHEMA_OVERHEAD_TOKENS, request.maxTokens);
  const id = crypto.randomUUID();
  const reserve = await client.rpc("editorial_ai_reserve", {
    p_id: id,
    p_operation: input.operation,
    p_provider: target.provider,
    p_model: request.model,
    p_reserved_usd: reservedUsd,
    p_request_cap_usd: columnRequestCapUsd(),
    p_monthly_cap_usd: columnMonthlyCapUsd(input.monthlyCapSetting),
    p_test_daily_cap: TEST_DRAFTS_PER_DAY,
  });
  if (isMissingSupabaseRpc(reserve.error, "editorial_ai_reserve")) throw new ColumnNotSetUpError();
  if (reserve.error) throw new Error("The column ledger could not reserve spend.");
  const reservation = reserve.data as { status?: string; reason?: string } | null;
  if (reservation?.status !== "reserved") {
    const reason = reservation?.reason === "request_cap" || reservation?.reason === "test_daily_cap" ? reservation.reason : "monthly_cap";
    return { kind: "blocked", reason };
  }
  const outcome = await call(request, target);
  const settlement = settlementFor(outcome, target.provider, request.model, reservedUsd);
  const settled = await client.rpc("editorial_ai_settle", {
    p_id: id,
    p_state: settlement.state,
    p_settled_usd: settlement.usd,
    p_input_tokens: settlement.usage?.inputTokens ?? null,
    p_cache_write_tokens: settlement.usage?.cacheWriteTokens ?? null,
    p_cache_read_tokens: settlement.usage?.cacheReadTokens ?? null,
    p_output_tokens: settlement.usage?.outputTokens ?? null,
  });
  // An unsettled reservation keeps counting at its reserved cost, which only overstates spend.
  if (settled.error) console.warn(JSON.stringify({ event: "column_ledger_settle_failed", operation: input.operation }));
  if (outcome.kind === "rejected") return { kind: "rejected", reason: outcome.reason };
  if (outcome.kind === "failed") return { kind: "failed" };
  return { kind: "ok", text: outcome.text, stopReason: outcome.stopReason, costUsd: settlement.usd };
}
