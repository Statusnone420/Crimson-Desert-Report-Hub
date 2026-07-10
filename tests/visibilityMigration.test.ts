import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BASELINE_MIGRATION = "20260709234750_visibility_override_baseline.sql";
const RESTORE_RECOMPUTE_MIGRATION = "20260710005327_visibility_restore_recompute.sql";
const migrationDirectory = join(process.cwd(), "supabase", "migrations");

function visibilityFollowUpSql(): string {
  return readdirSync(migrationDirectory)
    .filter((file) => file.endsWith(".sql") && file.localeCompare(BASELINE_MIGRATION) > 0)
    .sort()
    .map((file) => readFileSync(join(migrationDirectory, file), "utf8"))
    .join("\n")
    .toLowerCase();
}

describe("visibility recovery migration contract", () => {
  it("makes approved-report core visibility durable before best-effort application refresh", () => {
    const sql = visibilityFollowUpSql();

    expect(sql).toMatch(/create\s+(?:constraint\s+)?trigger[\s\S]*?on\s+public\.bug_reports/);
    expect(sql).toMatch(/moderation_status\s*=\s*'approved'/);
    expect(sql).toMatch(/update\s+public\.issue_clusters/);
    expect(sql).toMatch(/auto_public\s*=\s*true/);
    expect(sql).toMatch(/is_public\s*=\s*(?:true|case)/);
  });

  it("snapshots and restores automatic ownership across a forced-visibility period", () => {
    const sql = visibilityFollowUpSql();
    const ownershipReferences = sql.match(/visibility_restore_auto_public/g) ?? [];

    expect(sql).toMatch(/add\s+column\s+visibility_restore_auto_public\s+boolean/);
    expect(ownershipReferences.length).toBeGreaterThanOrEqual(3);
    expect(sql).toMatch(/p_visibility\s*=\s*'auto'/);
    expect(sql).toMatch(/coalesce\(visibility_restore_auto_public,\s*auto_public\)/);
  });

  it("applies a whole visibility refresh atomically behind a revision CAS", () => {
    const sql = visibilityFollowUpSql();

    expect(sql).toMatch(/visibility_revision\s+bigint\s+not\s+null\s+default\s+0/);
    expect(sql).toMatch(/apply_cluster_visibility_refresh\s*\(\s*p_cluster_id\s+uuid\s*,\s*p_expected_revision\s+bigint\s*,\s*p_cluster_patch\s+jsonb\s*,\s*p_signal_patches\s+jsonb/);
    expect(sql).toMatch(/returns\s+boolean/);
    expect(sql).toMatch(/for\s+update/);
    expect(sql).toMatch(/update\s+public\.source_signals/);
    expect(sql).toMatch(/update\s+public\.issue_clusters/);
    expect(sql).toMatch(/visibility_revision\s*=\s*visibility_revision\s*\+\s*1/);
  });

  it("recomputes legacy restore state from engine-owned evidence", () => {
    const sql = readFileSync(join(migrationDirectory, RESTORE_RECOMPUTE_MIGRATION), "utf8").toLowerCase();

    expect(sql).toMatch(/update\s+public\.issue_clusters/);
    expect(sql).toMatch(/visibility_restore_is_public\s*=\s*\(/);
    expect(sql).toContain("c.auto_public");
    expect(sql).toMatch(/r\.moderation_status\s*=\s*'approved'/);
    expect(sql).toMatch(/s\.public_status\s*=\s*'public'/);
    expect(sql).toMatch(/visibility_revision\s*=\s*c\.visibility_revision\s*\+\s*1/);
    expect(sql).toMatch(/where\s+c\.admin_visibility_override\s+is\s+not\s+null/);
  });
});
