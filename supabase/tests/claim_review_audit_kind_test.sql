begin;
select plan(14);
insert into public.official_patch_notes (board_no, title, patch_version, official_url, observed_at, is_current)
values ('audit-kind', 'Audit patch', '8.8.8', 'https://official.example/audit', '2026-09-08T12:00:00Z', true);
insert into public.official_patch_claimed_fixes (board_no, position, fix_text, category, section)
values ('audit-kind', 0, 'Fixed a boat crash.', 'crash_startup', 'Stability');
insert into public.issue_clusters (id, slug, title, category, description, fix_status, confidence, is_public)
values ('98700000-0000-4000-8000-000000000001', 'audit-boat', 'Boat crash', 'crash_startup', 'Boat context.', 'reported', 'medium', true);
set local role service_role;
select lives_ok($sql$select public.sync_claim_review_proposals(jsonb_build_array(jsonb_build_object(
  'claim_text', 'Fixed a boat crash.', 'cluster_id', '98700000-0000-4000-8000-000000000001', 'proposal_kind', 'keyword_proposal', 'proposal_reason', 'Keyword mapping.'
)), '2026-09-08T13:00:00Z')$sql$, 'keyword proposal creates an audit event');
select lives_ok($sql$select public.sync_claim_review_proposals(jsonb_build_array(jsonb_build_object(
  'claim_text', 'Fixed a boat crash.', 'cluster_id', '98700000-0000-4000-8000-000000000001', 'proposal_kind', 'llm_unsure', 'proposal_reason', 'Uncertain mapping.'
)), '2026-09-08T14:00:00Z')$sql$, 'uncertain reclassification is accepted');
select is((select count(*) from public.claim_review_audit_events), 2::bigint, 'classification change is recorded even when the decision is unchanged');
select is((select state from public.claim_review_pairings), 'pending', 'classification change does not decide the pairing');
select is((select proposal_kind from public.claim_review_audit_events where occurred_at = '2026-09-08T13:00:00Z'), 'keyword_proposal', 'original event retains keyword classification');
select is((select proposal_kind from public.claim_review_audit_events where occurred_at = '2026-09-08T14:00:00Z'), 'llm_unsure', 'new event snapshots uncertain classification');
select lives_ok($sql$select public.mutate_claim_review_pairing(id, revision, 'reject', 'Different issue.', 'test-operator') from public.claim_review_pairings$sql$, 'operator rejection is recorded');
select is((select proposal_kind from public.claim_review_audit_events where action = 'rejected'), 'llm_unsure', 'operator event retains its classification');
select lives_ok($sql$select public.sync_claim_review_proposals(jsonb_build_array(jsonb_build_object(
  'claim_text', 'Fixed a boat crash.', 'cluster_id', '98700000-0000-4000-8000-000000000001', 'proposal_kind', 'llm_sure', 'proposal_reason', 'Confident reclassification.'
)), '2026-09-08T15:00:00Z')$sql$, 'confident reclassification cannot bypass rejection');
select is((select state from public.claim_review_pairings), 'rejected', 'durable rejection is preserved');
select is((select action from public.claim_review_audit_events where occurred_at = '2026-09-08T15:00:00Z' and proposal_kind = 'llm_sure'), 'proposed', 'same-state reclassification is not labeled a new confirmation');
update public.official_patch_claimed_fixes set fix_text = 'Fixed a different crash.' where board_no = 'audit-kind';
select lives_ok($sql$select public.sync_claim_review_proposals('[]'::jsonb, '2026-09-08T16:00:00Z')$sql$, 'retirement is recorded');
select is((select proposal_kind from public.claim_review_audit_events where action = 'retired'), 'llm_sure', 'retirement snapshots its classification');
select ok((select bool_and(proposal_kind is not null) from public.claim_review_audit_events), 'every scanner and operator audit event has a kind snapshot');
reset role;
select * from finish();
rollback;
