import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260720214539_hide_duplicate_cluster_signals.sql"),
  "utf8",
).toLowerCase();

describe("duplicate cluster visibility correction migration", () => {
  it("hides every source signal for the force-hidden duplicate cluster", () => {
    expect(migration).toMatch(/update\s+public\.source_signals\s+as\s+signal/);
    expect(migration).toMatch(/public_status\s*=\s*'hidden'/);
    expect(migration).toMatch(/promoted_at\s*=\s*null/);
    expect(migration).toMatch(/promotion_reason\s*=\s*'admin_force_hidden'/);
    expect(migration).toMatch(/from\s+public\.issue_clusters\s+as\s+cluster/);
    expect(migration).toMatch(/signal\.cluster_id\s*=\s*cluster\.id/);
    expect(migration).toMatch(/cluster\.slug\s*=\s*'auto-b7e557a13e9d'/);
    expect(migration).toMatch(/cluster\.admin_visibility_override\s*=\s*'force_hidden'/);
  });
});
