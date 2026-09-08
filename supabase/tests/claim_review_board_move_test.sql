begin;
select plan(11);
insert into public.official_patch_notes (board_no, title, patch_version, official_url, observed_at, is_current)
values ('move-old', 'Old notice', '8.8.8', 'https://official.example/old', '2026-09-08T12:00:00Z', true);
insert into public.official_patch_claimed_fixes (board_no, position, fix_text, category, section)
values ('move-old', 0, 'Fixed a boat crash.', 'crash_startup', 'Stability');
insert into public.issue_clusters (id, slug, title, category, description, fix_status, confidence, is_public)
values ('98400000-0000-4000-8000-000000000001', 'move-boat', 'Boat crash', 'crash_startup', 'Boat context.', 'reported', 'medium', true);
set local role service_role;
select lives_ok($sql$select public.sync_claim_review_proposals(jsonb_build_array(jsonb_build_object(
  'claim_text', 'Fixed a boat crash.', 'cluster_id', '98400000-0000-4000-8000-000000000001', 'proposal_kind', 'llm_sure', 'proposal_reason', 'Exact support.'
)), '2026-09-08T13:00:00Z')$sql$, 'original notice confirms the exact claim');
update public.official_patch_notes set is_current = false;
insert into public.official_patch_notes (board_no, title, patch_version, official_url, observed_at, is_current)
values ('move-new', 'New notice', '8.8.8', 'https://official.example/new', '2026-09-08T14:00:00Z', true);
insert into public.official_patch_claimed_fixes (board_no, position, fix_text, category, section)
values ('move-new', 2, 'Fixed a boat crash.', 'crash_startup', 'Updated section');
select is((select count(*) from public.sync_claim_review_proposals('[]'::jsonb, '2026-09-08T15:00:00Z')), 1::bigint, 'unreproposed confirmation still returns after notice move');
select is((select count(*) from public.claim_review_pairings), 1::bigint, 'notice move preserves pairing identity');
select is((select board_no from public.claim_review_pairings), 'move-new', 'pairing follows the current notice');
select is((select official_url from public.claim_review_pairings), 'https://official.example/new', 'pairing follows the current source URL');
select is((select official_section from public.claim_review_pairings), 'Updated section', 'pairing follows current section context');
select is((select state from public.claim_review_pairings), 'confirmed', 'notice move preserves the decision');
select is((select count(*) from public.claim_review_audit_events), 1::bigint, 'notice move does not invent a new decision');
select is((select fix_claimed_at from public.issue_clusters where id = '98400000-0000-4000-8000-000000000001'), '2026-09-08T13:00:00Z'::timestamptz, 'notice move preserves clock age');
select lives_ok($sql$select public.mutate_claim_review_pairing(id, revision, 'undo', null, 'test-operator') from public.claim_review_pairings$sql$, 'moved pairing is still actionable');
select is((select fix_status from public.issue_clusters where id = '98400000-0000-4000-8000-000000000001'), 'reported', 'undo after notice move clears the supported status');
reset role;
select * from finish();
rollback;
