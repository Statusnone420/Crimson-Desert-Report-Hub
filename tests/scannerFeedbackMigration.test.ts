import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260722170106_scanner_feedback_and_platform_pulse.sql"),
  "utf8",
);

describe("scanner feedback migration", () => {
  it("stores auditable decisions separately from active feedback rules", () => {
    expect(sql).toMatch(/create table if not exists public\.scanner_decisions/i);
    expect(sql).toMatch(/create table if not exists public\.scanner_feedback_rules/i);
    expect(sql).toMatch(/decision in \('relevant', 'off_topic', 'wrong_patch', 'not_issue_report', 'duplicate'\)/i);
    expect(sql).toMatch(/scope_type in \('exact_url', 'source_path', 'source_domain'\)/i);
    expect(sql).toMatch(/candidate_id uuid references public\.automation_rejected_candidates\(id\) on delete set null/i);
    expect(sql).not.toMatch(/check \(candidate_id is not null or signal_id is not null\)/i);
  });

  it("requires explicit confirmation before creating broader rules", () => {
    expect(sql).toMatch(/scope_type = 'exact_url' or confirmed_at is not null/i);
    expect(sql).toMatch(/p_scope_type <> 'exact_url' and not p_confirm_broad/i);
  });

  it("keeps cluster overrides out of the learning contract and supports undo", () => {
    const learningFunction = sql.match(/create or replace function public\.record_scanner_decision[\s\S]*?\n\$\$;/i)?.[0] ?? "";
    expect(learningFunction).not.toMatch(/admin_visibility_override/i);
    expect(sql).toMatch(/create or replace function public\.undo_scanner_decision/i);
    expect(sql).toMatch(/set revoked_at = pg_catalog\.coalesce\(revoked_at, pg_catalog\.now\(\)\)/i);
    const undoFunction = sql.match(/create or replace function public\.undo_scanner_decision[\s\S]*?\n\$\$;/i)?.[0] ?? "";
    expect(undoFunction).toMatch(/update public\.automation_rejected_candidates/i);
    expect(undoFunction).toMatch(/set decision_id = null,\s*feedback_rule_id = null,\s*decided_at = null/i);
    expect(undoFunction).toMatch(/where decision_id = p_decision_id\s*and rescued_at is null/i);
    expect(undoFunction).toMatch(/returns table \(undone boolean, affected_cluster_id uuid\)/i);
    expect(undoFunction).toMatch(/return query select true, signal_cluster_id/i);
  });

  it("quarantines a kept signal while its exact-URL block rule is active", () => {
    const learningFunction = sql.match(/create or replace function public\.record_scanner_decision[\s\S]*?\n\$\$;/i)?.[0] ?? "";
    expect(learningFunction).toMatch(/\(p_candidate_id is null\) = \(p_signal_id is null\)/i);
    expect(learningFunction).toMatch(/p_signal_id is not null and p_scope_type <> 'exact_url'/i);
    expect(learningFunction).toMatch(/p_signal_id is not null and p_decision = 'relevant'/i);
    expect(learningFunction).toMatch(/pg_advisory_xact_lock\(20260709, 1\)[\s\S]*scanner-feedback:/i);
    expect(learningFunction).toMatch(
      /update public\.source_signals\s+set public_status = 'hidden',[\s\S]*promotion_reason = 'operator_feedback_blocked'/i,
    );
    expect(learningFunction).toMatch(/update public\.issue_clusters\s+set visibility_revision = visibility_revision \+ 1/i);
    expect(learningFunction).toMatch(/returns table \(decision_id uuid, rule_id uuid, affected_cluster_id uuid\)/i);
    expect(learningFunction).toMatch(/return query select new_decision_id, new_rule_id, signal_cluster_id/i);
  });

  it("locks all new records to the server role", () => {
    expect(sql).toMatch(/alter table public\.scanner_decisions enable row level security/i);
    expect(sql).toMatch(/alter table public\.scanner_feedback_rules enable row level security/i);
    expect(sql).toMatch(/revoke all on public\.scanner_decisions from public, anon, authenticated/i);
    expect(sql).toMatch(/grant select, insert, update, delete on public\.scanner_feedback_rules to service_role/i);
  });

  it("adds privacy-bounded Steam receipts and aggregate pulse snapshots", () => {
    expect(sql).toMatch(/create table if not exists public\.steam_review_receipts/i);
    expect(sql).toMatch(/recommendation_hash text primary key/i);
    expect(sql).toMatch(/create table if not exists public\.steam_pulse_snapshots/i);
    expect(sql).toMatch(/review_count_delta integer\s*,/i);
    expect(sql).not.toMatch(/review_count_delta integer not null/i);
    expect(sql).toMatch(/source in \('reddit', 'web_search', 'steam_review'/i);
    expect(sql).not.toMatch(/steam_(?:review_receipts|pulse_snapshots)[\s\S]*steamid/i);
    expect(sql).not.toMatch(/steam_(?:review_receipts|pulse_snapshots)[\s\S]*review_text/i);
  });

  it("stores Twitch and IGDB as identity-free platform context", () => {
    expect(sql).toMatch(/create table if not exists public\.platform_context_snapshots/i);
    expect(sql).toMatch(/twitch_live_streams integer/i);
    expect(sql).toMatch(/twitch_live_viewers integer/i);
    expect(sql).toMatch(/igdb_platforms text\[\]/i);
    expect(sql).not.toMatch(/platform_context_snapshots[\s\S]*(?:oauth_token|user_name|stream_title|thumbnail_url)/i);
    expect(sql).toMatch(/revoke all on public\.platform_context_snapshots from public, anon, authenticated/i);
  });

  it("requires active visibility overrides to carry an operator reason", () => {
    expect(sql).toMatch(/admin_visibility_reason text/i);
    expect(sql).toMatch(/issue_clusters_visibility_override_explained/i);
    expect(sql).toMatch(/visibility override reason required/i);
    expect(sql).toMatch(/p_reason text default null/i);
    expect(sql).toMatch(/admin_visibility_override is not null\s+and admin_visibility_reason is not null/i);
  });
});
