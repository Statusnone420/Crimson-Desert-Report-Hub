"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/adminGuard";
import { ColumnNotSetUpError, mergeColumnSettings, readColumnSettings } from "@/lib/editorials/settings.server";
import { burstFromForm, cadenceFromForm } from "@/lib/editorials/settingsForm";
import { MAX_BURSTS } from "@/lib/editorials/settings";
import { assertProductionWriteAllowed } from "@/lib/previewGuard";
import { revalidateEditorials } from "@/lib/revalidate";
import { createServiceClient } from "@/lib/supabase";
import { isMissingSupabaseRpc } from "@/lib/supabaseCompatibility";
import type { ColumnNotice } from "@/lib/editorials/notices";
import { addStyleNote, deleteVoiceExample, moveVoiceExample, saveVoiceExample } from "@/lib/editorials/feedback.server";
import { styleNoteFromForm, voiceExampleFromForm } from "@/lib/editorials/feedbackForm";
import { isWriterEffort, isWriterModel } from "@/lib/editorials/models";
import { generateTestDraft } from "@/lib/editorials/testDraft.server";
import { currentWeekSlot } from "@/lib/editorials/cadence";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function editionId(formData: FormData): string {
  const id = formData.get("id");
  if (typeof id !== "string" || !UUID.test(id)) throw new Error("That edition could not be found.");
  return id;
}

function backToColumn(notice: ColumnNotice): never {
  revalidatePath("/operator");
  redirect(`/operator?view=column&notice=${notice}`);
}

function backToEdition(id: string, notice: ColumnNotice): never {
  revalidatePath("/operator");
  redirect(`/operator?view=column&edition=${id}&notice=${notice}`);
}

const PUBLISH_REFUSALS: Partial<Record<string, ColumnNotice>> = {
  not_promotable: "publish_not_promotable",
  not_approved: "publish_not_approved",
  slot_taken: "publish_slot_taken",
  slot_busy: "publish_slot_busy",
};

/** Pause is the column's off switch. It never touches the scanner's settings. */
export async function setColumnPaused(formData: FormData) {
  await requireAdmin();
  assertProductionWriteAllowed();
  const value = formData.get("paused");
  if (value !== "true" && value !== "false") throw new Error("Choose pause or resume.");
  await mergeColumnSettings(createServiceClient(), { paused: value === "true" });
  backToColumn(value === "true" ? "paused" : "resumed");
}

/** Veto before publication, or unpublish after it. Either way the edition leaves every public surface. */
export async function vetoEdition(formData: FormData) {
  await requireAdmin();
  assertProductionWriteAllowed();
  const id = editionId(formData);
  const now = new Date().toISOString();
  const { data, error } = await createServiceClient().from("editorials")
    .update({ status: "vetoed", vetoed_at: now, updated_at: now })
    .eq("id", id)
    .in("status", ["held", "published"])
    .select("id");
  if (error) throw new Error("The edition could not be vetoed. Nothing changed.");
  if (!data?.length) backToColumn("not_vetoable");
  revalidateEditorials();
  backToColumn("vetoed");
}

/** Publishes an approve-first edition now and counts one approval down. */
export async function approveEdition(formData: FormData) {
  await requireAdmin();
  assertProductionWriteAllowed();
  const id = editionId(formData);
  const { data, error } = await createServiceClient().rpc("editorial_approve", { p_id: id });
  if (isMissingSupabaseRpc(error, "editorial_approve")) throw new ColumnNotSetUpError();
  if (error) throw new Error("The edition could not be approved. Nothing changed.");
  if (data !== "approved") backToColumn("not_pending");
  revalidateEditorials();
  backToColumn("approved");
}

/**
 * Publishes an approved test draft now as this week's edition, in place of the slot's skip.
 * The database function checks the draft, its thumbs up and the slot in one transaction.
 */
export async function publishTestDraft(formData: FormData) {
  await requireAdmin();
  assertProductionWriteAllowed();
  const id = editionId(formData);
  if (formData.get("confirm") !== "yes") backToEdition(id, "publish_confirm");
  const client = createServiceClient();
  const slot = currentWeekSlot((await readColumnSettings(client)).settings, new Date());
  if (!slot) backToEdition(id, "publish_no_slot");
  // Publish only into the slot the page showed.
  if (formData.get("slotKey") !== slot.key) backToEdition(id, "publish_slot_changed");
  const { data, error } = await client.rpc("editorial_promote_test", { p_id: id, p_slot_key: slot.key });
  if (isMissingSupabaseRpc(error, "editorial_promote_test")) backToEdition(id, "publish_unavailable");
  if (error) throw new Error("The test draft could not be published. Nothing changed.");
  if (data !== "promoted") {
    const refusal = typeof data === "string" ? PUBLISH_REFUSALS[data] : undefined;
    if (!refusal) throw new Error("The test draft could not be published. Nothing changed.");
    backToEdition(id, refusal);
  }
  revalidateEditorials();
  backToEdition(id, "draft_published");
}

