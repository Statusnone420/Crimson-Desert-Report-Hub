import "server-only";

import { cache } from "react";
import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EDITORIALS_TAG } from "@/lib/cacheTags";
import { columnMonthlyCapUsd, ledgerMonth } from "@/lib/editorials/budget";
import {
  PUBLIC_EDITORIAL_COLUMNS,
  toPublicEdition,
  type PublicEdition,
  type PublicEditorialRow,
} from "@/lib/editorials/content";
import { readColumnSettings } from "@/lib/editorials/settings.server";
import type { ColumnSettings } from "@/lib/editorials/settings";
import { isEditorialVisible, whereEditorialVisible } from "@/lib/editorials/visibility";
import { createServiceClient, hasSupabaseServiceConfig } from "@/lib/supabase";
import { isMissingSupabaseRelation, type SupabaseErrorLike } from "@/lib/supabaseCompatibility";

export const COLUMN_TABLES = ["editorials", "editorial_ai_spend", "style_notes", "voice_examples"] as const;
const PUBLIC_LIST_LIMIT = 50;
const SITEMAP_PAGE_SIZE = 1000;
// The sitemap protocol's limit for one file.
const SITEMAP_MAX_EDITIONS = 50_000;
const SLUG_SHAPE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * True only for the rolling-deploy case: this code is live but the column's
 * migration has not reached the database. Every other error is a real failure.
 */
export function isColumnTableMissing(error: SupabaseErrorLike | null | undefined): boolean {
  return COLUMN_TABLES.some((table) => isMissingSupabaseRelation(error, table));
}

function publicEditions(rows: PublicEditorialRow[], now: Date): PublicEdition[] {
  const editions: PublicEdition[] = [];
  let malformed = 0;
  for (const row of rows) {
    if (!isEditorialVisible(row, now)) continue;
    const edition = toPublicEdition(row);
    if (edition) editions.push(edition);
    else malformed++;
  }
  if (malformed) console.warn(JSON.stringify({ event: "editorial_rows_malformed", count: malformed }));
  return editions;
}

/** Visible editions, newest first. Before the migration there are none; other failures throw. */
export async function readVisibleEditions(client: SupabaseClient, now: Date, limit = PUBLIC_LIST_LIMIT): Promise<PublicEdition[]> {
  const { data, error } = await whereEditorialVisible(client.from("editorials").select(PUBLIC_EDITORIAL_COLUMNS), now)
    .order("publish_at", { ascending: false })
    .limit(limit);
  if (isColumnTableMissing(error)) return [];
  if (error) throw new Error("Editorials are unavailable.");
  return publicEditions((data ?? []) as unknown as PublicEditorialRow[], now);
}

export type SitemapEdition = Pick<PublicEdition, "slug" | "publishAt">;

/**
 * Every visible edition for the sitemap, newest first, read a page at a time so older
 * editions stay listed after the feeds' bounded read stops reaching them. It keeps
 * reading until a page comes back empty, so a server-side row cap can't cut it short.
 */
