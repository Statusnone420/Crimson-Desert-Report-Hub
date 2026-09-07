begin;
select plan(62);

select ok(has_function_privilege('service_role', 'public.sync_claim_review_proposals(jsonb,timestamptz)', 'EXECUTE'), 'service role can sync claim-review proposals');
select ok(not has_function_privilege('anon', 'public.sync_claim_review_proposals(jsonb,timestamptz)', 'EXECUTE'), 'anon cannot sync claim-review proposals');
select ok(not has_function_privilege('authenticated', 'public.mutate_claim_review_pairing(uuid,integer,text,text,text)', 'EXECUTE'), 'authenticated cannot mutate claim review');
select ok(not has_table_privilege('anon', 'public.claim_review_pairings', 'SELECT'), 'anon cannot read private pairings');
select ok(not has_table_privilege('authenticated', 'public.claim_review_audit_events', 'SELECT'), 'authenticated cannot read private audit');
select is(
  public.claim_review_normalize(chr(5760) || 'Fixed' || chr(8239) || 'crash' || chr(65279)),
  'Fixed crash', 'database normalization collapses the JavaScript Unicode whitespace set'
);
select is(
  public.claim_review_normalize('Fixe' || chr(769) || 'd'),
  'Fixéd', 'database normalization applies NFC before hashing'
);

insert into public.official_patch_notes (board_no, title, patch_version, official_url, observed_at, is_current)
values ('claim-review-board', 'Claim review patch', '9.9.9', 'https://official.example/patch', '2026-09-07T12:00:00Z', true);
insert into public.official_patch_claimed_fixes (board_no, position, fix_text, category, section)
values ('claim-review-board', 0, 'Fixed a map crash.', 'crash_startup', 'Stability');
insert into public.issue_clusters (id, slug, title, category, description, fix_status, confidence, is_public)
values ('98000000-0000-4000-8000-000000000001', 'claim-review-map', 'Map crash', 'crash_startup', 'Map crash context.', 'reported', 'medium', true);

