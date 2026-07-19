import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260719200000_signal_observation_events.sql"),
  "utf8",
);

describe("signal observation events migration", () => {
  it("creates a server-only, RLS-protected event ledger with explicit service grants", () => {
    expect(migration).toMatch(
      /create table if not exists public\.signal_observation_events[\s\S]*signal_id uuid not null references public\.source_signals\(id\) on delete cascade/i,
    );
    expect(migration).toMatch(/run_id uuid references public\.automation_runs\(id\) on delete set null/i);
    expect(migration).toMatch(/alter table public\.signal_observation_events enable row level security/i);
    expect(migration).toMatch(
      /revoke all on public\.signal_observation_events from public, anon, authenticated/i,
    );
    expect(migration).toMatch(
      /grant select, insert, update, delete on public\.signal_observation_events to service_role/i,
    );
    expect(migration).toMatch(
      /revoke all on sequence public\.signal_observation_events_id_seq from public, anon, authenticated/i,
    );
    expect(migration).toMatch(
      /grant usage, select on sequence public\.signal_observation_events_id_seq to service_role/i,
    );
    expect(migration).not.toMatch(/grant[^;]+to\s+(?:public|anon|authenticated)\s*;/i);
  });
});
