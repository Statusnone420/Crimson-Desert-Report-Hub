"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/adminGuard";
import { applyClaimReviewDecision, type ClaimReviewAction } from "@/lib/claimReview";
import type { ClaimReviewActionState } from "@/lib/claimReviewActionState";
import { assertProductionWriteAllowed } from "@/lib/previewGuard";
import { revalidatePublicSurfaces } from "@/lib/revalidate";
import { createServiceClient } from "@/lib/supabase";

export type { ClaimReviewActionState } from "@/lib/claimReviewActionState";

function formText(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
}

async function runClaimReviewAction(
  action: ClaimReviewAction,
  _previousState: ClaimReviewActionState,
  formData: FormData,
): Promise<ClaimReviewActionState> {
  await requireAdmin();
  try {
    assertProductionWriteAllowed();
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Writes are disabled.", itemId: null, revision: null };
  }
  const pairingId = formText(formData, "pairing_id");
  const revision = Number(formText(formData, "revision"));
  const reason = formText(formData, "reason");
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(pairingId) || !Number.isInteger(revision) || revision < 1 || (action === "reject" && (reason.length < 3 || reason.length > 500))) {
    return { status: "validation_error", message: action === "reject" ? "Give a reason between 3 and 500 characters." : "The review card is invalid or out of date.", itemId: pairingId || null, revision: Number.isInteger(revision) ? revision : null };
  }
  const result = await applyClaimReviewDecision(createServiceClient(), { pairingId, revision, action, reason: reason || null, actor: "admin-session" });
  if (result.status !== "success") return { status: result.status, message: result.message, itemId: pairingId, revision };
  revalidatePath("/operator");
  revalidatePath("/admin");
  revalidatePublicSurfaces();
  return { status: "success", message: "Saved.", itemId: result.item.id, revision: result.item.revision };
}

export async function confirmClaimReview(previousState: ClaimReviewActionState, formData: FormData): Promise<ClaimReviewActionState> {
  return runClaimReviewAction("confirm", previousState, formData);
}

export async function rejectClaimReview(previousState: ClaimReviewActionState, formData: FormData): Promise<ClaimReviewActionState> {
  return runClaimReviewAction("reject", previousState, formData);
}

export async function laterClaimReview(previousState: ClaimReviewActionState, formData: FormData): Promise<ClaimReviewActionState> {
  return runClaimReviewAction("later", previousState, formData);
}

export async function undoClaimReview(previousState: ClaimReviewActionState, formData: FormData): Promise<ClaimReviewActionState> {
  return runClaimReviewAction("undo", previousState, formData);
}
