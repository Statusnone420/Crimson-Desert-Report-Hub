/**
 * The one public visibility rule for editions, used by the page, the feeds and the
 * sitemap: held or published, its publish time has passed, never vetoed, never a test.
 * A held edition with no publish time is waiting for approval and stays hidden.
 */
export const VISIBLE_EDITORIAL_STATUSES = ["held", "published"] as const;

export type VisibilityFields = {
  status: string;
  publish_at: string | null;
  vetoed_at: string | null;
  is_test: boolean;
};

export function isEditorialVisible(row: VisibilityFields, now: Date): boolean {
  if (!(VISIBLE_EDITORIAL_STATUSES as readonly string[]).includes(row.status)) return false;
  if (row.is_test || row.vetoed_at !== null || row.publish_at === null) return false;
  const publishAt = Date.parse(row.publish_at);
  return Number.isFinite(publishAt) && publishAt <= now.getTime();
}

type FilterableQuery = {
  in(column: string, values: readonly string[]): FilterableQuery;
  lte(column: string, value: string): FilterableQuery;
  is(column: string, value: null): FilterableQuery;
  eq(column: string, value: boolean): FilterableQuery;
};

/**
 * The same rule as a PostgREST filter, so the database returns only visible rows.
 * The query is typed structurally: supabase-js's builder generics are too deep for
 * TypeScript to check through a shared helper, and these four filters keep its type.
 */
export function whereEditorialVisible<Q extends object>(query: Q, now: Date): Q {
  return (query as unknown as FilterableQuery)
    .in("status", VISIBLE_EDITORIAL_STATUSES)
    .lte("publish_at", now.toISOString())
    .is("vetoed_at", null)
    .eq("is_test", false) as unknown as Q;
}
