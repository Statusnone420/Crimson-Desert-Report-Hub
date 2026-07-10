import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase", "migrations");

function atomicOverrideMigration(): string {
  const matches = readdirSync(migrationsDir).filter((file) => file.endsWith("_atomic_current_patch_override.sql"));
  expect(matches).toHaveLength(1);
  return readFileSync(join(migrationsDir, matches[0]), "utf8");
}

describe("atomic current patch override migration", () => {
  it("serializes clear plus replacement and leaves an unknown publish time null", () => {
    const sql = atomicOverrideMigration();

    expect(sql).toMatch(/create or replace function public\.set_current_patch_override/i);
    expect(sql).toMatch(/security invoker/i);
    expect(sql).toMatch(/pg_advisory_xact_lock/i);
    expect(sql).toMatch(/update public\.official_patch_notes[\s\S]*is_current\s*=\s*false/i);
    expect(sql).toMatch(/insert into public\.official_patch_notes[\s\S]*published_at[\s\S]*null/i);
    expect(sql).toMatch(/on conflict\s*\(board_no\)[\s\S]*is_current\s*=\s*true/i);
  });

  it("exposes the RPC only to the service role", () => {
    const sql = atomicOverrideMigration();

    expect(sql).toMatch(/revoke all on function public\.set_current_patch_override[\s\S]*from public, anon, authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.set_current_patch_override[\s\S]*to service_role/i);
  });
});
