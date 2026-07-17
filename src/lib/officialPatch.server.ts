import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";
import { CURRENT_PATCH_TAG } from "@/lib/cacheTags";
import { CURRENT_PATCH } from "@/lib/constants";
import {
  fetchLatestOfficialPatchNote,
  OFFICIAL_NOTICE_DETAIL_URL,
  type OfficialPatchFetchLike,
  type OfficialPatchNote,
} from "@/lib/officialPatch";
import { classifySignal } from "@/lib/reddit";
import { createServiceClient, hasSupabaseServiceConfig } from "@/lib/supabase";

export { CURRENT_PATCH_TAG, PUBLIC_DASHBOARD_TAG, PUBLIC_ISSUES_TAG } from "@/lib/cacheTags";

export type CurrentPatchMetadata = {
  version: string;
  title: string;
  officialUrl: string;
  publishedAt: string | null;
  observedAt: string | null;
  summary: string | null;
  source: "official" | "fallback";
};

type OfficialPatchRow = {
  board_no: string;
  title: string;
  patch_version: string;
  official_url: string;
  published_at: string | null;
  observed_at: string | null;
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
    observedAt: null,
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
    observedAt: row.observed_at,
    summary: row.summary,
    source: "official",
  };
}

function noteToCurrent(note: OfficialPatchNote, observedAt: string | null): CurrentPatchMetadata {
  return {
    version: note.patchVersion,
    title: note.title,
    officialUrl: note.officialUrl,
    publishedAt: note.publishedAt,
    observedAt,
    summary: note.summary,
    source: "official",
  };
}

async function readCurrentPatchUncached(supabase: SupabaseClient): Promise<CurrentPatchMetadata> {
  try {
    const { data, error } = await supabase
      .from("official_patch_notes")
      .select("board_no, title, patch_version, official_url, published_at, observed_at, summary, is_current")
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

export function patchVersionOptions(currentVersion: string, previousVersion: string | null): string[] {
  return [currentVersion, previousVersion, "other"]
    .filter((patch): patch is string => patch !== null)
    .filter((patch, index, all) => all.indexOf(patch) === index);
}

async function readPreviousPatchVersionUncached(
  supabase: SupabaseClient,
  currentVersion: string,
): Promise<string | null> {
  try {
    // limit(5): manual-override remnants can repeat the current version, so a
    // single-row read could land on a duplicate instead of the real previous.
    const { data, error } = await supabase
      .from("official_patch_notes")
      .select("patch_version, published_at")
      .eq("is_current", false)
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(5);
    if (error) return null;
    const previous = ((data ?? []) as { patch_version: string }[]).find((row) => row.patch_version !== currentVersion);
    return previous?.patch_version ?? null;
  } catch {
    return null;
  }
}

export type ReportPatchContext = { currentPatch: CurrentPatchMetadata; patchVersions: string[] };

function fallbackReportPatchContext(): ReportPatchContext {
  const currentPatch = fallbackCurrentPatchMetadata();
  return { currentPatch, patchVersions: patchVersionOptions(currentPatch.version, null) };
}

async function readReportPatchContextUncached(supabase: SupabaseClient): Promise<ReportPatchContext> {
  const currentPatch = await readCurrentPatchUncached(supabase);
  const previousVersion = await readPreviousPatchVersionUncached(supabase, currentPatch.version);
  return { currentPatch, patchVersions: patchVersionOptions(currentPatch.version, previousVersion) };
}

const getCachedReportPatchContext = unstable_cache(
  async () =>
    hasSupabaseServiceConfig() ? readReportPatchContextUncached(createServiceClient()) : fallbackReportPatchContext(),
  ["report-patch-context"],
  { revalidate: 300, tags: [CURRENT_PATCH_TAG] },
);

export function getReportPatchContext(supabase?: SupabaseClient): Promise<ReportPatchContext> {
  return supabase ? readReportPatchContextUncached(supabase) : getCachedReportPatchContext();
}

export async function syncOfficialPatchNote(
  supabase: SupabaseClient = createServiceClient(),
  options: { now?: Date; fetcher?: OfficialPatchFetchLike } = {},
): Promise<SyncOfficialPatchResult> {
  const existing = await readCurrentPatchUncached(supabase);
  const note = await fetchLatestOfficialPatchNote({ fetcher: options.fetcher });
  if (!note) return { status: "skipped", reason: "not_found", patch: existing };

  const observedAtNow = (options.now ?? new Date()).toISOString();
  const changed = existing.source !== "official" || existing.version !== note.patchVersion || existing.officialUrl !== note.officialUrl;
  const observedAt = changed || !existing.observedAt ? observedAtNow : existing.observedAt;

  const { error: syncError } = await supabase.rpc("sync_official_patch_note", {
    p_board_no: note.boardNo,
    p_title: note.title,
    p_patch_version: note.patchVersion,
    p_official_url: note.officialUrl,
    p_published_at: note.publishedAt,
    p_summary: note.summary,
    p_observed_at: observedAt,
  });
  if (syncError) throw new Error(`official patch sync failed: ${syncError.message}`);

  const { error: deleteFixesError } = await supabase
    .from("official_patch_claimed_fixes")
    .delete()
    .eq("board_no", note.boardNo);
  if (deleteFixesError) throw new Error(`official patch claimed fixes clear failed: ${deleteFixesError.message}`);

  if (note.claimedFixes.length > 0) {
    const fixRows = note.claimedFixes.map((fixText, index) => {
      const category = classifySignal(fixText).category;
      return {
        board_no: note.boardNo,
        position: index,
        fix_text: fixText,
        category: category === "other" ? null : category,
      };
    });
    const { error: insertFixesError } = await supabase.from("official_patch_claimed_fixes").insert(fixRows);
    if (insertFixesError) throw new Error(`official patch claimed fixes insert failed: ${insertFixesError.message}`);
  }

  return { status: "synced", changed, patch: noteToCurrent(note, observedAt) };
}

type ClaimedFixRow = { fix_text: string; category: string | null };

export type ClaimedFix = { fixText: string; category: string | null };

export async function getClaimedFixesForCurrentPatch(supabase: SupabaseClient): Promise<ClaimedFix[]> {
  try {
    const { data: currentRows, error: currentError } = await supabase
      .from("official_patch_notes")
      .select("board_no")
      .eq("is_current", true)
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(1);
    if (currentError) return [];
    const boardNo = ((currentRows ?? []) as { board_no: string }[])[0]?.board_no;
    if (!boardNo) return [];

    const { data: fixRows, error: fixError } = await supabase
      .from("official_patch_claimed_fixes")
      .select("fix_text, category")
      .eq("board_no", boardNo)
      .order("position", { ascending: true });
    if (fixError) return [];

    return ((fixRows ?? []) as ClaimedFixRow[]).map((row) => ({ fixText: row.fix_text, category: row.category }));
  } catch {
    return [];
  }
}
