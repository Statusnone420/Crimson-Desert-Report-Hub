import type { createServiceClient } from "@/lib/supabase";
import { isMissingSupabaseColumn } from "@/lib/supabaseCompatibility";

export type AdminClusterRow = {
  id: string;
  title: string;
  fix_status: string;
  admin_override: boolean | null;
  lifecycle_reason: string | null;
  admin_visibility_override: string | null;
  admin_visibility_reason: string | null;
  admin_visibility_changed_at: string | null;
  is_public: boolean;
};

export async function readAdminClusters(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<AdminClusterRow[]> {
  const current = await supabase
    .from("issue_clusters")
    .select(
      "id, title, fix_status, admin_override, lifecycle_reason, admin_visibility_override, admin_visibility_reason, admin_visibility_changed_at, is_public",
    )
    .order("title");

  if (!current.error) return (current.data ?? []) as AdminClusterRow[];
  if (
    !isMissingSupabaseColumn(current.error, "issue_clusters", "admin_visibility_reason") &&
    !isMissingSupabaseColumn(current.error, "issue_clusters", "admin_visibility_changed_at")
  ) {
    throw new Error(`admin clusters read failed: ${current.error.message}`);
  }

  // Preview environments can render this branch before its migration is applied.
  // Keep the operator queue usable with the legacy columns; audit metadata appears
  // as unavailable until the migration lands.
  const legacy = await supabase
    .from("issue_clusters")
    .select("id, title, fix_status, admin_override, lifecycle_reason, admin_visibility_override, is_public")
    .order("title");

  if (legacy.error) throw new Error(`admin clusters legacy read failed: ${legacy.error.message}`);
  return (legacy.data ?? []).map((cluster) => ({
    ...(cluster as Omit<AdminClusterRow, "admin_visibility_reason" | "admin_visibility_changed_at">),
    admin_visibility_reason: null,
    admin_visibility_changed_at: null,
  }));
}
