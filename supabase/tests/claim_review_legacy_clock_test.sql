begin;
select plan(23);

insert into public.official_patch_notes (board_no, title, patch_version, official_url, observed_at, is_current)
values ('legacy-clock-board', 'Legacy clock patch', '8.8.8', 'https://official.example/legacy', '2026-09-08T12:00:00Z', true);
insert into public.official_patch_claimed_fixes (board_no, position, fix_text, category, section)
values ('legacy-clock-board', 0, 'Fixed a boat crash.', 'crash_startup', 'Stability'),
  ('legacy-clock-board', 1, 'Fixed a boat stall.', 'crash_startup', 'Stability'),
  ('legacy-clock-board', 2, 'Fixed a sail crash.', 'crash_startup', 'Stability');

-- These clocks predate durable review. Adoption must preserve their age while
-- assigning exactly one confirmed pairing responsibility for clearing them.
insert into public.issue_clusters (id, slug, title, category, description, fix_status, confidence, is_public, fix_claimed_at, fix_claimed_patch_version)
values ('98100000-0000-4000-8000-000000000001', 'legacy-boat', 'Boat crash', 'crash_startup', 'Boat context.', 'fix_claimed', 'medium', true, '2026-09-08T12:00:00Z', '8.8.8'),
  ('98100000-0000-4000-8000-000000000002', 'legacy-sail', 'Sail crash', 'crash_startup', 'Sail context.', 'fix_claimed', 'medium', true, '2026-09-08T12:00:00Z', '8.8.8');

set local role service_role;
select lives_ok($sql$
  select public.sync_claim_review_proposals(jsonb_build_array(
    jsonb_build_object('claim_text', 'Fixed a boat crash.', 'cluster_id', '98100000-0000-4000-8000-000000000001', 'proposal_kind', 'llm_sure', 'proposal_reason', 'Exact crash support.'),
    jsonb_build_object('claim_text', 'Fixed a boat stall.', 'cluster_id', '98100000-0000-4000-8000-000000000001', 'proposal_kind', 'llm_sure', 'proposal_reason', 'Exact stall support.'),
    jsonb_build_object('claim_text', 'Fixed a sail crash.', 'cluster_id', '98100000-0000-4000-8000-000000000002', 'proposal_kind', 'keyword_proposal', 'proposal_reason', 'Sail mapping needs review.')
  ), '2026-09-08T13:00:00Z')
$sql$, 'first durable sync adopts legacy same-patch clocks');
select is((select count(*) from public.claim_review_pairings where cluster_id = '98100000-0000-4000-8000-000000000001' and claim_clock_owned), 1::bigint, 'exactly one confirmed pairing adopts the legacy clock');
select ok((select claim_clock_owned from public.claim_review_pairings where exact_official_text = 'Fixed a boat crash.'), 'first confirmed support adopts the legacy clock');
select is((select fix_claimed_at from public.issue_clusters where id = '98100000-0000-4000-8000-000000000001'), '2026-09-08T12:00:00Z'::timestamptz, 'adoption preserves the legacy timestamp');
select ok((select not claim_clock_owned from public.claim_review_pairings where exact_official_text = 'Fixed a sail crash.'), 'an unconfirmed proposal cannot own the legacy clock');

select lives_ok($sql$
  select public.sync_claim_review_proposals(jsonb_build_array(
    jsonb_build_object('claim_text', 'Fixed a boat stall.', 'cluster_id', '98100000-0000-4000-8000-000000000001', 'proposal_kind', 'llm_sure', 'proposal_reason', 'Repeat stall support.'),
    jsonb_build_object('claim_text', 'Fixed a boat crash.', 'cluster_id', '98100000-0000-4000-8000-000000000001', 'proposal_kind', 'llm_sure', 'proposal_reason', 'Repeat crash support.')
  ), '2026-09-08T14:00:00Z')
$sql$, 'reversed repeat proposals preserve ownership');
select is((select count(*) from public.claim_review_pairings where cluster_id = '98100000-0000-4000-8000-000000000001' and claim_clock_owned), 1::bigint, 'repeat sync does not create another owner');

