begin;
select plan(8);
insert into public.official_patch_notes (board_no, title, patch_version, official_url, observed_at, is_current)
values ('current-support', 'Support patch', '8.8.8', 'https://official.example/support', '2026-09-08T12:00:00Z', true);
insert into public.official_patch_claimed_fixes (board_no, position, fix_text, category, section)
values ('current-support', 0, 'Fixed a boat crash.', 'crash_startup', 'Stability'),
  ('current-support', 1, 'Fixed a boat stall.', 'crash_startup', 'Stability');
insert into public.issue_clusters (id, slug, title, category, description, fix_status, confidence, is_public)
values ('98800000-0000-4000-8000-000000000001', 'obsolete-owner', 'Boat crash', 'crash_startup', 'Boat context.', 'reported', 'medium', true),
  ('98800000-0000-4000-8000-000000000002', 'current-owner', 'Boat stall', 'crash_startup', 'Boat context.', 'reported', 'medium', true);
set local role service_role;
select lives_ok($sql$select public.sync_claim_review_proposals(jsonb_build_array(
  jsonb_build_object('claim_text', 'Fixed a boat crash.', 'cluster_id', '98800000-0000-4000-8000-000000000001', 'proposal_kind', 'llm_sure', 'proposal_reason', 'Crash first.'),
  jsonb_build_object('claim_text', 'Fixed a boat stall.', 'cluster_id', '98800000-0000-4000-8000-000000000001', 'proposal_kind', 'llm_sure', 'proposal_reason', 'Stall second.'),
  jsonb_build_object('claim_text', 'Fixed a boat stall.', 'cluster_id', '98800000-0000-4000-8000-000000000002', 'proposal_kind', 'llm_sure', 'proposal_reason', 'Stall first.'),
  jsonb_build_object('claim_text', 'Fixed a boat crash.', 'cluster_id', '98800000-0000-4000-8000-000000000002', 'proposal_kind', 'llm_sure', 'proposal_reason', 'Crash second.')
), '2026-09-08T13:00:00Z')$sql$, 'both clusters have two confirmed claims');
select ok((select claim_clock_owned from public.claim_review_pairings where cluster_id = '98800000-0000-4000-8000-000000000001' and exact_official_text = 'Fixed a boat crash.'), 'first cluster has the soon-obsolete owner');
select ok((select claim_clock_owned from public.claim_review_pairings where cluster_id = '98800000-0000-4000-8000-000000000002' and exact_official_text = 'Fixed a boat stall.'), 'second cluster has the still-current owner');
update public.official_patch_claimed_fixes set fix_text = 'Fixed a different crash.' where board_no = 'current-support' and position = 0;
select is((select count(*) from public.claim_review_pairings where exact_official_text = 'Fixed a boat crash.' and state = 'confirmed'), 2::bigint, 'removed claims have not been retired by a scan yet');
select lives_ok($sql$select public.mutate_claim_review_pairing(id, revision, 'undo', null, 'test-operator')
  from public.claim_review_pairings where exact_official_text = 'Fixed a boat stall.'$sql$, 'undo checks current support with either ownership arrangement');
select ok((select bool_and(fix_status = 'reported') from public.issue_clusters where slug in ('obsolete-owner', 'current-owner')), 'obsolete siblings cannot preserve claim status');
select ok((select bool_and(fix_claimed_at is null and fix_claimed_patch_version is null) from public.issue_clusters where slug in ('obsolete-owner', 'current-owner')), 'unsupported clocks clear even when the obsolete sibling owned them');
select is((select count(*) from public.claim_review_pairings where exact_official_text = 'Fixed a boat stall.' and state = 'pending'), 2::bigint, 'both current confirmations are undone');
reset role;
select * from finish();
rollback;
