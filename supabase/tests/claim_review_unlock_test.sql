begin;
select plan(13);

insert into public.official_patch_notes (board_no, title, patch_version, official_url, observed_at, is_current)
values ('unlock-board', 'Unlock patch', '8.8.8', 'https://official.example/unlock', '2026-09-08T12:00:00Z', true);
insert into public.official_patch_claimed_fixes (board_no, position, fix_text, category, section)
values ('unlock-board', 0, 'Fixed a boat crash.', 'crash_startup', 'Stability');
insert into public.issue_clusters (id, slug, title, category, description, fix_status, confidence, is_public)
values ('98200000-0000-4000-8000-000000000001', 'unlock-boat', 'Boat crash', 'crash_startup', 'Boat context.', 'reported', 'medium', true);

set local role service_role;
select lives_ok($sql$
  select public.sync_claim_review_proposals(jsonb_build_array(
    jsonb_build_object('claim_text', 'Fixed a boat crash.', 'cluster_id', '98200000-0000-4000-8000-000000000001', 'proposal_kind', 'llm_sure', 'proposal_reason', 'Exact boat support.')
  ), '2026-09-08T13:00:00Z')
$sql$, 'initial scan confirms an exact pairing');

-- Match set/clear lifecycle lock between scans. Clear preserves the forced
-- status but removes its synthetic clock. The exact confirmation still exists.
update public.issue_clusters set admin_override = true, fix_status = 'verified_fixed', lifecycle_reason = 'Manual lock.'
where id = '98200000-0000-4000-8000-000000000001';
update public.issue_clusters set admin_override = false, lifecycle_reason = null, fix_claimed_at = null, fix_claimed_patch_version = null
where id = '98200000-0000-4000-8000-000000000001';
select lives_ok($sql$select public.sync_claim_review_proposals('[]'::jsonb, '2026-09-08T14:00:00Z')$sql$, 'scan reapplies a confirmation omitted from the new proposals');
select is((select fix_status from public.issue_clusters where id = '98200000-0000-4000-8000-000000000001'), 'fix_claimed', 'clear lock returns the issue to its supported claim status');
select ok((select fix_claimed_at = '2026-09-08T14:00:00Z'::timestamptz and fix_claimed_patch_version = '8.8.8' from public.issue_clusters where id = '98200000-0000-4000-8000-000000000001'), 'reconciliation restores the current patch clock');
select ok((select claim_clock_owned from public.claim_review_pairings), 'restored claim clock has a durable owner');
select ok((select p.cluster_lifecycle_revision = c.lifecycle_revision from public.claim_review_pairings p join public.issue_clusters c on c.id = p.cluster_id), 'card snapshot includes the reconciled lifecycle revision');
select is((select state from public.claim_review_pairings), 'confirmed', 'reconciliation preserves the durable decision');
select is((select count(*) from public.claim_review_audit_events), 1::bigint, 'reconciliation does not invent another confirmation event');
select lives_ok($sql$select public.sync_claim_review_proposals('[]'::jsonb, '2026-09-08T15:00:00Z')$sql$, 'repeat reconciliation succeeds');
select is((select fix_claimed_at from public.issue_clusters where id = '98200000-0000-4000-8000-000000000001'), '2026-09-08T14:00:00Z'::timestamptz, 'repeat reconciliation preserves clock age');
update public.official_patch_claimed_fixes set fix_text = 'Fixed a different crash.' where board_no = 'unlock-board';
select lives_ok($sql$select public.sync_claim_review_proposals('[]'::jsonb, '2026-09-08T16:00:00Z')$sql$, 'removed exact claim is retired before reconciliation');
select is((select fix_status from public.issue_clusters where id = '98200000-0000-4000-8000-000000000001'), 'reported', 'reconciliation cannot resurrect retired support');
select ok((select fix_claimed_at is null and fix_claimed_patch_version is null from public.issue_clusters where id = '98200000-0000-4000-8000-000000000001'), 'retirement clears the restored clock');

reset role;
select * from finish();
rollback;
