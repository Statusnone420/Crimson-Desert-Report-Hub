"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/adminGuard";
import { ColumnNotSetUpError, mergeColumnSettings } from "@/lib/editorials/settings.server";
import { assertProductionWriteAllowed } from "@/lib/previewGuard";
import { revalidateEditorials } from "@/lib/revalidate";
import { createServiceClient } from "@/lib/supabase";
import { isMissingSupabaseRpc } from "@/lib/supabaseCompatibility";
import type { ColumnNotice } from "@/lib/editorials/notices";

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
