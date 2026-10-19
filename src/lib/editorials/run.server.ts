import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { columnMonthlyCapUsd, columnRequestCapUsd } from "@/lib/editorials/budget";
import { dueSlots, LAST_WAKE_AFTER_MS, type ColumnSlot } from "@/lib/editorials/cadence";
import { providerKey, resolveCheckerModel, resolveProvider, resolveWriterModel, writerEffort, CHECKER_MAX_TOKENS, WRITER_MAX_TOKENS } from "@/lib/editorials/config";
import { sectionsToMarkdown } from "@/lib/editorials/content";
import { readFactPack } from "@/lib/editorials/factPack.server";
import { generateEdition, MIN_GENERATION_MS, slugify } from "@/lib/editorials/generate.server";
import { readColumnGuides } from "@/lib/editorials/guides.server";
import type { WriterModel } from "@/lib/editorials/models";
import type { ColumnGuides } from "@/lib/editorials/prompts";
import { providerCarries, type ProviderTarget } from "@/lib/editorials/provider.server";
import { worstCaseCost } from "@/lib/editorials/pricing";
import { meetsThreshold, relevanceScore } from "@/lib/editorials/relevance";
import {
  approvedEditions, baselineMetrics, claimSlot, finishClaimAsSkip, lastEditionAt, monthSpendUsd, recentOpeners, recordSkip,
  saveEdition, slotTaken, styleNotes, voiceExamples,
} from "@/lib/editorials/runStore.server";
import { ColumnNotSetUpError, readColumnSettings } from "@/lib/editorials/settings.server";
import type { ColumnSettings } from "@/lib/editorials/settings";
import type { SkipReason } from "@/lib/editorials/validate";
import { isMissingSupabaseRpc } from "@/lib/supabaseCompatibility";
import { isVercelPreview } from "@/lib/previewGuard";
import { createServiceClient, hasSupabaseServiceConfig } from "@/lib/supabase";

const HOUR_MS = 3_600_000;
/** A typical prompt for the budget pre-check; the real reservation uses the measured size. */
const PRECHECK_PROMPT_TOKENS = 30_000;

/**
 * The budget pre-check, before any paid call: the worst case for the writer and the
 * checker together must fit under the request and monthly caps, so neither a run nor a
 * test draft pays for a writer whose checker the budget can't cover.
 */
export async function budgetCoversBothCalls(client: SupabaseClient, now: Date, writerModel: WriterModel, monthlyCapSetting: number | null): Promise<boolean> {
  const writerEstimate = worstCaseCost(writerModel, PRECHECK_PROMPT_TOKENS, WRITER_MAX_TOKENS);
  const checkerEstimate = worstCaseCost("claude-haiku-5-5", PRECHECK_PROMPT_TOKENS, CHECKER_MAX_TOKENS);
  const spent = await monthSpendUsd(client, now);
  return writerEstimate <= columnRequestCapUsd() && spent + writerEstimate + checkerEstimate <= columnMonthlyCapUsd(monthlyCapSetting);
}

export type ColumnRunOutcome =
  | { status: "idle"; reason: "preview" | "no_database" | "no_slot" | "slot_taken" | "deferred" }
  | { status: "skipped"; slot: string; reason: SkipReason }
  | { status: "held"; slot: string; awaitingApproval: boolean };

export type ColumnRunInput = {
  now: Date;
  /** Epoch milliseconds by which the run must be finished. */
  deadlineMs: number;
  client?: SupabaseClient;
  guides?: () => ColumnGuides;
  clock?: () => number;
  fetchImpl?: typeof fetch;
};

function skipped(slot: ColumnSlot, reason: SkipReason): ColumnRunOutcome {
  return { status: "skipped", slot: slot.key, reason };
}

/** The oldest due slot with no row yet, so a newer slot can't hide an older one still in its window. */
async function openSlot(client: SupabaseClient, slots: readonly ColumnSlot[]): Promise<ColumnSlot | null> {
  for (const slot of slots) if (!(await slotTaken(client, slot.key))) return slot;
  return null;
}

/** Clears the one-shot writer override only when this edition used it and nobody changed it since. */
async function clearUsedOverride(client: SupabaseClient, settings: ColumnSettings, model: string): Promise<void> {
  if (settings.nextEditionModel !== model) return;
  const { error } = await client.rpc("editorial_settings_clear_next_model", { p_model: model });
  if (error && !isMissingSupabaseRpc(error, "editorial_settings_clear_next_model")) {
    console.warn(JSON.stringify({ event: "column_override_clear_failed" }));
  }
}

/**
 * One wake of the column. Checks run in order: an existing row for the slot, pause,
 * the minimum gap, the budget, the fact pack and its relevance, the provider and models,
 * then the time left. Each stop writes one silent skipped row and nothing else.
 */
