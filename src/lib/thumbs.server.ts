import "server-only";
import type { createServiceClient } from "./supabase";
import { isMissingSupabaseRelation } from "./supabaseCompatibility";
import type { ThumbTally } from "./thumbs";

type Client = ReturnType<typeof createServiceClient>;

/**
 * Up and down totals per topic on one exact patch. The table holds one row per
 * network, so a row is a network. Only these totals leave the server read, and
 * only to rank the board; no page or response shows them.
 */
export async function readThumbTallies(supabase: Client, patchVersion: string): Promise<{
  byCluster: Record<string, ThumbTally>;
  available: boolean;
}> {
  const byCluster: Record<string, ThumbTally> = {};
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from("issue_thumbs")
      .select("id, cluster_id, direction")
      .eq("patch_version", patchVersion)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) {
      // Before the migration is applied the board ranks without thumbs.
      if (isMissingSupabaseRelation(error, "issue_thumbs")) return { byCluster: {}, available: false };
      throw new Error(`thumbs read failed: ${error.message}`);
    }
    const rows = (data ?? []) as { cluster_id: string; direction: string }[];
    for (const row of rows) {
      const tally = (byCluster[row.cluster_id] ??= { up: 0, down: 0 });
      if (row.direction === "up") tally.up += 1;
      else if (row.direction === "down") tally.down += 1;
    }
    if (rows.length < pageSize) return { byCluster, available: true };
  }
}
