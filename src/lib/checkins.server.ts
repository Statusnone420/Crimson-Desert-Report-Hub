import "server-only";
import type { ConfirmationRow } from "./confirmations";
import type { createServiceClient } from "./supabase";
import { isMissingSupabaseRelation } from "./supabaseCompatibility";

type Client = ReturnType<typeof createServiceClient>;

/** Only exact-patch responses enter the current tally. Network hashes stay server-side. */
export async function readCheckinsForPatch(supabase: Client, patchVersion: string): Promise<{
  byCluster: Record<string, ConfirmationRow[]>;
  available: boolean;
}> {
  const byCluster: Record<string, ConfirmationRow[]> = {};
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from("issue_checkins")
      .select("id, cluster_id, platform, kind, voter_ip_hash, created_at")
      .eq("patch_version", patchVersion)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) {
      if (isMissingSupabaseRelation(error, "issue_checkins")) return { byCluster: {}, available: false };
      throw new Error(`check-ins read failed: ${error.message}`);
    }
    const rows = (data ?? []) as ConfirmationRow[];
    for (const row of rows) (byCluster[row.cluster_id] ??= []).push(row);
    if (rows.length < pageSize) return { byCluster, available: true };
  }
}

/** Retain an already-public topic with current responses; this never publishes a topic. */
export async function hasCurrentPatchCheckins(supabase: Client, clusterId: string, patchVersion: string): Promise<boolean> {
  const { data, error } = await supabase.from("issue_checkins")
    .select("id").eq("cluster_id", clusterId).eq("patch_version", patchVersion).limit(1);
  if (error) {
    if (isMissingSupabaseRelation(error, "issue_checkins")) return false;
    throw new Error(`check-in retention read failed: ${error.message}`);
  }
  return (data ?? []).length > 0;
}