set local role service_role;
select lives_ok($sql$
  select public.sync_claim_review_proposals(jsonb_build_array(jsonb_build_object(
    'claim_text', ' Fixed a map crash. ', 'cluster_id', '98000000-0000-4000-8000-000000000001',
    'proposal_kind', 'keyword_proposal', 'proposal_reason', 'Keyword match needs review.'
  )), '2026-09-07T12:01:00Z')
$sql$, 'keyword proposal is recorded');
select is((select state from public.claim_review_pairings), 'pending', 'proposal begins pending');
select is((select seen_count from public.claim_review_pairings), 1, 'pending proposal counts once');
select is((select count(*) from public.claim_review_audit_events), 1::bigint, 'proposal has append-only audit');
select is((public.owner_attention_brief() #>> '{adminAttention,unsureClaimMatches}')::integer, 1, 'brief counts one current eligible pending pairing');
select is(public.owner_attention_brief() #>> '{adminAttention,claimReviewPath}', '/operator?view=claims', 'brief links directly to claim review');

select lives_ok($sql$
  select public.sync_claim_review_proposals(jsonb_build_array(jsonb_build_object(
    'claim_text', 'Fixed a map crash.', 'cluster_id', '98000000-0000-4000-8000-000000000001',
    'proposal_kind', 'keyword_proposal', 'proposal_reason', 'Keyword match needs review.'
  )), '2026-09-07T12:02:00Z')
$sql$, 'repeat proposal updates the same pairing');
select is((select count(*) from public.claim_review_pairings), 1::bigint, 'repeat does not create a second pending pairing');
select is((select seen_count from public.claim_review_pairings), 2, 'repeat updates scanner sighting');

select lives_ok($sql$
  select public.mutate_claim_review_pairing(id, revision, 'later', null, 'test-operator') from public.claim_review_pairings
$sql$, 'later is an atomic operator action');
select is((select state from public.claim_review_pairings), 'later', 'later stays an active pairing');
select is((select count(*) from public.claim_review_pairings where state in ('pending', 'later')), 1::bigint, 'later counts exactly once');
select isnt((select seen_by_operator_at from public.claim_review_pairings), null::timestamptz, 'later records operator acknowledgement separately');

select lives_ok($sql$
  select public.mutate_claim_review_pairing(id, revision, 'reject', 'This is a different map issue.', 'test-operator') from public.claim_review_pairings
$sql$, 'operator can reject an active pairing');
select is((select state from public.claim_review_pairings), 'rejected', 'rejected pairing is durable');
select is((select lifecycle_reason from public.issue_clusters where id = '98000000-0000-4000-8000-000000000001'), null::text, 'last reject clears stale needs-review prose');
select lives_ok($sql$
  select public.sync_claim_review_proposals(jsonb_build_array(jsonb_build_object(
    'claim_text', 'Fixed a map crash.', 'cluster_id', '98000000-0000-4000-8000-000000000001',
    'proposal_kind', 'llm_sure', 'proposal_reason', 'Sure after a repeat scan.'
  )), '2026-09-07T12:03:00Z')
$sql$, 'a rejected key accepts a repeat scan without changing state');
select is((select state from public.claim_review_pairings), 'rejected', 'rejection suppresses later sure mapping');

select lives_ok($sql$
  select public.mutate_claim_review_pairing(id, revision, 'undo', null, 'test-operator') from public.claim_review_pairings
$sql$, 'undo rejection restores the current exact pairing');
select is((select state from public.claim_review_pairings), 'pending', 'undo rejection restores pending');
select is((select lifecycle_reason from public.issue_clusters where id = '98000000-0000-4000-8000-000000000001'), 'Needs review: Sure after a repeat scan.', 'undo rejection restores the current pending prose');

select lives_ok($sql$
  select public.mutate_claim_review_pairing(id, revision, 'confirm', null, 'test-operator') from public.claim_review_pairings
$sql$, 'confirm pairs this exact current claim');
select is((select fix_status from public.issue_clusters where id = '98000000-0000-4000-8000-000000000001'), 'fix_claimed', 'confirm writes engine-owned fix claimed');
select is((select fix_claimed_patch_version from public.issue_clusters where id = '98000000-0000-4000-8000-000000000001'), '9.9.9', 'confirm stamps exact patch');

insert into public.official_patch_claimed_fixes (board_no, position, fix_text, category, section)
values ('claim-review-board', 1, 'Fixed an unrelated map message.', 'crash_startup', 'Stability');
select lives_ok($sql$
  select public.sync_claim_review_proposals(jsonb_build_array(jsonb_build_object(
    'claim_text', 'Fixed an unrelated map message.', 'cluster_id', '98000000-0000-4000-8000-000000000001',
    'proposal_kind', 'keyword_proposal', 'proposal_reason', 'A second pairing remains uncertain.'
  )), '2026-09-07T12:03:30Z')
$sql$, 'a pending pairing cannot overwrite a confirmed lifecycle');
select is((select lifecycle_reason from public.issue_clusters where id = '98000000-0000-4000-8000-000000000001'), null::text, 'confirmed pairing keeps needs-review prose clear');

insert into public.official_patch_claimed_fixes (board_no, position, fix_text, category, section)
values ('claim-review-board', 2, 'Fixed a second map crash.', 'crash_startup', 'Stability');
select lives_ok($sql$
  select public.sync_claim_review_proposals(jsonb_build_array(jsonb_build_object(
    'claim_text', 'Fixed a second map crash.', 'cluster_id', '98000000-0000-4000-8000-000000000001',
    'proposal_kind', 'llm_sure', 'proposal_reason', 'Independent exact support.'
  )), '2026-09-07T12:04:00Z')
$sql$, 'a second exact claim can independently support the same cluster');
select is((select count(*) from public.claim_review_pairings where state = 'confirmed'), 2::bigint, 'both exact claims are confirmed independently');
select lives_ok($sql$
  select public.mutate_claim_review_pairing(id, revision, 'undo', null, 'test-operator')
  from public.claim_review_pairings where exact_official_text = 'Fixed a map crash.'
$sql$, 'undo does not remove a later independent support');
select is((select fix_status from public.issue_clusters where id = '98000000-0000-4000-8000-000000000001'), 'fix_claimed', 'later support preserves the claim clock');
select is((select fix_claimed_patch_version from public.issue_clusters where id = '98000000-0000-4000-8000-000000000001'), '9.9.9', 'later support preserves exact patch provenance');
select lives_ok($sql$
  select public.mutate_claim_review_pairing(id, revision, 'undo', null, 'test-operator')
  from public.claim_review_pairings where exact_official_text = 'Fixed a second map crash.'
$sql$, 'transferred clock owner can be undone');
select is((select fix_status from public.issue_clusters where id = '98000000-0000-4000-8000-000000000001'), 'reported', 'last owner undo clears the exact claim clock');
select is((select fix_claimed_patch_version from public.issue_clusters where id = '98000000-0000-4000-8000-000000000001'), null::text, 'last owner undo clears patch provenance');
select is((select lifecycle_reason from public.issue_clusters where id = '98000000-0000-4000-8000-000000000001'), 'Needs review: Independent exact support.', 'last owner undo restores pending prose');

select lives_ok($sql$
  select public.mutate_claim_review_pairing(id, revision, 'reject', 'This pairing remains unrelated.', 'test-operator')
  from public.claim_review_pairings where exact_official_text = 'Fixed an unrelated map message.'
$sql$, 'a rejected pairing can later retire');

update public.official_patch_notes set is_current = false where board_no = 'claim-review-board';
insert into public.official_patch_notes (board_no, title, patch_version, official_url, observed_at, is_current)
values ('claim-review-board-next', 'Next patch', '9.9.10', 'https://official.example/next', '2026-09-08T12:00:00Z', true);
select lives_ok($sql$select public.sync_claim_review_proposals('[]'::jsonb, '2026-09-08T12:01:00Z')$sql$, 'new patch sync retires old pairing');
select ok((select bool_and(state = 'retired') from public.claim_review_pairings), 'new patch retires old pairings without deletion');
select is((select count(*) from public.claim_review_audit_events where action = 'retired'), 3::bigint, 'retirement is retained in audit history');
select is(
  (select prior_state from public.claim_review_audit_events where action = 'retired' and exact_official_text = 'Fixed an unrelated map message.'),
  'rejected', 'retirement audit retains the real prior state'
);
update public.claim_review_pairings
set state = 'pending', retired_at = null, retired_reason = null, retired_rejection_reason = null
where exact_official_text = 'Fixed a map crash.';
select is((public.owner_attention_brief() #>> '{adminAttention,unsureClaimMatches}')::integer, 0, 'brief excludes a stored pending pairing from an old patch');

update public.official_patch_notes set is_current = false where board_no = 'claim-review-board-next';
update public.official_patch_notes set is_current = true where board_no = 'claim-review-board';
select lives_ok($sql$
  select public.sync_claim_review_proposals(jsonb_build_array(jsonb_build_object(
    'claim_text', 'Fixed an unrelated map message.', 'cluster_id', '98000000-0000-4000-8000-000000000001',
    'proposal_kind', 'llm_sure', 'proposal_reason', 'A later sure match must remain suppressed.'
  )), '2026-09-08T12:02:00Z')
$sql$, 'a retired exact pairing can reappear');
select is(
  (select state from public.claim_review_pairings where exact_official_text = 'Fixed an unrelated map message.'),
  'rejected', 'retired rejection remains suppressed when its exact pairing reappears'
);
create temporary table moved_notice_snapshot as
select id from public.claim_review_pairings where exact_official_text = 'Fixed an unrelated map message.';
update public.official_patch_notes set is_current = false where board_no = 'claim-review-board';
insert into public.official_patch_notes (board_no, title, patch_version, official_url, observed_at, is_current)
values ('claim-review-board-moved', 'Moved official notice', '9.9.9', 'https://official.example/moved', '2026-09-08T12:03:00Z', true);
insert into public.official_patch_claimed_fixes (board_no, position, fix_text, category, section)
values ('claim-review-board-moved', 0, 'Fixed an unrelated map message.', 'crash_startup', 'Stability');
select lives_ok($sql$
  select public.sync_claim_review_proposals(jsonb_build_array(jsonb_build_object(
    'claim_text', 'Fixed an unrelated map message.', 'cluster_id', '98000000-0000-4000-8000-000000000001',
    'proposal_kind', 'llm_sure', 'proposal_reason', 'Same patch and exact text moved notices.'
  )), '2026-09-08T12:03:30Z')
$sql$, 'same-patch notice move synchronizes existing pairing context');
select is(
  (select id from public.claim_review_pairings where exact_official_text = 'Fixed an unrelated map message.'),
  (select id from moved_notice_snapshot), 'same patch and exact text retain the pairing id'
);
select is(
  (select state from public.claim_review_pairings where exact_official_text = 'Fixed an unrelated map message.'),
  'rejected', 'same-patch notice move retains a durable rejection'
);
select is(
  (select board_no from public.claim_review_pairings where exact_official_text = 'Fixed an unrelated map message.'),
  'claim-review-board-moved', 'same-patch notice move updates the current board context'
);

insert into public.official_patch_claimed_fixes (board_no, position, fix_text, category, section)
values ('claim-review-board-moved', 1, 'Fixed a transport crash.', 'crash_startup', 'Stability');
select lives_ok($sql$
  select public.sync_claim_review_proposals(jsonb_build_array(jsonb_build_object(
    'claim_text', 'Fixed a transport crash.', 'cluster_id', '98000000-0000-4000-8000-000000000001',
    'proposal_kind', 'llm_sure', 'proposal_reason', 'Confident transport mapping.'
  )), '2026-09-08T12:04:00Z')
$sql$, 'new exact transport claim is confirmed');
select is(
  (select state from public.claim_review_pairings where exact_official_text = 'Fixed a transport crash.'),
  'confirmed', 'transport claim stores its confirmed decision'
);
update public.issue_clusters set is_public = false where id = '98000000-0000-4000-8000-000000000001';
select lives_ok($sql$select public.sync_claim_review_proposals('[]'::jsonb, '2026-09-08T12:04:30Z')$sql$, 'private cluster retires current pairings');
select is(
  (select state from public.claim_review_pairings where exact_official_text = 'Fixed a transport crash.'),
  'retired', 'private cluster retires a confirmed pairing'
);
update public.issue_clusters set is_public = true where id = '98000000-0000-4000-8000-000000000001';
select lives_ok($sql$
  select public.sync_claim_review_proposals(jsonb_build_array(jsonb_build_object(
    'claim_text', 'Fixed a transport crash.', 'cluster_id', '98000000-0000-4000-8000-000000000001',
    'proposal_kind', 'keyword_proposal', 'proposal_reason', 'Keyword retry must not erase confirmation.'
  )), '2026-09-08T12:05:00Z')
$sql$, 'retired exact confirmed pairing can reappear');
select is(
  (select state from public.claim_review_pairings where exact_official_text = 'Fixed a transport crash.'),
  'confirmed', 'reappearing exact confirmed pairing remains confirmed'
);
select ok(
  (select confirmed_at is not null from public.claim_review_pairings where exact_official_text = 'Fixed a transport crash.'),
  'reappearing exact confirmed pairing retains its confirmation clock'
);
update public.issue_clusters set is_public = false where id = '98000000-0000-4000-8000-000000000001';
select throws_ok(
  $sql$select public.mutate_claim_review_pairing(id, revision, 'undo', null, 'test-operator')
    from public.claim_review_pairings where exact_official_text = 'Fixed a transport crash.'$sql$,
  'P0001', 'stale_claim_review_cluster', 'private clusters reject stale review actions'
);

reset role;
select * from finish();
rollback;
