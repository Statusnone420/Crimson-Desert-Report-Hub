export type SupabaseErrorLike = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

function errorText(error: SupabaseErrorLike | null | undefined): string {
  return [error?.message, error?.details, error?.hint].filter(Boolean).join(" ");
}

/** Match only the rolling-deploy case where PostgREST cannot see one new column yet. */
export function isMissingSupabaseColumn(
  error: SupabaseErrorLike | null | undefined,
  table: string,
  column: string,
): boolean {
  const text = errorText(error);
  if (!text.toLowerCase().includes(table.toLowerCase()) || !text.toLowerCase().includes(column.toLowerCase())) {
    return false;
  }
  return (
    error?.code === "PGRST204" ||
    error?.code === "42703" ||
    /(?:does not exist|not found|schema cache|could not find)/i.test(text)
  );
}

/** Match only a relation introduced by a migration that has not reached the database yet. */
export function isMissingSupabaseRelation(
  error: SupabaseErrorLike | null | undefined,
  relation: string,
): boolean {
  const text = errorText(error);
  if (!text.toLowerCase().includes(relation.toLowerCase())) return false;
  return (
    error?.code === "PGRST205" ||
    error?.code === "42P01" ||
    /(?:does not exist|not found|schema cache|could not find)/i.test(text)
  );
}

/** Match a missing or stale PostgREST RPC signature without swallowing runtime RPC failures. */
export function isMissingSupabaseRpc(
  error: SupabaseErrorLike | null | undefined,
  functionName: string,
): boolean {
  const text = errorText(error);
  if (!text.toLowerCase().includes(functionName.toLowerCase())) return false;
  return (
    error?.code === "PGRST202" ||
    error?.code === "42883" ||
    /(?:does not exist|not found|schema cache|could not find)/i.test(text)
  );
}
