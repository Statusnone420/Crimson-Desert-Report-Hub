import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { factsBoxSchema, type EditionSection, type FactsBox } from "@/lib/editorials/content";
import type { FactPack } from "@/lib/editorials/factPack";
import type { CheckerModel, WriterEffort, WriterModel } from "@/lib/editorials/models";
import { checkerRequest, trimmedParts, writerRequest, type ColumnGuides, type WriterPromptParts } from "@/lib/editorials/prompts";
import { meteredCall, promptSize, type MeteredResult, type ProviderTarget } from "@/lib/editorials/provider.server";
import { checkerOutputSchema, parseStructured, writerOutputSchema } from "@/lib/editorials/schemas";
import { numberSentences, processEdition, type CheckReport, type SkipReason } from "@/lib/editorials/validate";

/** Prompts stay under 90k tokens, well clear of the 100k line where Haiku bills a whole request at 5x. */
export const PROMPT_TOKEN_LIMIT = 90_000;
const WRITER_TIMEOUT_MAX_MS = 150_000;
const CHECKER_TIMEOUT_MAX_MS = 60_000;
const CHECKER_RESERVE_MS = 45_000;
const MIN_WRITER_MS = 60_000;
const MIN_CHECKER_MS = 15_000;
/** The least time a generation needs: the writer's minimum plus the checker's reserve. */
export const MIN_GENERATION_MS = MIN_WRITER_MS + CHECKER_RESERVE_MS;

export type GenerationInput = {
  client: SupabaseClient;
  target: ProviderTarget;
  writerModel: WriterModel;
  effort: WriterEffort;
  checkerModel: CheckerModel;
  guides: ColumnGuides;
  parts: WriterPromptParts;
  pack: FactPack;
  monthlyCapSetting: number | null;
  test: boolean;
  /** Epoch milliseconds by which both calls must be finished. */
  deadlineMs: number;
  clock?: () => number;
};

export type GenerationReport = {
  provider: string;
  writer: { model: string; costUsd: number | null };
  checker: { model: string; costUsd: number | null } | null;
  post: CheckReport | null;
  note?: string;
};

export type GenerationResult =
  | { ok: true; title: string; dek: string; sections: EditionSection[]; factsBox: FactsBox; report: GenerationReport }
  | { ok: false; reason: SkipReason; report: GenerationReport };

function callFailure(result: Exclude<MeteredResult, { kind: "ok" }>, otherwise: SkipReason): SkipReason {
  if (result.kind === "blocked") return "budget";
  if (result.kind === "rejected" && (result.reason === "provider_unavailable" || result.reason === "model_not_allowed")) return result.reason;
  return otherwise;
}

/** Lowercase words joined by hyphens, at most 80 characters. */
export function slugify(title: string): string {
  const slug = title.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/g, "");
  return slug || "state-of-the-game";
}

/**
 * Writer, checker, then deterministic post-processing. Every paid call is reserved and
 * settled in the column's ledger. Nothing here writes an edition; the caller saves the result.
 */
export async function generateEdition(input: GenerationInput): Promise<GenerationResult> {
  const clock = input.clock ?? Date.now;
  const report: GenerationReport = { provider: input.target.provider, writer: { model: input.writerModel, costUsd: null }, checker: null, post: null };
  const fail = (reason: SkipReason, note?: string): GenerationResult => ({ ok: false, reason, report: note ? { ...report, note } : report });

  const writerTimeout = Math.min(WRITER_TIMEOUT_MAX_MS, input.deadlineMs - clock() - CHECKER_RESERVE_MS);
  if (writerTimeout < MIN_WRITER_MS) return fail("no_time");

  let sized: { request: ReturnType<typeof writerRequest>; tokens: number } | null = null;
  for (let step = -1; step < 8 && !sized; step++) {
    const parts = step < 0 ? input.parts : trimmedParts(input.parts, step);
    if (!parts) break;
    const request = writerRequest({ ...parts, guides: input.guides, model: input.writerModel, effort: input.effort, pack: input.pack, timeoutMs: writerTimeout });
    const tokens = await promptSize(request, input.target);
    if (tokens <= PROMPT_TOKEN_LIMIT) sized = { request, tokens };
  }
  if (!sized) return fail("prompt_too_large");

  const writer = await meteredCall({
    client: input.client, operation: input.test ? "test_writer" : "writer", request: sized.request,
    promptTokens: sized.tokens, target: input.target, monthlyCapSetting: input.monthlyCapSetting,
  });
  if (writer.kind !== "ok") return fail(callFailure(writer, "writer_failed"));
  report.writer.costUsd = writer.costUsd;
  const output = writer.stopReason === "end_turn" ? parseStructured(writer.text, writerOutputSchema) : null;
  if (!output) return fail("writer_failed", writer.stopReason ?? "no_stop_reason");

  const units = numberSentences(output);
  const checkerTimeout = Math.min(CHECKER_TIMEOUT_MAX_MS, input.deadlineMs - clock() - 5_000);
  if (checkerTimeout < MIN_CHECKER_MS) return fail("check_failed", "checker_out_of_time");
  const request = checkerRequest({ guides: input.guides, model: input.checkerModel, pack: input.pack, units, timeoutMs: checkerTimeout });
  const checkerTokens = await promptSize(request, input.target);
  if (checkerTokens > PROMPT_TOKEN_LIMIT) return fail("prompt_too_large");
  const checker = await meteredCall({
    client: input.client, operation: input.test ? "test_checker" : "checker", request,
    promptTokens: checkerTokens, target: input.target, monthlyCapSetting: input.monthlyCapSetting,
  });
  report.checker = { model: input.checkerModel, costUsd: checker.kind === "ok" ? checker.costUsd : null };
  if (checker.kind !== "ok") return fail(callFailure(checker, "check_failed"));
  const verdicts = checker.stopReason === "end_turn" ? parseStructured(checker.text, checkerOutputSchema) : null;
  if (!verdicts) return fail("check_failed", checker.stopReason ?? "no_stop_reason");

  const processed = processEdition(output, verdicts, input.pack);
  report.post = processed.report;
  if (!processed.ok) return fail(processed.reason);
  // The public page re-checks the facts box; an edition it would refuse is never saved.
  if (!factsBoxSchema.safeParse(processed.factsBox).success) return fail("check_failed", "facts_box_shape");
  return { ok: true, title: processed.title, dek: processed.dek, sections: processed.sections, factsBox: processed.factsBox, report };
}
