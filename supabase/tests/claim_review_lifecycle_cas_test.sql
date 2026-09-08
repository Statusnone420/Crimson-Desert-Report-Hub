begin;
select plan(9);
insert into public.official_patch_notes (board_no, title, patch_version, official_url, observed_at, is_current)
values ('cas-board', 'CAS patch', '8.8.8', 'https://official.example/cas', '2026-09-08T12:00:00Z', true);
insert into public.official_patch_claimed_fixes (board_no, position, fix_text, category, section)
values ('cas-board', 0, 'Fixed a boat crash.', 'crash_startup', 'Stability');
insert into public.issue_clusters (id, slug, title, category, description, fix_status, confidence, is_public)
values ('98600000-0000-4000-8000-000000000001', 'cas-boat', 'Boat crash', 'crash_startup', 'Boat context.', 'reported', 'medium', true);
set local role service_role;
select lives_ok($sql$select public.sync_claim_review_proposals(jsonb_build_array(jsonb_build_object(
  'claim_text', 'Fixed a boat crash.', 'cluster_id', '98600000-0000-4000-8000-000000000001', 'proposal_kind', 'keyword_proposal', 'proposal_reason', 'Boat match needs review.'
)), '2026-09-08T13:00:00Z')$sql$, 'pending review captures the original lifecycle state');
update public.issue_clusters set admin_override = true, fix_status = 'verified_fixed', lifecycle_reason = 'Manual verification.'
where id = '98600000-0000-4000-8000-000000000001';
update public.issue_clusters set admin_override = false, lifecycle_reason = null, fix_claimed_at = null, fix_claimed_patch_version = null
where id = '98600000-0000-4000-8000-000000000001';
select throws_ok($sql$select public.mutate_claim_review_pairing(id, revision, 'confirm', null, 'test-operator') from public.claim_review_pairings$sql$,
  'P0001', 'stale_claim_review_cluster', 'old card cannot overwrite a changed lifecycle after Clear Lock');
select is((select fix_status from public.issue_clusters where id = '98600000-0000-4000-8000-000000000001'), 'verified_fixed', 'stale action preserves current status');
select is((select state from public.claim_review_pairings), 'pending', 'stale action preserves pairing state');
select is((select count(*) from public.claim_review_audit_events), 1::bigint, 'stale action adds no audit event');
select lives_ok($sql$select public.mutate_claim_review_pairing(p.id, p.revision, 'confirm', null, 'test-operator', c.lifecycle_revision)
  from public.claim_review_pairings p join public.issue_clusters c on c.id = p.cluster_id$sql$,
  'freshly loaded lifecycle token lets the operator decide without a scanner pass');
select is((select state from public.claim_review_pairings), 'confirmed', 'fresh review can confirm');
update public.issue_clusters set title = 'Renamed boat crash', slug = 'renamed-cas-boat'
where id = '98600000-0000-4000-8000-000000000001';
select lives_ok($sql$select public.mutate_claim_review_pairing(id, revision, 'undo', null, 'test-operator') from public.claim_review_pairings$sql$,
  'identity-only rename does not invalidate the lifecycle token');
select is((select state from public.claim_review_pairings), 'pending', 'rename still permits undo');
reset role;
select * from finish();
rollback;
