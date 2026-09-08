begin;
select plan(5);
insert into public.official_patch_notes (board_no, title, patch_version, official_url, observed_at, is_current)
values ('reject-reason', 'Reason patch', '8.8.8', 'https://official.example/reason', '2026-09-08T12:00:00Z', true);
insert into public.official_patch_claimed_fixes (board_no, position, fix_text, category, section)
values ('reject-reason', 0, 'Fixed a boat crash.', 'crash_startup', 'Stability'),
  ('reject-reason', 1, 'Fixed a boat stall.', 'crash_startup', 'Stability');
insert into public.issue_clusters (id, slug, title, category, description, fix_status, confidence, is_public)
values ('98900000-0000-4000-8000-000000000001', 'reject-reason', 'Boat crash', 'crash_startup', 'Boat context.', 'reported', 'medium', true);
set local role service_role;
select lives_ok($sql$select public.sync_claim_review_proposals(jsonb_build_array(jsonb_build_object(
  'claim_text', 'Fixed a boat crash.', 'cluster_id', '98900000-0000-4000-8000-000000000001', 'proposal_kind', 'keyword_proposal', 'proposal_reason', 'Crash mapping still needs review.'
)), '2026-09-08T13:00:00Z')$sql$, 'first pending mapping is recorded');
select lives_ok($sql$select public.sync_claim_review_proposals(jsonb_build_array(jsonb_build_object(
  'claim_text', 'Fixed a boat stall.', 'cluster_id', '98900000-0000-4000-8000-000000000001', 'proposal_kind', 'keyword_proposal', 'proposal_reason', 'Stall mapping is newer.'
)), '2026-09-08T14:00:00Z')$sql$, 'newer pending mapping supplies the current reason');
select lives_ok($sql$select public.mutate_claim_review_pairing(id, revision, 'reject', 'Different issue.', 'test-operator')
  from public.claim_review_pairings where exact_official_text = 'Fixed a boat stall.'$sql$, 'operator rejects the newer mapping');
select is((select lifecycle_reason from public.issue_clusters where id = '98900000-0000-4000-8000-000000000001'), 'Needs review: Crash mapping still needs review.', 'reason immediately describes the surviving mapping');
select is((select count(*) from public.claim_review_pairings where state = 'pending'), 1::bigint, 'the older mapping remains pending');
reset role;
select * from finish();
rollback;