export async function runColumn(input: ColumnRunInput): Promise<ColumnRunOutcome> {
  if (isVercelPreview()) return { status: "idle", reason: "preview" };
  if (!input.client && !hasSupabaseServiceConfig()) return { status: "idle", reason: "no_database" };
  const client = input.client ?? createServiceClient();
  const clock = input.clock ?? Date.now;
  const { now } = input;
  const { settings } = await readColumnSettings(client);
  const slots = dueSlots(settings, now);
  if (!slots.length) return { status: "idle", reason: "no_slot" };
  const slot = await openSlot(client, slots);
  if (!slot) return { status: "idle", reason: "slot_taken" };

  const skip = async (reason: SkipReason, fields: Parameters<typeof recordSkip>[3] = {}): Promise<ColumnRunOutcome> => {
    const recorded = await recordSkip(client, slot.key, reason, fields);
    return recorded === "taken" ? { status: "idle", reason: "slot_taken" } : skipped(slot, reason);
  };

  if (settings.paused) return skip("paused");

  const last = await lastEditionAt(client);
  if (last && now.getTime() - last.getTime() < settings.minGapHours * HOUR_MS) return skip("min_gap");

  const writerChoice = resolveWriterModel({ nextEditionModel: settings.nextEditionModel, burstModel: slot.burst?.model ?? null, defaultWriterModel: settings.defaultWriterModel });
  const checkerChoice = resolveCheckerModel();
  const priceModel = writerChoice.ok ? writerChoice.model : "claude-fable-5-1";
  if (!(await budgetCoversBothCalls(client, now, priceModel, settings.monthlyCapUsd))) return skip("budget");

  const pack = await readFactPack(now, await baselineMetrics(client));
  const score = relevanceScore(pack.deltas);
  const effort = writerEffort();
  const fields = { relevance_score: score, fact_pack: pack, writer_model: writerChoice.ok ? writerChoice.model : null, writer_effort: effort, hold_hours: slot.holdHours };
  if (!meetsThreshold(score, slot.relevance)) return skip("below_threshold", fields);

  const provider = resolveProvider(settings.provider);
  const apiKey = provider ? providerKey(provider) : null;
  if (!provider || !apiKey) return skip("provider_unavailable", fields);
  if (!writerChoice.ok || !checkerChoice.ok || !providerCarries(provider, writerChoice.model) || !providerCarries(provider, checkerChoice.model)) {
    return skip("model_not_allowed", fields);
  }

  if (input.deadlineMs - clock() < MIN_GENERATION_MS) {
    // Too little time after the scan: try again at the next wake inside the window.
    return now.getTime() >= slot.at.getTime() + LAST_WAKE_AFTER_MS ? skip("no_time", fields) : { status: "idle", reason: "deferred" };
  }

  const guides = (input.guides ?? readColumnGuides)();
  const [examples, notes, openers, approved] = await Promise.all([voiceExamples(client), styleNotes(client), recentOpeners(client), approvedEditions(client)]);
  const claimId = await claimSlot(client, slot.key, fields);
  if (!claimId) return { status: "idle", reason: "slot_taken" };

  const target: ProviderTarget = { provider, apiKey, fetchImpl: input.fetchImpl };
  const result = await generateEdition({
    client, target, writerModel: writerChoice.model, effort, checkerModel: checkerChoice.model, guides,
    parts: { guides, examples, approved, notes, openers }, pack, monthlyCapSetting: settings.monthlyCapUsd,
    test: false, deadlineMs: input.deadlineMs, clock,
  });
  if (!result.ok) {
    await finishClaimAsSkip(client, claimId, result.reason, result.report);
    return skipped(slot, result.reason);
  }

  // Approve-first: while editions are left, a new one waits with no publish time.
  const awaitingApproval = settings.approveFirstRemaining > 0;
  await saveEdition(client, claimId, {
    slug: slugify(result.title),
    title: result.title,
    dek: result.dek,
    body_md: sectionsToMarkdown(result.sections),
    facts_box: result.factsBox,
    check_report: result.report,
    publish_at: awaitingApproval ? null : new Date(clock() + slot.holdHours * HOUR_MS).toISOString(),
    hold_hours: slot.holdHours,
  }, slot.at.toISOString().slice(0, 10));
  await clearUsedOverride(client, settings, writerChoice.model);
  return { status: "held", slot: slot.key, awaitingApproval };
}

/** A safe log code for any failure inside the column. Never a message, prompt or key. */
export function columnFailureCode(error: unknown): string {
  return error instanceof ColumnNotSetUpError ? "not_set_up" : "error";
}
