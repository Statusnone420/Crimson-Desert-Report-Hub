import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { columnMonthlyCapUsd, columnRequestCapUsd } from "@/lib/editorials/budget";
import { CHECKER_MAX_TOKENS, WRITER_MAX_TOKENS } from "@/lib/editorials/config";
import type { CheckerModel, WriterModel } from "@/lib/editorials/models";
import { worstCaseCost } from "@/lib/editorials/pricing";
import { monthSpendUsd } from "@/lib/editorials/runStore.server";

/** A typical prompt, for the early check before the fact pack is built. */
export const TYPICAL_PROMPT_TOKENS = 30_000;

/**
 * Whether the worst case for the writer and the checker together fits under the request
 * and monthly caps, so no run or test draft pays for a writer whose checker the budget
 * can't cover. The checker reads the same guides and pack as the writer, plus the
 * writer's reply split into numbered units, so its prompt is never larger than the
 * writer's prompt plus twice the writer's longest reply.
 */
export async function budgetCoversBothCalls(client: SupabaseClient, now: Date, input: {
  writerModel: WriterModel;
  checkerModel: CheckerModel;
  promptTokens: number;
  monthlyCapSetting: number | null;
}): Promise<boolean> {
  const writerEstimate = worstCaseCost(input.writerModel, input.promptTokens, WRITER_MAX_TOKENS);
  const checkerEstimate = worstCaseCost(input.checkerModel, input.promptTokens + 2 * WRITER_MAX_TOKENS, CHECKER_MAX_TOKENS);
  const requestCap = columnRequestCapUsd();
  if (writerEstimate > requestCap || checkerEstimate > requestCap) return false;
  return (await monthSpendUsd(client, now)) + writerEstimate + checkerEstimate <= columnMonthlyCapUsd(input.monthlyCapSetting);
}
