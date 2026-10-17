import "server-only";
import { CONFIRMATION_KINDS, parseCheckinCounts, type CheckinCounts, type ConfirmationRow } from "./confirmations";
import type { createServiceClient } from "./supabase";
import { isMissingSupabaseRelation } from "./supabaseCompatibility";

type Client = ReturnType<typeof createServiceClient>;

/** Only aggregate counts for the successful saving request; no topic data or identities. */
export async function readCheckinCounts(supabase: Client, clusterId: string, patchVersion: string): Promise<CheckinCounts> {
  const { data: clusters, error: clusterError } = await supabase.from("issue_clusters")
    .select("is_public, fix_claimed_at, fix_claimed_patch_version").eq("id", clusterId).limit(1);
  const cluster = clusters?.[0];
  if (clusterError || !cluster?.is_public) throw new Error("Saved check-in totals could not be read.");
  // Match the public board: poll answers count only at or after the current
  // claim date; the overall total includes every exact-patch response.
  const claimedAt = cluster.fix_claimed_patch_version === patchVersion ? cluster.fix_claimed_at : null;
  const keys = [...CONFIRMATION_KINDS, "totalCount"] as const;
  const requested = keys.filter((kind) => claimedAt || (kind !== "fixed_for_me" && kind !== "still_happening"));
  // Supabase's documented embedded count syntax uses one SQL statement and
  // one snapshot. It returns five numbers, never the underlying ledger rows.
  let query = supabase.from("issue_clusters")
    .select(["fix_claimed_at", "fix_claimed_patch_version", ...requested.map((kind) => `${kind}:issue_checkins(count)`)].join(","))
    .eq("id", clusterId).eq("is_public", true).limit(1);
  for (const kind of requested) {
    query = query.eq(`${kind}.patch_version`, patchVersion);
    if (kind !== "totalCount") query = query.eq(`${kind}.kind`, kind);
    if (kind === "fixed_for_me" || kind === "still_happening") query = query.gte(`${kind}.created_at`, claimedAt);
  }
  const { data, error } = await query;
  const snapshot = data?.[0] as Record<string, unknown> | undefined;
  // Claim timing was needed to build the filters. If it changed, decline the
  // receipt totals rather than combine counts with an obsolete claim boundary.
  if (error || !snapshot || snapshot.fix_claimed_at !== cluster.fix_claimed_at || snapshot.fix_claimed_patch_version !== cluster.fix_claimed_patch_version) throw new Error("Saved check-in totals could not be read.");
  const counts = parseCheckinCounts(Object.fromEntries(keys.map((kind) => {
    if (!requested.includes(kind)) return [kind, 0];
    const aggregate = snapshot[kind];
    return [kind, Array.isArray(aggregate) && aggregate.length === 1 ? aggregate[0]?.count : null];
  })));
  if (!counts) throw new Error("Saved check-in totals could not be read.");
  return counts;
}

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
