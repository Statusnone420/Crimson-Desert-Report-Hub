import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase", "migrations");
const baseMigration = "20260716210000_patch_observations.sql";
const followUpMigration = "20260716210100_patch_observations_identity.sql";

describe("patch observation migrations", () => {
  it("keeps community_ask and patch-scoped identity in a follow-up migration", () => {
    const baseSql = readFileSync(join(migrationsDir, baseMigration), "utf8");
    const followUpSql = readFileSync(join(migrationsDir, followUpMigration), "utf8");

    expect(baseSql).not.toContain("community_ask");
    expect(followUpSql).toMatch(/drop constraint if exists patch_observations_kind_check/i);
    expect(followUpSql).toMatch(/community_ask/);
    expect(followUpSql).toMatch(/drop constraint if exists patch_observations_url_hash_key/i);
    expect(followUpSql).toMatch(/unique \(url_hash, patch_version\)/i);
  });
});