-- Correction retires the owner and transfers the original clock to the other
-- exact confirmed line. Removing that final line must then clear the clock.
update public.official_patch_claimed_fixes set fix_text = 'Fixed a boat crash on load.' where board_no = 'legacy-clock-board' and position = 0;
select lives_ok($sql$select public.sync_claim_review_proposals('[]'::jsonb, '2026-09-08T15:00:00Z')$sql$, 'corrected legacy support retires');
select ok((select claim_clock_owned from public.claim_review_pairings where exact_official_text = 'Fixed a boat stall.'), 'remaining support takes ownership of the legacy clock');
select is((select fix_claimed_at from public.issue_clusters where id = '98100000-0000-4000-8000-000000000001'), '2026-09-08T12:00:00Z'::timestamptz, 'ownership transfer preserves the legacy timestamp');
update public.official_patch_claimed_fixes set fix_text = 'Fixed a boat stall on load.' where board_no = 'legacy-clock-board' and position = 1;
select lives_ok($sql$select public.sync_claim_review_proposals('[]'::jsonb, '2026-09-08T16:00:00Z')$sql$, 'last legacy support retires');
select is((select fix_status from public.issue_clusters where id = '98100000-0000-4000-8000-000000000001'), 'reported', 'retirement clears the unsupported public status');
select ok((select fix_claimed_at is null and fix_claimed_patch_version is null from public.issue_clusters where id = '98100000-0000-4000-8000-000000000001'), 'retirement clears the legacy clock and provenance');

select lives_ok($sql$
  select public.mutate_claim_review_pairing(id, revision, 'confirm', null, 'test-operator')
  from public.claim_review_pairings where exact_official_text = 'Fixed a sail crash.'
$sql$, 'operator confirmation also adopts an unowned legacy clock');
select ok((select claim_clock_owned from public.claim_review_pairings where exact_official_text = 'Fixed a sail crash.'), 'operator-confirmed pairing owns the legacy clock');
select is((select fix_claimed_at from public.issue_clusters where id = '98100000-0000-4000-8000-000000000002'), '2026-09-08T12:00:00Z'::timestamptz, 'operator adoption preserves the legacy timestamp');
select lives_ok($sql$
  select public.mutate_claim_review_pairing(id, revision, 'undo', null, 'test-operator')
  from public.claim_review_pairings where exact_official_text = 'Fixed a sail crash.'
$sql$, 'operator can undo the adopted legacy confirmation');
select is((select fix_status from public.issue_clusters where id = '98100000-0000-4000-8000-000000000002'), 'reported', 'undo clears the unsupported public status');
select ok((select fix_claimed_at is null and fix_claimed_patch_version is null from public.issue_clusters where id = '98100000-0000-4000-8000-000000000002'), 'undo clears the legacy clock and provenance');

-- Direct undo must work for a scanner-adopted clock as well.
insert into public.issue_clusters (id, slug, title, category, description, fix_status, confidence, is_public, fix_claimed_at, fix_claimed_patch_version)
values ('98100000-0000-4000-8000-000000000003', 'legacy-mast', 'Mast crash', 'crash_startup', 'Mast context.', 'fix_claimed', 'medium', true, '2026-09-08T12:00:00Z', '8.8.8');
insert into public.official_patch_claimed_fixes (board_no, position, fix_text, category, section)
values ('legacy-clock-board', 3, 'Fixed a mast crash.', 'crash_startup', 'Stability');
select lives_ok($sql$
  select public.sync_claim_review_proposals(jsonb_build_array(
    jsonb_build_object('claim_text', 'Fixed a mast crash.', 'cluster_id', '98100000-0000-4000-8000-000000000003', 'proposal_kind', 'llm_sure', 'proposal_reason', 'Exact mast support.')
  ), '2026-09-08T17:00:00Z')
$sql$, 'scanner adopts a single-support legacy clock');
select ok((select claim_clock_owned from public.claim_review_pairings where exact_official_text = 'Fixed a mast crash.'), 'scanner confirmation owns the single-support legacy clock');
select lives_ok($sql$
  select public.mutate_claim_review_pairing(id, revision, 'undo', null, 'test-operator')
  from public.claim_review_pairings where exact_official_text = 'Fixed a mast crash.'
$sql$, 'operator can undo a scanner-adopted legacy clock');
select ok((select fix_status = 'reported' and fix_claimed_at is null and fix_claimed_patch_version is null from public.issue_clusters where id = '98100000-0000-4000-8000-000000000003'), 'undo of scanner adoption clears the status, timestamp, and provenance');

reset role;
select * from finish();
rollback;