export async function readSitemapEditions(client: SupabaseClient, now: Date): Promise<SitemapEdition[]> {
  const editions = new Map<string, SitemapEdition>();
  for (let from = 0; from < SITEMAP_MAX_EDITIONS;) {
    const { data, error } = await whereEditorialVisible(client.from("editorials").select(PUBLIC_EDITORIAL_COLUMNS), now)
      .order("publish_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + SITEMAP_PAGE_SIZE - 1);
    if (isColumnTableMissing(error)) return [];
    if (error) throw new Error("Editorials are unavailable.");
    const rows = (data ?? []) as unknown as PublicEditorialRow[];
    if (!rows.length) break;
    for (const edition of publicEditions(rows, now)) editions.set(edition.slug, { slug: edition.slug, publishAt: edition.publishAt });
    from += rows.length;
  }
  return [...editions.values()].slice(0, SITEMAP_MAX_EDITIONS);
}

export async function readVisibleEditionBySlug(client: SupabaseClient, slug: string, now: Date): Promise<PublicEdition | null> {
  if (!SLUG_SHAPE.test(slug) || slug.length > 120) return null;
  const { data, error } = await whereEditorialVisible(client.from("editorials").select(PUBLIC_EDITORIAL_COLUMNS).eq("slug", slug), now).limit(1);
  if (isColumnTableMissing(error)) return null;
  if (error) throw new Error("Editorials are unavailable.");
  return publicEditions((data ?? []) as unknown as PublicEditorialRow[], now)[0] ?? null;
}

function serviceClient(): SupabaseClient {
  if (!hasSupabaseServiceConfig()) throw new Error("Editorials are unavailable.");
  return createServiceClient();
}

const getCachedVisibleEditions = unstable_cache(
  async () => readVisibleEditions(serviceClient(), new Date()),
  ["public-editorials-v1"],
  { revalidate: 300, tags: [EDITORIALS_TAG] },
);

const getCachedEditionBySlug = unstable_cache(
  async (slug: string) => readVisibleEditionBySlug(serviceClient(), slug, new Date()),
  ["public-editorial-v1"],
  { revalidate: 300, tags: [EDITORIALS_TAG] },
);

const getCachedSitemapEditions = unstable_cache(
  async () => readSitemapEditions(serviceClient(), new Date()),
  ["sitemap-editorials-v1"],
  { revalidate: 300, tags: [EDITORIALS_TAG] },
);

/**
 * Feeds: the newest visible editions, or `unavailable` when the read failed.
 * Failures are not cached, and an unavailable read never looks like an empty column.
 */
export const getPublicEditions = cache(async (): Promise<{ editions: PublicEdition[]; unavailable: boolean }> => {
  try {
    return { editions: await getCachedVisibleEditions(), unavailable: false };
  } catch {
    console.warn(JSON.stringify({ event: "editorials_read_unavailable" }));
    return { editions: [], unavailable: true };
  }
});

/** The sitemap: every visible edition's address and date, or `unavailable` when the read failed. */
export const getSitemapEditions = cache(async (): Promise<{ editions: SitemapEdition[]; unavailable: boolean }> => {
  try {
    return { editions: await getCachedSitemapEditions(), unavailable: false };
  } catch {
    console.warn(JSON.stringify({ event: "editorials_read_unavailable" }));
    return { editions: [], unavailable: true };
  }
});

/** The edition page: null means not found; a failed read throws so the page shows its error state. */
export const getPublicEditionBySlug = cache(async (slug: string): Promise<PublicEdition | null> => getCachedEditionBySlug(slug));

/** Private columns for the operator and the token-gated preview feed. fact_pack and check_report stay out. */
export const ADMIN_EDITORIAL_COLUMNS = "id, slot_key, is_test, slug, status, title, dek, body_md, facts_box, relevance_score, writer_model, writer_effort, skip_reason, hold_hours, created_at, updated_at, publish_at, published_at, vetoed_at";

export type AdminEditionRow = {
  id: string;
  slot_key: string;
  is_test: boolean;
  slug: string | null;
  status: "held" | "published" | "vetoed" | "skipped";
  title: string | null;
  dek: string | null;
  body_md: string | null;
  facts_box: unknown;
  relevance_score: number | null;
  writer_model: string | null;
  writer_effort: string | null;
  skip_reason: string | null;
  hold_hours: number | null;
  created_at: string;
  updated_at: string;
  publish_at: string | null;
  published_at: string | null;
  vetoed_at: string | null;
};

const PREVIEW_WINDOW_DAYS = 30;
const PREVIEW_LIMIT = 50;

/** Held, published, vetoed and skipped rows and test drafts from the last 30 days, newest first. */
export async function readPreviewEditions(client: SupabaseClient, now: Date): Promise<AdminEditionRow[]> {
  const since = new Date(now.getTime() - PREVIEW_WINDOW_DAYS * 86_400_000).toISOString();
  const { data, error } = await client.from("editorials").select(ADMIN_EDITORIAL_COLUMNS)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(PREVIEW_LIMIT);
  if (isColumnTableMissing(error)) return [];
  if (error) throw new Error("Editorials are unavailable.");
  return (data ?? []) as unknown as AdminEditionRow[];
}

export type ColumnSpend = { month: string; spentUsd: number; capUsd: number };

export type ColumnDashboard =
  | { state: "not_set_up"; settings: ColumnSettings }
  | {
      state: "ready";
      settings: ColumnSettings;
      settingsUpdatedAt: string | null;
      recent: AdminEditionRow[];
      pending: AdminEditionRow[];
      spend: ColumnSpend;
    };

/** The Column card's data. Missing tables show as "not set up"; any other failure throws. */
export async function readColumnDashboard(client: SupabaseClient, now: Date): Promise<ColumnDashboard> {
  const { settings, updatedAt } = await readColumnSettings(client);
  const month = ledgerMonth(now);
  const [recent, held, spend] = await Promise.all([
    client.from("editorials").select(ADMIN_EDITORIAL_COLUMNS).eq("is_test", false)
      .order("created_at", { ascending: false }).limit(5),
    client.from("editorials").select(ADMIN_EDITORIAL_COLUMNS).eq("status", "held").eq("is_test", false).is("vetoed_at", null)
      .order("created_at", { ascending: false }).limit(10),
    client.from("editorial_ai_spend").select("reserved_usd, settled_usd").eq("month", month),
  ]);
  const errors = [recent.error, held.error, spend.error].filter((error) => error !== null);
  if (errors.some(isColumnTableMissing)) return { state: "not_set_up", settings };
  if (errors.length) throw new Error("The column record is unavailable.");
  const spentUsd = ((spend.data ?? []) as { reserved_usd: number | string; settled_usd: number | string | null }[])
    .reduce((total, row) => total + Number(row.settled_usd ?? row.reserved_usd), 0);
  const pending = ((held.data ?? []) as unknown as AdminEditionRow[])
    .filter((row) => row.publish_at === null || Date.parse(row.publish_at) > now.getTime());
  return {
    state: "ready",
    settings,
    settingsUpdatedAt: updatedAt,
    recent: (recent.data ?? []) as unknown as AdminEditionRow[],
    pending,
    spend: { month, spentUsd, capUsd: columnMonthlyCapUsd(settings.monthlyCapUsd) },
  };
}

/** One edition for the operator's draft view, any status. Before the migration there is none. */
export async function readAdminEdition(client: SupabaseClient, id: string): Promise<AdminEditionRow | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const { data, error } = await client.from("editorials").select(ADMIN_EDITORIAL_COLUMNS).eq("id", id).limit(1);
  if (isColumnTableMissing(error)) return null;
  if (error) throw new Error("Editorials are unavailable.");
  return ((data ?? []) as unknown as AdminEditionRow[])[0] ?? null;
}
