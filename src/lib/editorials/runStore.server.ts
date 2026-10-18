import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ledgerMonth } from "@/lib/editorials/budget";
import { markdownToSections } from "@/lib/editorials/content";
import type { FactPack, FactPackMetrics } from "@/lib/editorials/factPack";
import type { ApprovedEdition, Opener, StyleNote, VoiceExample } from "@/lib/editorials/prompts";
import { ColumnNotSetUpError } from "@/lib/editorials/settings.server";
import { isColumnTableMissing } from "@/lib/editorials/store.server";
import { splitSentences, type SkipReason } from "@/lib/editorials/validate";
import type { SupabaseErrorLike } from "@/lib/supabaseCompatibility";

const UNIQUE_VIOLATION = "23505";

function check(error: SupabaseErrorLike | null, what: string): void {
  if (!error) return;
  if (isColumnTableMissing(error)) throw new ColumnNotSetUpError();
  throw new Error(`${what} failed.`);
}

export async function slotTaken(client: SupabaseClient, slotKey: string): Promise<boolean> {
  const { data, error } = await client.from("editorials").select("id").eq("slot_key", slotKey).eq("is_test", false).limit(1);
  check(error, "Slot read");
  return (data ?? []).length > 0;
}

/** When the last real edition (anything but a skip) was created, for the minimum gap. */
export async function lastEditionAt(client: SupabaseClient): Promise<Date | null> {
  const { data, error } = await client.from("editorials").select("created_at")
    .eq("is_test", false).neq("status", "skipped").order("created_at", { ascending: false }).limit(1);
  check(error, "Last edition read");
  const value = (data?.[0] as { created_at?: string } | undefined)?.created_at;
  return value ? new Date(value) : null;
}

/** The previous held or published edition's pack metrics, the baseline for relevance. */
export async function baselineMetrics(client: SupabaseClient): Promise<FactPackMetrics | null> {
  const { data, error } = await client.from("editorials").select("fact_pack")
    .eq("is_test", false).in("status", ["held", "published"]).not("fact_pack", "is", null)
    .order("created_at", { ascending: false }).limit(1);
  check(error, "Baseline read");
  const pack = (data?.[0] as { fact_pack?: Partial<FactPack> } | undefined)?.fact_pack;
  const metrics = pack?.metrics;
  return metrics && Array.isArray(metrics.patchVersions) && Array.isArray(metrics.patternIssueIds) ? metrics as FactPackMetrics : null;
}

/** This month's column spend: settled cost, or the reservation for anything unsettled. */
export async function monthSpendUsd(client: SupabaseClient, now: Date): Promise<number> {
  const { data, error } = await client.from("editorial_ai_spend").select("reserved_usd, settled_usd").eq("month", ledgerMonth(now));
  check(error, "Ledger read");
  return ((data ?? []) as { reserved_usd: number | string; settled_usd: number | string | null }[])
    .reduce((total, row) => total + Number(row.settled_usd ?? row.reserved_usd), 0);
}

export async function voiceExamples(client: SupabaseClient): Promise<VoiceExample[]> {
  const { data, error } = await client.from("voice_examples").select("body, label").order("position").order("created_at").limit(5);
  check(error, "Voice examples read");
  return (data ?? []) as VoiceExample[];
}

/** The last ten editor notes, newest first. */
export async function styleNotes(client: SupabaseClient): Promise<StyleNote[]> {
  const { data, error } = await client.from("style_notes").select("rating, note").order("created_at", { ascending: false }).limit(10);
  check(error, "Editor notes read");
  return (data ?? []) as StyleNote[];
}

type WrittenRow = { title: string | null; body_md: string | null };

function firstSentence(row: WrittenRow): string {
  const paragraph = row.body_md ? markdownToSections(row.body_md)?.[0]?.paragraphs[0] ?? "" : "";
  return splitSentences(paragraph)[0] ?? "";
}

/** Titles and opening sentences of the last three real editions, so jokes don't repeat. */
export async function recentOpeners(client: SupabaseClient): Promise<Opener[]> {
  const { data, error } = await client.from("editorials").select("title, body_md")
    .eq("is_test", false).neq("status", "skipped").order("created_at", { ascending: false }).limit(3);
  check(error, "Recent editions read");
  return ((data ?? []) as WrittenRow[]).filter((row) => row.title).map((row) => ({ title: row.title!, firstSentence: firstSentence(row) }));
}

function bodyText(row: WrittenRow): string {
  return (row.body_md ? markdownToSections(row.body_md) ?? [] : []).flatMap((section) => section.paragraphs).join("\n\n");
}

