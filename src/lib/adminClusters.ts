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

const CURRENT_COLUMNS =
  "id, title, fix_status, admin_override, lifecycle_reason, admin_visibility_override, admin_visibility_reason, admin_visibility_changed_at, is_public";
const LEGACY_COLUMNS = "id, title, fix_status, admin_override, lifecycle_reason, admin_visibility_override, is_public";

/** The hosted API silently caps one select at this many rows. */
const DEFAULT_PAGE_SIZE = 1000;

/**
 * Page one projection to completion in stable title, id order. A truncated
 * read here would hide forced-visibility rows (losing their only Reset
 * control) and lifecycle exceptions (letting Needs you render a false green
 * zero), so every page must arrive before the queue renders.
 */
async function readAllClusterPages<Row>(
  supabase: ReturnType<typeof createServiceClient>,
  columns: string,
  pageSize: number,
): Promise<{ rows: Row[] } | { error: { message: string; code?: string } }> {
  const rows: Row[] = [];
  for (let from = 0; ; from += pageSize) {
    const page = await supabase
      .from("issue_clusters")
      .select(columns)
      .order("title")
      .order("id")
      .range(from, from + pageSize - 1);
    if (page.error) return { error: page.error };
    const pageRows = (page.data ?? []) as Row[];
    rows.push(...pageRows);
    if (pageRows.length < pageSize) return { rows };
  }
}

export async function readAdminClusters(
  supabase: ReturnType<typeof createServiceClient>,
  pageSize = DEFAULT_PAGE_SIZE,
): Promise<AdminClusterRow[]> {
  const current = await readAllClusterPages<AdminClusterRow>(supabase, CURRENT_COLUMNS, pageSize);
  if (!("error" in current)) return current.rows;
  if (
    !isMissingSupabaseColumn(current.error, "issue_clusters", "admin_visibility_reason") &&
    !isMissingSupabaseColumn(current.error, "issue_clusters", "admin_visibility_changed_at")
  ) {
    throw new Error(`admin clusters read failed: ${current.error.message}`);
  }

  // Preview environments can render this branch before its migration is applied.
  // Keep the operator queue usable with the legacy columns; audit metadata appears
  // as unavailable until the migration lands.
  const legacy = await readAllClusterPages<Omit<AdminClusterRow, "admin_visibility_reason" | "admin_visibility_changed_at">>(
    supabase,
    LEGACY_COLUMNS,
    pageSize,
  );
  if ("error" in legacy) throw new Error(`admin clusters legacy read failed: ${legacy.error.message}`);
  return legacy.rows.map((cluster) => ({
    ...cluster,
    admin_visibility_reason: null,
    admin_visibility_changed_at: null,
  }));
}
