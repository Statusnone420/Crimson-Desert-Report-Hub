import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260717120000_daily_signal_rollup.sql"),
  "utf8",
);

describe("daily_signal_rollup migration", () => {
  it("is an owner-evaluated, barrier-protected aggregate view", () => {
    expect(migration).toMatch(/create or replace view public\.daily_signal_rollup/i);
    expect(migration).toMatch(/security_invoker = false/i);
    expect(migration).toMatch(/security_barrier = true/i);
  });

  it("exposes only the four aggregate columns", () => {
    const finalSelect = migration.slice(migration.lastIndexOf("select\n"));
    expect(finalSelect).toContain("d.day");
    expect(finalSelect).toMatch(/as reports/);
    expect(finalSelect).toMatch(/as taps/);
    expect(finalSelect).toMatch(/as kept_leads/);
    // No identifying fields may leave the view.
    for (const forbidden of ["voter_ip_hash", "submitter_ip_hash", "source_url", "title", "description"]) {
      expect(finalSelect).not.toContain(forbidden);
    }
  });

  it("uses the real schema names, not the handoff's invented ones", () => {
    expect(migration).toContain("public.bug_reports");
    expect(migration).toContain("moderation_status = 'approved'");
    expect(migration).toContain("public.issue_confirmations");
    expect(migration).toContain("public.automation_runs");
    expect(migration).not.toMatch(/\bscan_candidates\b/);
    expect(migration).not.toMatch(/from reports\b/);
  });

  it("keeps kept-lead semantics aligned with the public scanner funnel", () => {
    expect(migration).toMatch(/mode <> 'dry_run'/);
    expect(migration).toMatch(/status in \('success', 'partial'\)/);
    expect(migration).toMatch(/rescue_candidate/);
  });

  it("grants select only on the view and revokes default access first", () => {
    expect(migration).toMatch(/revoke all on public\.daily_signal_rollup from public, anon, authenticated/i);
    expect(migration).toMatch(/grant select on public\.daily_signal_rollup to anon, authenticated, service_role/i);
    // No grant may touch a raw table.
    expect(migration).not.toMatch(/grant[^;]*on public\.(bug_reports|issue_confirmations|automation_runs|source_signals)/i);
  });
});
