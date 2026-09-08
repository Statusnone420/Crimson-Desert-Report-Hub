begin;
select plan(14);
insert into public.official_patch_notes (board_no, title, patch_version, official_url, observed_at, is_current)
values ('pending-support', 'Support patch', '8.8.8', 'https://official.example/support', '2026-09-08T12:00:00Z', true);
insert into public.official_patch_claimed_fixes (board_no, position, fix_text, category, section)
values ('pending-support', 0, 'Fixed a boat crash.', 'crash_startup', 'Stability'),
  ('pending-support', 1, 'Fixed a boat stall.', 'crash_startup', 'Stability');
insert into public.issue_clusters (id, slug, title, category, description, fix_status, confidence, is_public)
values ('98500000-0000-4000-8000-000000000001', 'support-pending', 'Pending boat', 'crash_startup', 'Boat context.', 'reported', 'medium', true),
  ('98500000-0000-4000-8000-000000000002', 'support-later', 'Deferred boat', 'crash_startup', 'Boat context.', 'reported', 'medium', true);
set local role service_role;
select lives_ok($sql$
  select public.sync_claim_review_proposals((select jsonb_agg(jsonb_build_object(
    'claim_text', fixes.claim_text, 'cluster_id', clusters.id,
    'proposal_kind', fixes.kind, 'proposal_reason', fixes.reason
  )) from (values ('98500000-0000-4000-8000-000000000001'), ('98500000-0000-4000-8000-000000000002')) as clusters(id)
  cross join (values ('Fixed a boat crash.', 'llm_sure', 'Exact crash support.'),
    ('Fixed a boat stall.', 'keyword_proposal', 'Stall mapping needs review.')) as fixes(claim_text, kind, reason)), '2026-09-08T13:00:00Z')
$sql$, 'each cluster has one confirmed and one pending pairing');
select lives_ok($sql$select public.mutate_claim_review_pairing(id, revision, 'later', null, 'test-operator')
  from public.claim_review_pairings where cluster_id = '98500000-0000-4000-8000-000000000002' and exact_official_text = 'Fixed a boat stall.'$sql$,
  'second cluster defers its pending pairing');
update public.official_patch_claimed_fixes set fix_text = 'Fixed a different crash.' where board_no = 'pending-support' and position = 0;
select lives_ok($sql$select public.sync_claim_review_proposals('[]'::jsonb, '2026-09-08T14:00:00Z')$sql$, 'correction retires confirmed support without re-proposing pending mappings');
select is((select count(*) from public.claim_review_pairings where state in ('pending', 'later')), 2::bigint, 'both undecided pairings survive');
select ok((select bool_and(fix_status = 'reported') from public.issue_clusters where slug in ('support-pending', 'support-later')), 'retirement returns both clusters to reported');
select ok((select bool_and(fix_claimed_at is null and fix_claimed_patch_version is null) from public.issue_clusters where slug in ('support-pending', 'support-later')), 'pending mappings do not keep unsupported claim clocks');
select ok((select bool_and(lifecycle_reason = 'Needs review: Stall mapping needs review.') from public.issue_clusters where slug in ('support-pending', 'support-later')), 'pending and deferred reasons are restored');
select ok((select bool_and(p.cluster_lifecycle_revision = c.lifecycle_revision) from public.claim_review_pairings p join public.issue_clusters c on c.id = p.cluster_id where p.state in ('pending', 'later')), 'surviving cards have current revisions');
select lives_ok($sql$select public.sync_claim_review_proposals('[]'::jsonb, '2026-09-08T15:00:00Z')$sql$, 'repeat sync reconciles omitted decisions');
select ok((select bool_and(lifecycle_reason = 'Needs review: Stall mapping needs review.') from public.issue_clusters where slug in ('support-pending', 'support-later')), 'repeat sync preserves the outstanding reasons');
select is((public.owner_attention_brief() #>> '{adminAttention,unsureClaimMatches}')::integer, 2, 'brief counts both surviving decisions');
select lives_ok($sql$select public.mutate_claim_review_pairing(id, revision, 'reject', 'Different issue.', 'test-operator')
  from public.claim_review_pairings where state in ('pending', 'later')$sql$, 'both surviving decisions can be rejected');
select lives_ok($sql$select public.sync_claim_review_proposals('[]'::jsonb, '2026-09-08T16:00:00Z')$sql$, 'rejected decisions reconcile without new proposals');
select ok((select bool_and(lifecycle_reason is null) from public.issue_clusters where slug in ('support-pending', 'support-later')), 'rejected decisions do not leave a review reason');
reset role;
select * from finish();
rollback;
