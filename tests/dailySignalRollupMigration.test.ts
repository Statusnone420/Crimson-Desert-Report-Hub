import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const originalMigration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260717120000_daily_signal_rollup.sql"),
  "utf8",
);
const advisorMigration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260720093000_drop_daily_signal_rollup_security_definer_view.sql"),
  "utf8",
);

describe("daily_signal_rollup migrations", () => {
  it("documents the superseded owner-evaluated aggregate view contract", () => {
    expect(originalMigration).toMatch(/create or replace view public\.daily_signal_rollup/i);
    expect(originalMigration).toMatch(/security_invoker = false/i);
    expect(originalMigration).toMatch(/security_barrier = true/i);
  });

  it("removes the security-definer view flagged by the Supabase advisor", () => {
    expect(advisorMigration).toMatch(/drop view if exists public\.daily_signal_rollup/i);
    expect(advisorMigration).not.toMatch(/create\s+(or\s+replace\s+)?view/i);
    expect(advisorMigration).not.toMatch(/security_invoker\s*=\s*false/i);
  });

  it("does not grant raw table or replacement public view access", () => {
    expect(advisorMigration).not.toMatch(/grant[^;]*on public\.(bug_reports|issue_confirmations|automation_runs|source_signals)/i);
    expect(advisorMigration).not.toMatch(/grant[^;]*on public\.daily_signal_rollup/i);
  });
});