/** Up to two editions the editor rated thumbs up, most recently rated first, rotating into block [B]. */
export async function approvedEditions(client: SupabaseClient): Promise<(ApprovedEdition & { id: string })[]> {
  const { data, error } = await client.from("style_notes").select("editorial_id, created_at")
    .eq("rating", "up").not("editorial_id", "is", null).order("created_at", { ascending: false }).limit(20);
  check(error, "Approved editions read");
  const ids = [...new Set(((data ?? []) as { editorial_id: string }[]).map((row) => row.editorial_id))];
  if (!ids.length) return [];
  const editions = await client.from("editorials").select("id, title, body_md").in("id", ids).neq("status", "skipped");
  check(editions.error, "Approved editions read");
  const byId = new Map(((editions.data ?? []) as (WrittenRow & { id: string })[]).map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row?.title && row.body_md ? [{ id, title: row.title, body: bodyText(row) }] : [];
  }).slice(0, 2);
}

/** The newest stored fact pack, real or test, so every test draft sees the same facts. */
export async function latestFactPack(client: SupabaseClient): Promise<FactPack | null> {
  const { data, error } = await client.from("editorials").select("fact_pack")
    .not("fact_pack", "is", null).order("created_at", { ascending: false }).limit(1);
  check(error, "Fact pack read");
  const pack = (data?.[0] as { fact_pack?: FactPack } | undefined)?.fact_pack;
  return pack && pack.version === 1 && Array.isArray(pack.facts) ? pack : null;
}

export type SkipFields = { relevance_score?: number | null; fact_pack?: FactPack | null; writer_model?: string | null; writer_effort?: string | null; hold_hours?: number | null };

/** A silent skip: one row so the slot is not retried, and nothing else. A slot already written is left alone. */
export async function recordSkip(client: SupabaseClient, slotKey: string, reason: SkipReason, fields: SkipFields = {}): Promise<"recorded" | "taken"> {
  const { error } = await client.from("editorials").insert({ slot_key: slotKey, status: "skipped", skip_reason: reason, ...fields });
  if (error?.code === UNIQUE_VIOLATION) return "taken";
  check(error, "Skip write");
  return "recorded";
}

/**
 * Claims a slot before any paid call, so a concurrent wake can't run it twice. The
 * claim is a writer_failed skip until the edition is saved, so a run that dies midway
 * leaves an honest record.
 */
export async function claimSlot(client: SupabaseClient, slotKey: string, fields: SkipFields): Promise<string | null> {
  const { data, error } = await client.from("editorials")
    .insert({ slot_key: slotKey, status: "skipped", skip_reason: "writer_failed", ...fields })
    .select("id");
  if (error?.code === UNIQUE_VIOLATION) return null;
  check(error, "Slot claim");
  return (data?.[0] as { id?: string } | undefined)?.id ?? null;
}

export async function finishClaimAsSkip(client: SupabaseClient, id: string, reason: SkipReason, checkReport: unknown): Promise<void> {
  const { error } = await client.from("editorials")
    .update({ skip_reason: reason, check_report: checkReport ?? null, updated_at: new Date().toISOString() })
    .eq("id", id).eq("status", "skipped");
  check(error, "Skip update");
}

export type SavedEdition = {
  slug: string;
  title: string;
  dek: string;
  body_md: string;
  facts_box: unknown;
  check_report: unknown;
  publish_at: string | null;
  hold_hours: number;
};

/** Turns the claim into a held edition. A taken slug gets the slot's date added once. */
export async function saveEdition(client: SupabaseClient, id: string, edition: SavedEdition, dateSuffix: string): Promise<void> {
  const update = (slug: string) => client.from("editorials")
    .update({ ...edition, slug, status: "held", skip_reason: null, updated_at: new Date().toISOString() })
    .eq("id", id).eq("status", "skipped").select("id");
  let result = await update(edition.slug);
  if (result.error?.code === UNIQUE_VIOLATION) result = await update(`${edition.slug}-${dateSuffix}`.slice(0, 120));
  check(result.error, "Edition save");
  if (!(result.data ?? []).length) throw new Error("Edition save failed.");
}

export type TestDraft = {
  slotKey: string;
  writerModel: string;
  writerEffort: string;
  pack: FactPack;
  relevanceScore: number;
} & ({ ok: true; edition: Omit<SavedEdition, "publish_at" | "hold_hours"> } | { ok: false; reason: SkipReason; checkReport: unknown });

/** Saves a test draft: held and never scheduled, or skipped with its reason. It never takes a slot. */
export async function saveTestDraft(client: SupabaseClient, draft: TestDraft): Promise<void> {
  const base = { slot_key: draft.slotKey, is_test: true, publish_at: null, writer_model: draft.writerModel, writer_effort: draft.writerEffort, fact_pack: draft.pack, relevance_score: draft.relevanceScore };
  if (!draft.ok) {
    const { error } = await client.from("editorials").insert({ ...base, status: "skipped", skip_reason: draft.reason, check_report: draft.checkReport ?? null });
    check(error, "Test draft save");
    return;
  }
  const edition = draft.edition;
  const insert = (slug: string) => client.from("editorials").insert({ ...base, ...edition, slug, status: "held" });
  let result = await insert(edition.slug);
  if (result.error?.code === UNIQUE_VIOLATION) result = await insert(`${edition.slug}-test-${crypto.randomUUID().slice(0, 8)}`.slice(0, 120));
  check(result.error, "Test draft save");
}
