import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { providerKey, resolveCheckerModel, resolveProvider } from "@/lib/editorials/config";
import { sectionsToMarkdown } from "@/lib/editorials/content";
import { readFactPack } from "@/lib/editorials/factPack.server";
import { generateEdition, slugify } from "@/lib/editorials/generate.server";
import { readColumnGuides } from "@/lib/editorials/guides.server";
import type { WriterEffort, WriterModel } from "@/lib/editorials/models";
import type { ColumnGuides } from "@/lib/editorials/prompts";
import { providerCarries } from "@/lib/editorials/provider.server";
import { relevanceScore } from "@/lib/editorials/relevance";
import {
  approvedEditions, baselineMetrics, latestFactPack, recentOpeners, saveTestDraft, styleNotes, voiceExamples,
} from "@/lib/editorials/runStore.server";
import { readColumnSettings } from "@/lib/editorials/settings.server";
import type { SkipReason } from "@/lib/editorials/validate";

/** A server action has the operator page's 300 seconds; the draft keeps a margin. */
const TEST_DRAFT_BUDGET_MS = 270_000;

export type TestDraftOutcome = { status: "saved" } | { status: "skipped"; reason: SkipReason } | { status: "daily_cap" };

/**
 * One A/B test draft: the full writer, checker and validator pipeline on the newest
 * stored fact pack, so every model sees the same facts. It is saved as a test row that
 * is never public, never takes a slot and never touches the one-shot writer override.
 */
export async function generateTestDraft(input: {
  client: SupabaseClient;
  now: Date;
  model: WriterModel;
  effort: WriterEffort;
  guides?: () => ColumnGuides;
  clock?: () => number;
  fetchImpl?: typeof fetch;
}): Promise<TestDraftOutcome> {
  const { client, now, model, effort } = input;
  const clock = input.clock ?? Date.now;
  const { settings } = await readColumnSettings(client);
  const pack = await latestFactPack(client) ?? await readFactPack(now, await baselineMetrics(client));
  const draft = { slotKey: `test:${now.toISOString().slice(0, 10)}`, writerModel: model, writerEffort: effort, pack, relevanceScore: relevanceScore(pack.deltas) };
  const skip = async (reason: SkipReason, checkReport: unknown = null): Promise<TestDraftOutcome> => {
    await saveTestDraft(client, { ...draft, ok: false, reason, checkReport });
    return { status: "skipped", reason };
  };

  const provider = resolveProvider(settings.provider);
  const apiKey = provider ? providerKey(provider) : null;
  if (!provider || !apiKey) return skip("provider_unavailable");
  const checker = resolveCheckerModel();
  if (!checker.ok || !providerCarries(provider, model) || !providerCarries(provider, checker.model)) return skip("model_not_allowed");

  const guides = (input.guides ?? readColumnGuides)();
  const [examples, notes, openers, approved] = await Promise.all([voiceExamples(client), styleNotes(client), recentOpeners(client), approvedEditions(client)]);
  const result = await generateEdition({
    client, target: { provider, apiKey, fetchImpl: input.fetchImpl }, writerModel: model, effort, checkerModel: checker.model, guides,
    parts: { guides, examples, approved, notes, openers }, pack, monthlyCapSetting: settings.monthlyCapUsd, test: true,
    deadlineMs: clock() + TEST_DRAFT_BUDGET_MS, clock,
  });
  if (!result.ok && result.report.note === "test_daily_cap") return { status: "daily_cap" };
  if (!result.ok) return skip(result.reason, result.report);
  await saveTestDraft(client, {
    ...draft,
    ok: true,
    edition: { slug: slugify(result.title), title: result.title, dek: result.dek, body_md: sectionsToMarkdown(result.sections), facts_box: result.factsBox, check_report: result.report },
  });
  return { status: "saved" };
}
