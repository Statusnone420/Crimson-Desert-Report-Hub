begin;
select plan(5);

insert into public.issue_clusters (id, slug, title, category, description, fix_status, confidence, is_public, lifecycle_reason)
values ('98300000-0000-4000-8000-000000000001', 'legacy-no-patch', 'Legacy crash', 'crash_startup', 'Legacy context.', 'reported', 'medium', true, 'Needs review: legacy decision.');
set local role service_role;
select throws_ok($sql$select public.sync_claim_review_proposals('[]'::jsonb, '2026-09-08T12:00:00Z')$sql$,
  'P0001', 'claim_review_current_patch_unavailable', 'missing current patch fails instead of returning empty durable success');
select is((select lifecycle_reason from public.issue_clusters where id = '98300000-0000-4000-8000-000000000001'), 'Needs review: legacy decision.', 'legacy decision survives the failed sync');
select is((select count(*) from public.claim_review_sync_state), 0::bigint, 'failed sync does not mark durable review ready');
select is((select count(*) from public.claim_review_pairings), 0::bigint, 'failed sync does not fabricate pairings');
select is((public.owner_attention_brief() #>> '{adminAttention,unsureClaimMatches}')::integer, 1, 'owner brief keeps the outstanding legacy decision');
reset role;
select * from finish();
rollback;
