import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260717100836_atomic_official_patch_claimed_fixes_sync.sql",
);

describe("atomic official patch and claimed-fix migration", () => {
  it("keeps the note transition and claimed-fix replacement in one RPC transaction", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toMatch(/create or replace function public\.sync_official_patch_note_with_claimed_fixes\(/i);
    expect(sql).toMatch(/security invoker/i);
    expect(sql).toMatch(/set search_path = ''/i);
    expect(sql).toMatch(/pg_advisory_xact_lock\([\s\S]*official_patch_notes_current/i);
    expect(sql).toMatch(/update public\.official_patch_notes[\s\S]*set is_current = false/i);
    expect(sql).toMatch(/insert into public\.official_patch_notes[\s\S]*on conflict \(board_no\)/i);
    expect(sql).toMatch(/delete from public\.official_patch_claimed_fixes[\s\S]*where board_no = p_board_no/i);
    expect(sql).toMatch(/insert into public\.official_patch_claimed_fixes[\s\S]*fix_position/i);
  });

  it("exposes the combined writer only to the service role", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toMatch(/revoke all on function public\.sync_official_patch_note_with_claimed_fixes\([\s\S]*from public, anon, authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.sync_official_patch_note_with_claimed_fixes\([\s\S]*to service_role/i);
  });
});
