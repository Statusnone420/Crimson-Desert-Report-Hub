import "server-only";

import { cache } from "react";
import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CURRENT_PATCH_TAG } from "./cacheTags";
import { createServiceClient, hasSupabaseServiceConfig } from "./supabase";
import { isValidPatchVersion, OFFICIAL_NOTICE_DETAIL_URL } from "./officialPatch";
import { matchesPatchVersion } from "./patchWatch";
import { comparePatchVersions, patchPublications, type PatchEdition } from "./patchPublications";

type NoteRow = { board_no: string; patch_version: string; official_url: string; published_at: string | null; observed_at: string; claimed_fix_total?: number | null };
type FixRow = { board_no: string; position: number; fix_text: string; category: string | null; section?: string | null };
const PAGE_SIZE = 200;

function isOfficialNote(row: NoteRow): boolean {
  if (!/^\d+$/.test(row.board_no) || !isValidPatchVersion(row.patch_version) || !Number.isFinite(Date.parse(row.observed_at))) return false;
  try {
    const url = new URL(row.official_url);
    return url.protocol === "https:" && url.hostname === "crimsondesert.pearlabyss.com"
      && /^\/en-us\/News\/Notice\/Detail$/i.test(url.pathname) && url.searchParams.get("_boardNo") === row.board_no;
  } catch { return false; }
}

/** Read only the official record; private reports and scanner candidates are never queried. */
export async function readPatchEditions(supabase: SupabaseClient): Promise<PatchEdition[]> {
  const notes: NoteRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const query = (columns: string) => supabase.from("official_patch_notes").select(columns).order("board_no").range(offset, offset + PAGE_SIZE - 1);
    let result = await query("board_no, patch_version, official_url, published_at, observed_at, claimed_fix_total");
    if (result.error?.code === "42703" && result.error.message.includes("claimed_fix_total")) {
      result = await query("board_no, patch_version, official_url, published_at, observed_at");
    }
    if (result.error) throw new Error("Official patch history is unavailable.");
    const rows = (result.data ?? []) as unknown as NoteRow[];
    notes.push(...rows.filter(isOfficialNote));
    if (rows.length < PAGE_SIZE) break;
  }
  const fixes: FixRow[] = [];
  // Bound each IN filter and page fixes independently of the API's row limit.
  for (let start = 0; start < notes.length; start += PAGE_SIZE) {
    const boards = notes.slice(start, start + PAGE_SIZE).map((note) => note.board_no);
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const query = (columns: string) => supabase.from("official_patch_claimed_fixes").select(columns).in("board_no", boards).order("board_no").order("position").range(offset, offset + PAGE_SIZE - 1);
      let result = await query("board_no, position, fix_text, category, section");
      if (result.error?.code === "42703" && result.error.message.includes("section")) {
        result = await query("board_no, position, fix_text, category");
      }
      if (result.error) throw new Error("Official patch fixes are unavailable.");
      const rows = (result.data ?? []) as unknown as FixRow[];
      fixes.push(...rows);
      if (rows.length < PAGE_SIZE) break;
    }
  }
  const editions: PatchEdition[] = [];
  // A second official notice for the same version replaces its rundown, never duplicates it.
  for (const note of notes.toSorted((a, b) => Date.parse(b.published_at ?? b.observed_at) - Date.parse(a.published_at ?? a.observed_at) || Number(b.board_no) - Number(a.board_no))) {
    if (editions.some((edition) => matchesPatchVersion(edition.version, note.patch_version))) continue;
    editions.push({
      version: note.patch_version,
      officialUrl: `${OFFICIAL_NOTICE_DETAIL_URL}?_boardNo=${note.board_no}`,
      publishedAt: note.published_at && Number.isFinite(Date.parse(note.published_at)) ? note.published_at : null,
      observedAt: note.observed_at,
      totalClaimedFixes: note.claimed_fix_total ?? null,
      fixes: fixes.filter((fix) => fix.board_no === note.board_no).sort((a, b) => a.position - b.position).map((fix) => ({ fixText: fix.fix_text, category: fix.category, section: fix.section ?? null })),
    });
  }
  return editions.sort((a, b) => comparePatchVersions(b.version, a.version));
}

const getCachedEditions = unstable_cache(async () => {
  if (!hasSupabaseServiceConfig()) throw new Error("Official patch history is unavailable.");
  return readPatchEditions(createServiceClient());
}, ["public-patch-editions-v1"], { revalidate: 300, tags: [CURRENT_PATCH_TAG] });

export const getPatchPublications = cache(async () => {
  try {
    const editions = await getCachedEditions();
    return { editions, articles: patchPublications(editions), unavailable: false };
  } catch {
    // Do not cache failures or make a missing record look like an empty archive.
    return { editions: [] as PatchEdition[], articles: patchPublications([]), unavailable: true };
  }
});
