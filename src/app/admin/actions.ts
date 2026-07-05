"use server";

import { revalidatePath } from "next/cache";
import { FIX_STATUSES } from "@/lib/constants";
import { requireAdmin } from "@/lib/adminGuard";
import { createServiceClient } from "@/lib/supabase";

const DECISIONS = ["approved", "rejected", "spam"] as const;

export async function moderateReport(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const clusterId = String(formData.get("cluster_id") ?? "");
  const excerpt = String(formData.get("excerpt") ?? "").trim();
  if (!id || !(DECISIONS as readonly string[]).includes(decision)) throw new Error("bad input");

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("bug_reports")
    .update({ moderation_status: decision, cluster_id: clusterId || null })
    .eq("id", id);
  if (error) throw new Error(error.message);

  if (decision === "approved" && excerpt) {
    await supabase.from("approved_excerpts").insert({ report_id: id, excerpt_text: excerpt.slice(0, 500) });
  }

  revalidatePath("/admin");
  revalidatePath("/");
  revalidatePath("/issues");
}

export async function setClusterFixStatus(formData: FormData): Promise<void> {
  await requireAdmin();
  const clusterId = String(formData.get("cluster_id") ?? "");
  const fixStatus = String(formData.get("fix_status") ?? "");
  if (!clusterId || !(FIX_STATUSES as readonly string[]).includes(fixStatus)) throw new Error("bad input");

  const supabase = createServiceClient();
  const { error } = await supabase.from("issue_clusters").update({ fix_status: fixStatus }).eq("id", clusterId);
  if (error) throw new Error(error.message);

  revalidatePath("/admin");
  revalidatePath("/");
  revalidatePath("/issues");
}