/** The cadence dials and the provider switch. Only these keys are written. */
export async function saveColumnCadence(formData: FormData) {
  await requireAdmin();
  assertProductionWriteAllowed();
  const parsed = cadenceFromForm(formData);
  if (!parsed.ok) backToColumn(parsed.error);
  await mergeColumnSettings(createServiceClient(), parsed.value);
  backToColumn("settings_saved");
}

/** Adds a burst, or replaces the one with the same id. */
export async function saveColumnBurst(formData: FormData) {
  await requireAdmin();
  assertProductionWriteAllowed();
  const client = createServiceClient();
  const { settings } = await readColumnSettings(client);
  // The stored bursts let "keep" hold on to a model the allowlist no longer knows.
  const parsed = burstFromForm(formData, settings.bursts);
  if (!parsed.ok) backToColumn(parsed.error);
  const exists = settings.bursts.some((burst) => burst.id === parsed.value.id);
  if (!exists && settings.bursts.length >= MAX_BURSTS) backToColumn("invalid_value");
  const bursts = exists
    ? settings.bursts.map((burst) => (burst.id === parsed.value.id ? parsed.value : burst))
    : [...settings.bursts, parsed.value];
  await mergeColumnSettings(client, { bursts });
  backToColumn("burst_saved");
}

export async function deleteColumnBurst(formData: FormData) {
  await requireAdmin();
  assertProductionWriteAllowed();
  const id = formData.get("id");
  const client = createServiceClient();
  const { settings } = await readColumnSettings(client);
  if (typeof id !== "string" || !settings.bursts.some((burst) => burst.id === id)) backToColumn("burst_missing");
  await mergeColumnSettings(client, { bursts: settings.bursts.filter((burst) => burst.id !== id) });
  backToColumn("burst_deleted");
}

/** A thumbs up or down and an optional note, for one edition or the column as a whole. */
export async function saveStyleNote(formData: FormData) {
  await requireAdmin();
  assertProductionWriteAllowed();
  const input = styleNoteFromForm(formData);
  if (!input) backToColumn("note_invalid");
  await addStyleNote(createServiceClient(), input);
  if (input.editorialId) {
    revalidatePath("/operator");
    redirect(`/operator?view=column&edition=${input.editorialId}&notice=note_saved`);
  }
  backToColumn("note_saved");
}

export async function saveVoiceExampleAction(formData: FormData) {
  await requireAdmin();
  assertProductionWriteAllowed();
  const input = voiceExampleFromForm(formData);
  if (!input) backToColumn("example_invalid");
  const result = await saveVoiceExample(createServiceClient(), input);
  backToColumn(result === "saved" ? "example_saved" : result === "full" ? "examples_full" : "example_missing");
}

export async function deleteVoiceExampleAction(formData: FormData) {
  await requireAdmin();
  assertProductionWriteAllowed();
  const id = formData.get("id");
  if (typeof id !== "string" || !UUID.test(id)) backToColumn("example_missing");
  await deleteVoiceExample(createServiceClient(), id);
  backToColumn("example_deleted");
}

export async function moveVoiceExampleAction(formData: FormData) {
  await requireAdmin();
  assertProductionWriteAllowed();
  const id = formData.get("id");
  const direction = formData.get("direction");
  if (typeof id !== "string" || !UUID.test(id) || (direction !== "up" && direction !== "down")) backToColumn("example_missing");
  const result = await moveVoiceExample(createServiceClient(), id, direction);
  backToColumn(result === "moved" ? "example_moved" : result === "missing" ? "example_missing" : "examples_changed");
}

/** One A/B test draft on the newest fact pack, charged to the column budget, ten per UTC day. */
export async function generateTestDraftAction(formData: FormData) {
  // The page's maxDuration counts from here, so the draft's deadline does too.
  const startedAtMs = Date.now();
  await requireAdmin();
  assertProductionWriteAllowed();
  const model = formData.get("model");
  const effort = formData.get("effort");
  if (!isWriterModel(model) || !isWriterEffort(effort)) backToColumn("test_invalid");
  const outcome = await generateTestDraft({ client: createServiceClient(), now: new Date(), model, effort, startedAtMs });
  backToColumn(outcome.status === "saved" ? "test_saved" : outcome.status === "daily_cap" ? "test_cap" : "test_skipped");
}
