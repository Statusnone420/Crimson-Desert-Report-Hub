import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260720221442_scrub_source_signal_summary_retention_note.sql"),
  "utf8",
).toLowerCase();

describe("source summary retention-note correction migration", () => {
  it("removes only the legacy moderator-retention suffix from source summaries", () => {
    expect(migration).toMatch(/update\s+public\.source_signals/);
    expect(migration).toMatch(/set\s+summary\s*=\s*btrim\s*\(\s*regexp_replace\s*\(\s*summary,/);
    expect(migration).toMatch(/body retained for 48h moderator review/);
    expect(migration).toMatch(/where\s+summary\s+~\*/);
    expect(migration).toMatch(/\[\[:space:\]\]\*\$/);
  });
});
