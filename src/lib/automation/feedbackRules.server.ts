import type { createServiceClient } from "@/lib/supabase";

/** Rows requested per page; the hosted API may return fewer than asked for. */
export const FEEDBACK_RULE_PAGE_SIZE = 1000;

type ReadFailure = { message: string; code?: string };

/**
 * Page every unrevoked scanner feedback rule newest-first, past the hosted
 * PostgREST row cap, using `(created_at, id)` as the cursor.
 *
 * `created_at` alone is not a usable cursor: rules written in one transaction
 * share a timestamp, so a tie sitting on a page boundary would either repeat or
 * disappear. An offset window is worse — a concurrent write shifts every later
 * row. The compound cursor is unique and never rewritten, so no rule is skipped
 * or read twice mid-walk. That matters in both directions: a truncated
 * enforcement read silently stops applying an older rule, and a truncated
 * operator read strands an enforced rule with no ledger recovery.
 *
 * A short page does NOT end the walk — the hosted row cap is configurable and
 * may sit below `pageSize`. Only an empty page does.
 *
 * The query excludes revoked rules only. Expiry is filtered by the callers in
 * JS against one clock so that enforcement and the operator ledger cannot
 * disagree about which rules are active.
 */
export async function readActiveFeedbackRulePages<Row extends { id: string; created_at: string }>(
  supabase: ReturnType<typeof createServiceClient>,
  columns: string,
  pageSize: number = FEEDBACK_RULE_PAGE_SIZE,
): Promise<{ rows: Row[] } | { error: ReadFailure }> {
  const rows: Row[] = [];
  let cursor: { createdAt: string; id: string } | null = null;
  for (;;) {
    // Filters must precede the transforms: .order()/.limit() return a transform
    // builder that no longer exposes .or().
    const filtered = supabase.from("scanner_feedback_rules").select(columns).is("revoked_at", null);
    const cursored =
      cursor === null
        ? filtered
        : filtered.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
    const page = await cursored
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(pageSize);
    if (page.error) return { error: page.error };
    const pageRows = (page.data ?? []) as unknown as Row[];
    if (pageRows.length === 0) return { rows };
    rows.push(...pageRows);
    const last = pageRows[pageRows.length - 1];
    cursor = { createdAt: last.created_at, id: last.id };
  }
}
