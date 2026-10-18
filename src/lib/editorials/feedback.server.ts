import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { MAX_VOICE_EXAMPLES, type StyleNoteInput, type VoiceExampleInput } from "@/lib/editorials/feedbackForm";
import { ColumnNotSetUpError } from "@/lib/editorials/settings.server";
import { ADMIN_EDITORIAL_COLUMNS, isColumnTableMissing, type AdminEditionRow } from "@/lib/editorials/store.server";
import { approvedEditions } from "@/lib/editorials/runStore.server";
import type { SupabaseErrorLike } from "@/lib/supabaseCompatibility";

function check(error: SupabaseErrorLike | null, what: string): void {
  if (!error) return;
  if (isColumnTableMissing(error)) throw new ColumnNotSetUpError();
  throw new Error(`${what} failed.`);
}

export type VoiceExampleRow = { id: string; body: string; label: string | null; position: number };
export type EditionNote = { id: string; rating: "up" | "down" | null; note: string | null; created_at: string };

export async function addStyleNote(client: SupabaseClient, input: StyleNoteInput): Promise<void> {
  const { error } = await client.from("style_notes").insert({ editorial_id: input.editorialId, rating: input.rating, note: input.note });
  check(error, "Note save");
}

export async function editionNotes(client: SupabaseClient, editorialId: string): Promise<EditionNote[]> {
  const { data, error } = await client.from("style_notes").select("id, rating, note, created_at").eq("editorial_id", editorialId).order("created_at", { ascending: false }).limit(20);
  check(error, "Notes read");
  return (data ?? []) as EditionNote[];
}

export async function listVoiceExamples(client: SupabaseClient): Promise<VoiceExampleRow[]> {
  const { data, error } = await client.from("voice_examples").select("id, body, label, position").order("position").order("created_at").limit(MAX_VOICE_EXAMPLES);
  check(error, "Voice examples read");
  return (data ?? []) as VoiceExampleRow[];
}

/** Adds an example at the end, or edits one. A sixth is refused here and by the database. */
export async function saveVoiceExample(client: SupabaseClient, input: VoiceExampleInput): Promise<"saved" | "full" | "missing"> {
  const now = new Date().toISOString();
  if (input.id) {
    const { data, error } = await client.from("voice_examples").update({ body: input.body, label: input.label, updated_at: now }).eq("id", input.id).select("id");
    check(error, "Voice example save");
    return (data ?? []).length ? "saved" : "missing";
  }
  const examples = await listVoiceExamples(client);
  if (examples.length >= MAX_VOICE_EXAMPLES) return "full";
  const position = examples.reduce((highest, example) => Math.max(highest, example.position), -1) + 1;
  const { error } = await client.from("voice_examples").insert({ body: input.body, label: input.label, position });
  if (error?.code === "23514" && /voice_examples_limit/.test(error.message)) return "full";
  check(error, "Voice example save");
  return "saved";
}

export async function deleteVoiceExample(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from("voice_examples").delete().eq("id", id);
  check(error, "Voice example delete");
}

/** Swaps an example with its neighbour, so the list order is the order the writer reads them. */
export async function moveVoiceExample(client: SupabaseClient, id: string, direction: "up" | "down"): Promise<void> {
  const examples = await listVoiceExamples(client);
  const index = examples.findIndex((example) => example.id === id);
  const other = examples[direction === "up" ? index - 1 : index + 1];
  if (index < 0 || !other) return;
  const order = examples.map((example) => example.id);
  [order[index], order[index + (direction === "up" ? -1 : 1)]] = [other.id, id];
  for (const [position, exampleId] of order.entries()) {
    const { error } = await client.from("voice_examples").update({ position, updated_at: new Date().toISOString() }).eq("id", exampleId);
    check(error, "Voice example move");
  }
}

export type ColumnStudio = {
  examples: VoiceExampleRow[];
  rotation: { id: string; title: string }[];
  tests: AdminEditionRow[];
  testsToday: number;
};

/** Voice examples, the approved editions rotating into [B], and recent test drafts. */
export async function readColumnStudio(client: SupabaseClient, now: Date): Promise<ColumnStudio> {
  const today = `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;
  const [examples, rotation, tests, ledger] = await Promise.all([
    listVoiceExamples(client),
    approvedEditions(client),
    client.from("editorials").select(ADMIN_EDITORIAL_COLUMNS).eq("is_test", true).order("created_at", { ascending: false }).limit(10),
    client.from("editorial_ai_spend").select("id").eq("operation", "test_writer").gte("created_at", today),
  ]);
  check(tests.error, "Test drafts read");
  check(ledger.error, "Ledger read");
  return {
    examples,
    rotation: rotation.map((edition) => ({ id: edition.id, title: edition.title })),
    tests: (tests.data ?? []) as unknown as AdminEditionRow[],
    testsToday: (ledger.data ?? []).length,
  };
}
