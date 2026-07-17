import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260717094404_atomic_patch_observation_persistence.sql",
);
const timestampMigrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260717095918_tolerate_invalid_observation_timestamps.sql",
);

describe("atomic patch observation persistence migration", () => {
  it("serializes writers and owns the per-patch cap in the database", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toMatch(/create or replace function public\.persist_patch_observations\(\s*p_patch_version text,\s*p_observations jsonb/i);
    expect(sql).toMatch(/security invoker/i);
    expect(sql).toMatch(/set search_path = ''/i);
    expect(sql).toMatch(/pg_advisory_xact_lock\([\s\S]*patch_observations:/i);
    expect(sql).toMatch(/select count\(\*\)::integer[\s\S]*from public\.patch_observations[\s\S]*where patch_version = p_patch_version/i);
    expect(sql).toMatch(/elsif current_count < 40 then/i);
    expect(sql).toMatch(/current_count := current_count \+ 1/i);
    expect(sql).toMatch(/inserted_count := inserted_count \+ 1/i);
    expect(sql).toMatch(/returns integer[\s\S]*return inserted_count/i);
  });

  it("updates both timestamps for an existing patch-scoped identity", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toMatch(/where patch_version = p_patch_version\s+and url_hash = observation_hash\s+for update/i);
    expect(sql).toMatch(/observed_at = \(observation->>'observed_at'\)::timestamptz/i);
    expect(sql).toMatch(/last_seen_at = \(observation->>'observed_at'\)::timestamptz/i);
  });

  it("exposes persistence only to the service role", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toMatch(/revoke all on function public\.persist_patch_observations\(text, jsonb\)[\s\S]*from public, anon, authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.persist_patch_observations\(text, jsonb\)[\s\S]*to service_role/i);
  });

  it("coerces malformed optional publication timestamps without aborting the batch", () => {
    const sql = readFileSync(timestampMigrationPath, "utf8");

    expect(sql).toMatch(/parsed_source_published_at timestamptz/i);
    expect(sql).toMatch(/if nullif\(pg_catalog\.btrim\(observation->>'source_published_at'\), ''\) is not null then/i);
    expect(sql).toMatch(/begin\s+parsed_source_published_at := \(observation->>'source_published_at'\)::timestamptz;\s+exception when others then[\s\S]*parsed_source_published_at := null;/i);
    expect(sql).toMatch(/parsed_source_published_at,\s+\(observation->>'observed_at'\)::timestamptz/i);
  });
});
