import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";
import { CURRENT_PATCH_TAG } from "@/lib/cacheTags";
import { CURRENT_PATCH, PATCH_VERSIONS } from "@/lib/constants";
import {
  fetchLatestOfficialPatchNote,
  OFFICIAL_NOTICE_DETAIL_URL,
  type OfficialPatchFetchLike,
  type OfficialPatchNote,
} from "@/lib/officialPatch";
import { createServiceClient, hasSupabaseServiceConfig } from "@/lib/supabase";

export { CURRENT_PATCH_TAG, PUBLIC_DASHBOARD_TAG, PUBLIC_ISSUES_TAG } from "@/lib/cacheTags";

export type CurrentPatchMetadata = {
  version: string;
  title: string;
  officialUrl: string;
  publishedAt: string | null;
  summary: string | null;
  source: "official" | "fallback";
};

type OfficialPatchRow = {
  board_no: string;
  title: string;
  patch_version: string;
  official_url: string;
  published_at: string | null;
  summary: string | null;
  is_current: boolean;
};

type SyncOfficialPatchResult =
  | { status: "synced"; changed: boolean; patch: CurrentPatchMetadata }
  | { status: "skipped"; reason: "not_found"; patch: CurrentPatchMetadata };

export function fallbackCurrentPatchMetadata(): CurrentPatchMetadata {
  return {
    version: CURRENT_PATCH,
    title: `Patch Notes Version ${CURRENT_PATCH}`,
    officialUrl: `${OFFICIAL_NOTICE_DETAIL_URL}?_boardNo=105`,
    publishedAt: null,
    summary: null,
    source: "fallback",
  };
}

function rowToCurrent(row: OfficialPatchRow): CurrentPatchMetadata {
  return {
    version: row.patch_version,
    title: row.title,
    officialUrl: row.official_url,
    publishedAt: row.published_at,
    summary: row.summary,
    source: "official",
  };
}

function noteToCurrent(note: OfficialPatchNote): CurrentPatchMetadata {
  return {
    version: note.patchVersion,
    title: note.title,
    officialUrl: note.officialUrl,
    publishedAt: note.publishedAt,
    summary: note.summary,
    source: "official",
  };
}

async function readCurrentPatchUncached(supabase: SupabaseClient): Promise<CurrentPatchMetadata> {
  try {
    const { data, error } = await supabase
      .from("official_patch_notes")
      .select("board_no, title, patch_version, official_url, published_at, summary, is_current")
      .eq("is_current", true)
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(1);
    if (error) return fallbackCurrentPatchMetadata();
    const row = ((data ?? []) as OfficialPatchRow[])[0];
    return row ? rowToCurrent(row) : fallbackCurrentPatchMetadata();
  } catch {
    return fallbackCurrentPatchMetadata();
  }
}

export const getCachedCurrentPatchMetadata = unstable_cache(
  async () =>
    hasSupabaseServiceConfig() ? readCurrentPatchUncached(createServiceClient()) : fallbackCurrentPatchMetadata(),
  ["current-patch-metadata"],
  { revalidate: 300, tags: [CURRENT_PATCH_TAG] },
);

export function getCurrentPatchMetadata(supabase?: SupabaseClient): Promise<CurrentPatchMetadata> {
  return supabase ? readCurrentPatchUncached(supabase) : getCachedCurrentPatchMetadata();
}

export function patchVersionOptions(currentVersion: string): string[] {
  return [currentVersion, ...PATCH_VERSIONS].filter((patch, index, all) => all.indexOf(patch) === index);
}

export async function syncOfficialPatchNote(
  supabase: SupabaseClient = createServiceClient(),
  options: { now?: Date; fetcher?: OfficialPatchFetchLike } = {},
): Promise<SyncOfficialPatchResult> {
  const existing = await readCurrentPatchUncached(supabase);
  const note = await fetchLatestOfficialPatchNote({ fetcher: options.fetcher });
  if (!note) return { status: "skipped", reason: "not_found", patch: existing };

  const observedAt = (options.now ?? new Date()).toISOString();
  const changed = existing.source !== "official" || existing.version !== note.patchVersion || existing.officialUrl !== note.officialUrl;

  const { error: clearError } = await supabase.from("official_patch_notes").update({ is_current: false }).eq("is_current", true);
  if (clearError) throw new Error(`official patch clear failed: ${clearError.message}`);

  const { error: upsertError } = await supabase.from("official_patch_notes").upsert(
    {
      board_no: note.boardNo,
      title: note.title,
      patch_version: note.patchVersion,
      official_url: note.officialUrl,
      published_at: note.publishedAt,
      summary: note.summary,
      observed_at: observedAt,
      is_current: true,
    },
    { onConflict: "board_no" },
  );
  if (upsertError) throw new Error(`official patch upsert failed: ${upsertError.message}`);

  return { status: "synced", changed, patch: noteToCurrent(note) };
}
