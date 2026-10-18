import "server-only";

import { cache } from "react";
import { steamForumTopicId } from "@/lib/automation/steamForum";
import { summarizeBoardWatch, type BoardWatchRead, type BoardWatchSummary } from "@/lib/boardWatch";
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
  const threadIds = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await supabase
      .from("source_signals")
      .select("id, category, cluster_id, canonical_url")
      .eq("source_domain", "steamcommunity.com")
      .neq("public_status", "hidden")
      // A row kept without a cluster (a junk title, say) is not a watched topic.
      .not("cluster_id", "is", null)
      .gte("first_seen_at", currentPatch.publishedAt)
      .order("id")
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (error) throw new Error(`Board watch read failed: ${error.message}`);
    const pageRows = (data ?? []) as { category?: unknown; cluster_id?: unknown; canonical_url?: unknown }[];
    for (const row of pageRows) {
      // Pages call these Steam forum threads, so a guide or another game's page on the domain is
      // not counted, and a thread also stored under one of its comment pages counts once.
      const threadId = steamForumTopicId(row.canonical_url);
      if (threadId === null || threadIds.has(threadId)) continue;
      threadIds.add(threadId);
      rows.push(row);
    }
    if (pageRows.length < PAGE_SIZE) return summarizeBoardWatch(rows, currentPatch.version);
  }
  // More rows than the guard allows would be undercounted; show nothing rather than a wrong figure.
  throw new Error("Board watch read exceeded its page guard");
}

/**
 * Null when there is no verified patch to count against. A failed read is
 * "unavailable", so pages say the counts could not be read instead of hiding them.
 */
export const getBoardWatchSummary = cache(async (
  currentPatch: WatchPatch,
): Promise<BoardWatchRead> => {
  if (!isCurrentPatchVerified(currentPatch) || !currentPatch.publishedAt) return null;
  if (!hasSupabaseServiceConfig()) return "unavailable";
  try {
    return await readBoardWatchSummary(createServiceClient(), currentPatch);
  } catch {
    return "unavailable";
  }
});
