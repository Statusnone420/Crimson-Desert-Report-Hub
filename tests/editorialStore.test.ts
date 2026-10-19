import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn, revalidateTag: vi.fn(), revalidatePath: vi.fn() }));

import { readAdminEdition, readColumnDashboard, readPreviewEditions, readSitemapEditions, readVisibleEditionBySlug, readVisibleEditions } from "@/lib/editorials/store.server";
import { NOW, publicRow } from "./editorialFixtures";

type Result = { data: unknown; error: { code?: string; message: string } | null };

/** A chainable PostgREST stand-in that records every call and resolves per table. */
function client(results: Record<string, Result>) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const from = (table: string) => {
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "lte", "gte", "is", "order", "limit", "range"]) {
      builder[method] = (...args: unknown[]) => { calls.push({ table, method, args }); return builder; };
    }
    builder.then = (resolve: (value: Result) => unknown) => resolve(results[table] ?? { data: [], error: null });
    return builder;
  };
  return { client: { from } as unknown as SupabaseClient, calls };
}

const missing = (table: string) => ({ data: null, error: { code: "PGRST205", message: `Could not find the table 'public.${table}' in the schema cache` } });
const denied = { data: null, error: { code: "42501", message: "permission denied for table editorials" } };

describe("public editorial reads", () => {
  it("returns visible, well-formed editions only", async () => {
    const { client: db, calls } = client({ editorials: { data: [publicRow(), publicRow({ id: "e2", slug: "bad", body_md: "Nope" }), publicRow({ id: "e3", slug: "later", publish_at: "2026-10-27T00:00:00Z" })], error: null } });
    const editions = await readVisibleEditions(db, NOW);
    expect(editions.map((edition) => edition.slug)).toEqual(["clear-skies-over-the-inventory-screen"]);
    const select = calls.find((call) => call.method === "select");
    expect(String(select?.args[0])).not.toMatch(/fact_pack|check_report|writer_model/);
    expect(calls).toContainEqual({ table: "editorials", method: "lte", args: ["publish_at", NOW.toISOString()] });
  });

  it("treats a missing editorials table as no editions (a deploy ahead of its migration)", async () => {
    expect(await readVisibleEditions(client({ editorials: missing("editorials") }).client, NOW)).toEqual([]);
    expect(await readVisibleEditionBySlug(client({ editorials: missing("editorials") }).client, "any-slug", NOW)).toBeNull();
    expect(await readPreviewEditions(client({ editorials: missing("editorials") }).client, NOW)).toEqual([]);
  });

  it("surfaces every other database failure", async () => {
    await expect(readVisibleEditions(client({ editorials: denied }).client, NOW)).rejects.toThrow("unavailable");
    await expect(readVisibleEditionBySlug(client({ editorials: denied }).client, "any-slug", NOW)).rejects.toThrow("unavailable");
    await expect(readPreviewEditions(client({ editorials: denied }).client, NOW)).rejects.toThrow("unavailable");
    await expect(readAdminEdition(client({ editorials: denied }).client, "e0000000-0000-4000-8000-000000000001")).rejects.toThrow("unavailable");
  });

  it("does not query for a malformed slug", async () => {
    const { client: db, calls } = client({});
    expect(await readVisibleEditionBySlug(db, "../etc", NOW)).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe("the sitemap's edition read", () => {
  /** Serves rows a page at a time, never more than `cap` per request, like PostgREST's max-rows setting. */
  function paged(rows: unknown[], cap: number) {
    const starts: number[] = [];
    const from = () => {
      let window = [0, Number.MAX_SAFE_INTEGER];
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "in", "lte", "is", "order"]) builder[method] = () => builder;
      builder.range = (start: number, end: number) => { window = [start, end]; starts.push(start); return builder; };
      builder.then = (resolve: (value: Result) => unknown) => resolve({ data: rows.slice(window[0], Math.min(window[1] + 1, window[0] + cap)), error: null });
      return builder;
    };
    return { client: { from } as unknown as SupabaseClient, starts };
  }

  it("lists every visible edition past the feeds' limit, even when the server caps each page", async () => {
    const rows = Array.from({ length: 1205 }, (_, index) => publicRow({ id: `e${index}`, slug: `edition-${index}` }));
    const { client: db, starts } = paged(rows, 500);
    const editions = await readSitemapEditions(db, NOW);
    expect(editions).toHaveLength(1205);
    expect(editions[1204]).toEqual({ slug: "edition-1204", publishAt: rows[1204].publish_at });
    expect(starts).toEqual([0, 500, 1000, 1205]);
  });

  it("treats a missing table as no editions and surfaces every other failure", async () => {
    expect(await readSitemapEditions(client({ editorials: missing("editorials") }).client, NOW)).toEqual([]);
    await expect(readSitemapEditions(client({ editorials: denied }).client, NOW)).rejects.toThrow("unavailable");
  });
});

describe("the Column card's record", () => {
  const settingsRow = { data: [{ value: { paused: true, approveFirstRemaining: 2, monthlyCapUsd: 10 }, updated_at: "2026-10-26T12:00:00Z" }], error: null };

  beforeEach(() => vi.unstubAllEnvs());

  it("shows not set up when the column tables are missing, keeping the settings readable", async () => {
    const dashboard = await readColumnDashboard(client({ automation_settings: settingsRow, editorials: missing("editorials"), editorial_ai_spend: missing("editorial_ai_spend") }).client, NOW);
    expect(dashboard).toMatchObject({ state: "not_set_up", settings: { paused: true } });
  });

  it("throws on a real failure instead of showing an empty column", async () => {
    await expect(readColumnDashboard(client({ automation_settings: settingsRow, editorials: denied }).client, NOW)).rejects.toThrow("unavailable");
    await expect(readColumnDashboard(client({ automation_settings: { data: null, error: { message: "timeout" } } }).client, NOW)).rejects.toThrow("unavailable");
  });

  it("sums the month's settled and reserved spend against the cap", async () => {
    const dashboard = await readColumnDashboard(client({
      automation_settings: settingsRow,
      editorials: { data: [{ ...publicRow({ publish_at: null }), slot_key: "2026-W44:s0", created_at: "2026-10-26T14:00:00Z" }], error: null },
      editorial_ai_spend: { data: [{ reserved_usd: "0.5", settled_usd: "0.12" }, { reserved_usd: "0.2", settled_usd: null }], error: null },
    }).client, NOW);
    expect(dashboard.state).toBe("ready");
    if (dashboard.state !== "ready") return;
    expect(dashboard.spend.spentUsd).toBeCloseTo(0.32);
    expect(dashboard.spend.capUsd).toBe(10);
    expect(dashboard.spend.month).toBe("2026-10");
    expect(dashboard.pending).toHaveLength(1);
  });
});
