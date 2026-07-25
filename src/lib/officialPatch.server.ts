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

/**
 * Edition № for the masthead: the count of DISTINCT tracked patch versions.
 * Sync/override history can repeat versions, so raw row counts would lie.
 * Returns null when unknown so the masthead can omit the edition entirely.
 */
async function readTrackedPatchEditionCountUncached(supabase: SupabaseClient): Promise<number | null> {
  try {
    const { data, error } = await supabase.from("official_patch_notes").select("patch_version");
    if (error) return null;
    const versions = new Set(
      ((data ?? []) as { patch_version: string }[]).map((row) => row.patch_version.trim()).filter(Boolean),
    );
    return versions.size > 0 ? versions.size : null;
  } catch {
    return null;
  }
}

const getCachedTrackedPatchEditionCount = unstable_cache(
  async () =>
    hasSupabaseServiceConfig() ? readTrackedPatchEditionCountUncached(createServiceClient()) : null,
  ["tracked-patch-edition-count"],
  { revalidate: 300, tags: [CURRENT_PATCH_TAG] },
);

export function getTrackedPatchEditionCount(supabase?: SupabaseClient): Promise<number | null> {
  return supabase ? readTrackedPatchEditionCountUncached(supabase) : getCachedTrackedPatchEditionCount();
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

  const fixRows = note.claimedFixes.map((line) => {
    const category = classifySignal(line.text).category;
    return {
      fix_text: line.text,
      category: category === "other" ? null : category,
      section: line.section,
    };
  });

  const legacySyncArgs = {
    p_board_no: note.boardNo,
    p_title: note.title,
    p_patch_version: note.patchVersion,
    p_official_url: note.officialUrl,
    p_published_at: note.publishedAt,
    p_summary: note.summary,
    p_observed_at: observedAt,
    p_claimed_fixes: fixRows,
  };
  const { error: syncError } = await supabase.rpc("sync_official_patch_note_with_claimed_fixes", {
    ...legacySyncArgs,
    p_claimed_fix_total: note.claimedFixTotal,
  });
  if (syncError && isMissingFunctionError(syncError)) {
    // Pre-migration schema: the legacy 8-argument function still exists and
    // ignores the extra jsonb keys. Sections and the total land on the first
    // sync after the migration applies; nothing else is lost meanwhile.
    const { error: legacyError } = await supabase.rpc(
      "sync_official_patch_note_with_claimed_fixes",
      legacySyncArgs,
    );
    if (legacyError) throw new Error(`official patch sync failed: ${legacyError.message}`);
  } else if (syncError) {
    throw new Error(`official patch sync failed: ${syncError.message}`);
  }

  return { status: "synced", changed, patch: noteToCurrent(note, observedAt) };
}

type ClaimedFixRow = { fix_text: string; category: string | null; section?: string | null };

export type ClaimedFix = { fixText: string; category: string | null; section: string | null };

export type ClaimedFixRegister = {
  fixes: ClaimedFix[];
  // Kept-shaped lines in the source notes, cap included; null when the sync
  // that stored this patch predates the column. Lets the record say
  // "the first 30 of N" instead of passing the cap off as the whole register.
  totalClaimedFixes: number | null;
};

/**
 * Rolling deploys can pair this build with a schema that predates the
 * section/claimed_fix_total columns and the 9-argument sync function.
 * EXACTLY a missing-column read (42703) or a missing-function call
 * (42883 / PGRST202) falls back to the legacy shape; every other failure —
 * permissions, network, data — stays a real failure and surfaces.
 */
const MISSING_COLUMN_CODE = "42703";
const MISSING_FUNCTION_CODES = new Set(["42883", "PGRST202"]);

type DbErrorLike = { code?: string; message: string };

function isMissingColumnError(error: DbErrorLike): boolean {
  return error.code === MISSING_COLUMN_CODE;
}

function isMissingFunctionError(error: DbErrorLike): boolean {
  return error.code !== undefined && MISSING_FUNCTION_CODES.has(error.code);
}

function currentBoardQuery(supabase: SupabaseClient, columns: string) {
  return supabase
    .from("official_patch_notes")
    .select(columns)
    .eq("is_current", true)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(1);
}

async function readCurrentBoard(
  supabase: SupabaseClient,
): Promise<{ boardNo: string; totalClaimedFixes: number | null } | null> {
  const rich = await currentBoardQuery(supabase, "board_no, claimed_fix_total");
  if (!rich.error) {
    const row = ((rich.data ?? []) as unknown as { board_no: string; claimed_fix_total?: number | null }[])[0];
    return row?.board_no ? { boardNo: row.board_no, totalClaimedFixes: row.claimed_fix_total ?? null } : null;
  }
  if (!isMissingColumnError(rich.error)) {
    throw new Error(`official patch notes read failed: ${rich.error.message}`);
  }
  const legacy = await currentBoardQuery(supabase, "board_no");
  if (legacy.error) throw new Error(`official patch notes read failed: ${legacy.error.message}`);
  const row = ((legacy.data ?? []) as unknown as { board_no: string }[])[0];
  return row?.board_no ? { boardNo: row.board_no, totalClaimedFixes: null } : null;
}

function boardFixesQuery(supabase: SupabaseClient, boardNo: string, columns: string) {
  return supabase
    .from("official_patch_claimed_fixes")
    .select(columns)
    .eq("board_no", boardNo)
    .order("position", { ascending: true });
}

async function readBoardFixes(supabase: SupabaseClient, boardNo: string): Promise<ClaimedFix[]> {
  const rich = await boardFixesQuery(supabase, boardNo, "fix_text, category, section");
  if (!rich.error) {
    return ((rich.data ?? []) as unknown as ClaimedFixRow[]).map((row) => ({
      fixText: row.fix_text,
      category: row.category,
      section: row.section ?? null,
    }));
  }
  if (!isMissingColumnError(rich.error)) {
    throw new Error(`official claimed fixes read failed: ${rich.error.message}`);
  }
  const legacy = await boardFixesQuery(supabase, boardNo, "fix_text, category");
  if (legacy.error) throw new Error(`official claimed fixes read failed: ${legacy.error.message}`);
  return ((legacy.data ?? []) as unknown as ClaimedFixRow[]).map((row) => ({
    fixText: row.fix_text,
    category: row.category,
    section: null,
  }));
}

export async function readClaimedFixesForCurrentPatch(supabase: SupabaseClient): Promise<ClaimedFixRegister> {
  const current = await readCurrentBoard(supabase);
  if (!current) return { fixes: [], totalClaimedFixes: null };
  return {
    fixes: await readBoardFixes(supabase, current.boardNo),
    totalClaimedFixes: current.totalClaimedFixes,
  };
}

export async function getClaimedFixesForCurrentPatch(supabase: SupabaseClient): Promise<ClaimedFix[]> {
  try {
    return (await readClaimedFixesForCurrentPatch(supabase)).fixes;
  } catch {
    return [];
  }
}
