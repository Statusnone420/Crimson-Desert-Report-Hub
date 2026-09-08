"use server";

import { revalidatePath } from "next/cache";
import { moderateReport } from "@/app/admin/actions";
import { requireAdmin } from "@/lib/adminGuard";
import { assertProductionWriteAllowed } from "@/lib/previewGuard";
import type { ReportReviewActionState } from "@/lib/reportReviewAction";
import { createServiceClient } from "@/lib/supabase";
import { isMissingSupabaseRpc } from "@/lib/supabaseCompatibility";
import { revalidatePublicSurfaces } from "@/lib/revalidate";

export async function reviewReport(
  _previous: ReportReviewActionState, formData: FormData,
): Promise<ReportReviewActionState> {
  await requireAdmin();
  assertProductionWriteAllowed();
  const reportId = String(formData.get("id") ?? "");
  try {
    formData.set("expected_status", "pending");
    await moderateReport(formData);
    revalidatePath("/operator");
    return { status: "saved", message: "Report decision saved.", reportId };
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "Error" || ("digest" in error && String(error.digest).startsWith("NEXT_"))) throw error;
    if (error instanceof Error && error.message.startsWith("approved excerpt insert failed:")) {
      revalidatePath("/operator");
      revalidatePath("/admin");
      revalidatePublicSurfaces();
      return { status: "approved_excerpt_pending", message: "The report was approved, but its excerpt was not saved. Retry only the excerpt below.", reportId };
    }
    if (error.message === "stale report decision") return { status: "stale", message: "This report was already decided elsewhere. Your excerpt is still here; reload the current queue before deciding again.", reportId };
    return { status: "error", message: "The report decision could not be saved. Your entries are still here. Refresh before retrying if the connection was interrupted.", reportId };
  }
}

export async function retryApprovedExcerpt(
  _previous: ReportReviewActionState, formData: FormData,
): Promise<ReportReviewActionState> {
  await requireAdmin();
  assertProductionWriteAllowed();
  const reportId = String(formData.get("id") ?? "");
  const excerpt = String(formData.get("excerpt") ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reportId) || !excerpt || excerpt.length > 500) {
    return { status: "approved_excerpt_pending", message: "Enter an excerpt between 1 and 500 characters. The report is already approved.", reportId };
  }
  const { error } = await createServiceClient().rpc("save_approved_report_excerpt", { p_report_id: reportId, p_excerpt: excerpt });
  if (error) return {
    status: "approved_excerpt_pending", reportId,
    message: isMissingSupabaseRpc(error, "save_approved_report_excerpt")
      ? "Safe excerpt retry is unavailable until the database update is applied. The report remains approved."
      : "The excerpt could not be saved. The report remains approved; keep this draft and retry when the connection is available.",
  };
  revalidatePath("/operator");
  revalidatePath("/admin");
  revalidatePublicSurfaces();
  return { status: "saved", message: "This report has a saved excerpt. The first saved text is kept; approval was not repeated.", reportId };
}
