import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260726120000_canonicalize_steam_display_params.sql"),
  "utf8",
);

describe("steam display-parameter backfill migration", () => {
  it("rewrites text and nothing else", () => {
    // The whole safety argument for applying this to live data is that it
    // cannot lose a row. If it ever grows an insert, delete, or schema change,
    // that argument stops holding and this test should stop passing.
    expect(sql).not.toMatch(/\b(insert|delete|truncate|drop table|alter table)\b/i);
    expect(sql.match(/^update /gim) ?? []).toHaveLength(2);
  });

  it("touches only Steam hosts and only the three display parameters", () => {
    expect(sql).toMatch(/steamcommunity\\\.com\|store\\\.steampowered\\\.com/);
    expect(sql).toMatch(/not in \('l', 'curator_clanid', 'snr'\)/);
  });

  it("leaves rows that are already canonical untouched", () => {
    expect(sql.match(/<> pg_temp\.canonicalize_steam_url\(/g) ?? []).toHaveLength(2);
  });

  it("orders surviving parameters the way URLSearchParams.sort does", () => {
    // JavaScript sorts by parameter NAME and is stable, so `?foo=z&foo=a` keeps
    // z before a. Ordering by the whole `name=value` pair would swap them and
    // the migrated text would stop equalling a freshly canonicalized URL —
    // which is the one thing this backfill exists to make true.
    expect(sql).toMatch(/order by split_part\(pair, '=', 1\) collate "C", ord/);
    expect(sql).toMatch(/with ordinality/);
  });

  it("leaves the unique identity hash to the application", () => {
    // external_id_hash is `not null unique` and two rows differing only by `?l=`
    // collapse to one value, so a bulk recompute would abort on a duplicate.
    expect(sql).not.toMatch(/set external_id_hash/i);
    expect(sql).toMatch(/external_id_hash/);
  });

  it("says plainly that it has not been applied", () => {
    expect(sql).toMatch(/NOT APPLIED/);
  });
});
