import "server-only";

import { cache } from "react";
import { summarizeBoardWatch, type BoardWatchSummary } from "@/lib/boardWatch";
import { isCurrentPatchVerified } from "@/lib/patchWatch";
import { createServiceClient, hasSupabaseServiceConfig } from "@/lib/supabase";

const PAGE_SIZE = 1000;
const MAX_PAGES = 10;

type WatchPatch = { version: string; publishedAt: string | null; source?: string };

export async function readBoardWatchSummary(
  supabase: ReturnType<typeof createServiceClient>,
  currentPatch: WatchPatch,
): Promise<BoardWatchSummary | null> {
  if (!isCurrentPatchVerified(currentPatch) || !currentPatch.publishedAt) return null;
  const rows: { category?: unknown; cluster_id?: unknown }[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await supabase
      .from("source_signals")
      .select("id, category, cluster_id")
      .eq("source_domain", "steamcommunity.com")
      .neq("public_status", "hidden")
      .gte("first_seen_at", currentPatch.publishedAt)
      .order("id")
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (error) throw new Error(`Board watch read failed: ${error.message}`);
    const pageRows = (data ?? []) as { category?: unknown; cluster_id?: unknown }[];
    rows.push(...pageRows);
    if (pageRows.length < PAGE_SIZE) return summarizeBoardWatch(rows, currentPatch.version);
  }
  // More rows than the guard allows would be undercounted; show nothing rather than a wrong figure.
  throw new Error("Board watch read exceeded its page guard");
}

/** Null means unavailable: the board then keeps its plain message instead of showing zeros. */
export const getBoardWatchSummary = cache(async (
  currentPatch: WatchPatch,
): Promise<BoardWatchSummary | null> => {
  if (!hasSupabaseServiceConfig()) return null;
  try {
    return await readBoardWatchSummary(createServiceClient(), currentPatch);
  } catch {
    return null;
  }
});
