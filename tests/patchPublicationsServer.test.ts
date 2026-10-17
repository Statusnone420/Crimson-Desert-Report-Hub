import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
import { readPatchEditions } from "@/lib/patchPublications.server";

type Row = Record<string, unknown>;
const note = (version: string, board: string, extra: Row = {}) => ({ board_no: board, patch_version: version, official_url: `https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=${board}`, published_at: "2026-09-21T14:00:00Z", observed_at: "2026-09-21T16:00:00Z", claimed_fix_total: 1, ...extra });
const fix = (board: string, position: number) => ({ board_no: board, position, fix_text: `Fixed official issue ${position} for board ${board}.`, category: null, section: "Fixes" });

function database(notes: Row[], fixes: Row[], errorFor?: (table: string, columns: string) => { code: string; message: string } | null) {
  const reads: { table: string; columns: string }[] = [];
  const client = { from: (table: string) => {
    let columns = "";
    let rows = table === "official_patch_notes" ? notes : fixes;
    let start = 0;
    let end = 199;
    const query = {
      select(value: string) { columns = value; return query; },
      in(key: string, values: unknown[]) { rows = rows.filter((row) => values.includes(row[key])); return query; },
      order() { return query; },
      range(from: number, to: number) { start = from; end = to; return query; },
      then(resolve: (result: unknown) => unknown) {
        reads.push({ table, columns });
        const error = errorFor?.(table, columns) ?? null;
        return Promise.resolve({ data: error ? null : rows.slice(start, end + 1), error }).then(resolve);
      },
    };
    return query;
  } } as unknown as SupabaseClient;
  return { client, reads };
}

describe("official patch archive reads", () => {
  it("keeps claims bound to their version and excludes overrides and nonofficial URLs", async () => {
    const { client, reads } = database([note("2.03.00", "131"), note("2.03.01", "132"), note("9.00.00", "manual-9"), note("9.01.00", "900", { official_url: "https://private.example/secret" })], [fix("131", 0), fix("132", 0), fix("900", 0)]);
    const editions = await readPatchEditions(client);
    expect(editions.map((item) => item.version)).toEqual(["2.03.01", "2.03.00"]);
    expect(editions[0].fixes.map((item) => item.fixText)).toEqual([fix("132", 0).fix_text]);
    expect(JSON.stringify(editions)).not.toContain("private.example");
    expect(new Set(reads.map((read) => read.table))).toEqual(new Set(["official_patch_notes", "official_patch_claimed_fixes"]));
  });

  it("paginates both tables without truncating a long history", async () => {
    const notes = Array.from({ length: 205 }, (_, i) => note(`3.${Math.floor(i / 100)}.${i % 100}`, String(i + 1)));
    const fixes = notes.flatMap((row) => [fix(row.board_no, 0), fix(row.board_no, 1)]);
    const { client } = database(notes, fixes);
    const editions = await readPatchEditions(client);
    expect(editions).toHaveLength(205);
    expect(editions.every((edition) => edition.fixes.length === 2)).toBe(true);
  });

  it("publishes only the canonical official URL without extra stored parameters", async () => {
    const { client } = database([note("2.03.01", "132", { official_url: "https://crimsondesert.pearlabyss.com/en-US/News/Notice/Detail?_boardNo=132&private=do-not-publish#fragment" })], []);
    expect((await readPatchEditions(client))[0].officialUrl).toBe(note("2.03.01", "132").official_url);
  });

  it("keeps distinct two-part and three-part versions addressable", async () => {
    const { client } = database([note("2.03", "131"), note("2.03.00", "132")], []);
    expect(await readPatchEditions(client)).toHaveLength(2);
  });

  it("updates one version from the newer notice instead of publishing duplicates", async () => {
    const { client } = database([note("2.03.01", "132"), note("2.03.01", "133")], [fix("132", 0), fix("133", 0)]);
    const editions = await readPatchEditions(client);
    expect(editions).toHaveLength(1);
    expect(editions[0].officialUrl).toContain("133");
    expect(editions[0].fixes[0].fixText).toContain("133");
  });

  it("supports only the known legacy columns while surfacing all other errors", async () => {
    const legacy = database([note("2.03.01", "132", { claimed_fix_total: undefined })], [{ ...fix("132", 0), section: undefined }], (_table, columns) => columns.includes("claimed_fix_total") ? { code: "42703", message: "column claimed_fix_total does not exist" } : columns.includes("section") ? { code: "42703", message: "column section does not exist" } : null);
    expect((await readPatchEditions(legacy.client))[0]).toMatchObject({ totalClaimedFixes: null, fixes: [{ section: null }] });
    for (const error of [{ code: "42501", message: "permission denied" }, { code: "42703", message: "column published_at does not exist" }, { code: "XX000", message: "database unavailable" }]) {
      const denied = database([note("2.03.01", "132")], [], () => error);
      await expect(readPatchEditions(denied.client)).rejects.toThrow("unavailable");
      expect(denied.reads).toHaveLength(1);
    }
    const failedFixes = database([note("2.03.01", "132")], [], (table) => table === "official_patch_claimed_fixes" ? { code: "42501", message: "permission denied" } : null);
    await expect(readPatchEditions(failedFixes.client)).rejects.toThrow("fixes are unavailable");
  });
});
