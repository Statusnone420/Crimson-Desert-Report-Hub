import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { COLUMN_SETTINGS_KEY, normalizeColumnSettings, type ColumnSettings } from "@/lib/editorials/settings";
import { isMissingSupabaseRpc } from "@/lib/supabaseCompatibility";

/** The column's RPCs or tables are not in this database yet (a deploy ahead of its migration). */
export class ColumnNotSetUpError extends Error {
  constructor() {
    super("The column's database update has not been applied yet.");
    this.name = "ColumnNotSetUpError";
  }
}

export type StoredColumnSettings = { settings: ColumnSettings; updatedAt: string | null };

/** Reads only the 'column' key. A missing key means the defaults; a failed read throws. */
export async function readColumnSettings(client: SupabaseClient): Promise<StoredColumnSettings> {
  const { data, error } = await client
    .from("automation_settings")
    .select("value, updated_at")
    .eq("key", COLUMN_SETTINGS_KEY)
    .limit(1);
  if (error) throw new Error("Column settings are unavailable.");
  const row = (data?.[0] ?? null) as { value: unknown; updated_at: string | null } | null;
  return { settings: normalizeColumnSettings(row?.value), updatedAt: row?.updated_at ?? null };
}

/** Merges only the given top-level keys, so concurrent writers keep each other's keys. */
export async function mergeColumnSettings(client: SupabaseClient, patch: Partial<ColumnSettings>): Promise<ColumnSettings> {
  const { data, error } = await client.rpc("editorial_settings_merge", { p_patch: patch });
  if (isMissingSupabaseRpc(error, "editorial_settings_merge")) throw new ColumnNotSetUpError();
  if (error) throw new Error("Column settings could not be saved.");
  return normalizeColumnSettings(data);
}
