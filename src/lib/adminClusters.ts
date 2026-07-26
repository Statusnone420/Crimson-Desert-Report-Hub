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

/** Rows requested per page; the hosted API may return fewer than asked for. */
const DEFAULT_PAGE_SIZE = 1000;

/**
 * Page one projection to completion using `id` as a keyset cursor. `id` is
 * unique and never rewritten, so concurrent automation writes cannot shift a
 * row across a page boundary the way an offset window would — no cluster is
 * skipped or read twice mid-read. A truncated read would hide forced-visibility
 * rows (losing their only Reset control) and lifecycle exceptions (letting
 * Needs you render a false green zero), so a short page is NOT treated as the
 * end: the hosted row cap is configurable and may be below pageSize. Only an
 * empty page ends the walk.
 */
async function readAllClusterPages<Row extends { id: string }>(
  supabase: ReturnType<typeof createServiceClient>,
  columns: string,
  pageSize: number,
): Promise<{ rows: Row[] } | { error: { message: string; code?: string } }> {
  const rows: Row[] = [];
  let after: string | null = null;
  for (;;) {
    // Filters must precede the transforms: .order()/.limit() return a
    // transform builder that no longer exposes .gt().
    const filtered = supabase.from("issue_clusters").select(columns);
    const page = await (after === null ? filtered : filtered.gt("id", after)).order("id").limit(pageSize);
    if (page.error) return { error: page.error };
    const pageRows = (page.data ?? []) as unknown as Row[];
    if (pageRows.length === 0) return { rows };
    rows.push(...pageRows);
    after = pageRows[pageRows.length - 1].id;
  }
}

/** Display order for the operator ledgers: title, then id as the tiebreak. */
function byTitleThenId(a: AdminClusterRow, b: AdminClusterRow): number {
  return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
}

export async function readAdminClusters(
  supabase: ReturnType<typeof createServiceClient>,
  pageSize = DEFAULT_PAGE_SIZE,
): Promise<AdminClusterRow[]> {
  const current = await readAllClusterPages<AdminClusterRow>(supabase, CURRENT_COLUMNS, pageSize);
  if (!("error" in current)) return current.rows.sort(byTitleThenId);
  if (
    !isMissingSupabaseColumn(current.error, "issue_clusters", "admin_visibility_reason") &&
    !isMissingSupabaseColumn(current.error, "issue_clusters", "admin_visibility_changed_at")
  ) {
    throw new Error(`admin clusters read failed: ${current.error.message}`);
  }

  // Preview environments can render this branch before its migration is applied.
  // Keep the operator queue usable with the legacy columns; audit metadata appears
  // as unavailable until the migration lands.
  const legacy = await readAllClusterPages<
    Omit<AdminClusterRow, "admin_visibility_reason" | "admin_visibility_changed_at">
  >(supabase, LEGACY_COLUMNS, pageSize);
  if ("error" in legacy) throw new Error(`admin clusters legacy read failed: ${legacy.error.message}`);
  return legacy.rows
    .map((cluster) => ({ ...cluster, admin_visibility_reason: null, admin_visibility_changed_at: null }))
    .sort(byTitleThenId);
}
