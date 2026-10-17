begin;
select plan(55);

insert into public.issue_clusters (id, slug, title, category, description, fix_status, confidence, is_public)
values
  ('f1000000-0000-4000-8000-000000000001', 'checkin-public', 'Public check-in issue', 'crash_startup', 'Public fixture.', 'reported', 'medium', true),
  ('f1000000-0000-4000-8000-000000000002', 'checkin-private', 'Private check-in issue', 'crash_startup', 'Private fixture.', 'reported', 'medium', false),
  ('f1000000-0000-4000-8000-000000000003', 'checkin-revision', 'Revision check-in issue', 'crash_startup', 'Revision fixture.', 'reported', 'medium', true);

-- Distinct labels give distinct SHA-256 token fingerprints.
create function pg_temp.token(label text) returns text
language sql
as $$ select encode(sha256(convert_to(label, 'UTF8')), 'hex') $$;

select has_function('public', 'record_issue_checkin', array['uuid', 'text', 'text', 'text', 'text', 'text'], 'the check-in writer takes a token fingerprint');
select is((select count(*) from pg_catalog.pg_proc where proname = 'record_issue_checkin' and pronamespace = 'public'::regnamespace), 1::bigint, 'one check-in writer remains');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.issue_checkin_tokens'::regclass), 'token fingerprints have row level security');
select ok(not has_table_privilege('service_role', 'public.issue_checkin_tokens', 'UPDATE'), 'service code cannot rewrite a token fingerprint');
select ok(not has_table_privilege('service_role', 'public.issue_checkin_tokens', 'DELETE'), 'service code cannot delete a token fingerprint');

set local role service_role;

select is(public.record_issue_checkin('f1000000-0000-4000-8000-000000000001', '1.13.01', 'ps5', 'have_it', 'missing-patch-network', pg_temp.token('missing-patch')), 'current_patch_unavailable', 'no current official patch refuses a general check-in');
select ok(
  not exists (select 1 from public.issue_checkins where voter_ip_hash = 'missing-patch-network')
  and not exists (select 1 from public.issue_confirmation_attempts where voter_ip_hash = 'missing-patch-network'),
  'missing current patch creates no check-in or ledger entry'
);

insert into public.official_patch_notes (board_no, title, patch_version, official_url, published_at, is_current)
values ('checkin-initial-board', 'Patch 1.13.01', '1.13.01', 'https://official.example/1.13.01', now(), true);

select is(public.record_issue_checkin('f1000000-0000-4000-8000-000000000001', '1.13.01', 'ps5', 'have_it', 'replace-network', pg_temp.token('replace-1')), 'recorded', 'first stance is recorded');
select is(public.record_issue_checkin('f1000000-0000-4000-8000-000000000001', '1.13.01', 'pc_steam', 'not_happening', 'replace-network', pg_temp.token('replace-2')), 'recorded', 'same network can replace its stance');
select is((select count(*) from public.issue_checkins where cluster_id = 'f1000000-0000-4000-8000-000000000001' and patch_version = '1.13.01' and voter_ip_hash = 'replace-network'), 1::bigint, 'same-network replacement keeps one exact-patch row');
select ok((select kind = 'not_happening' and platform = 'pc_steam' from public.issue_checkins where cluster_id = 'f1000000-0000-4000-8000-000000000001' and patch_version = '1.13.01' and voter_ip_hash = 'replace-network'), 'replacement updates stance and platform');

select is(public.record_issue_checkin('f1000000-0000-4000-8000-000000000001', '1.13.02', 'ps5', 'have_it', 'stale-have-network', pg_temp.token('stale-have')), 'stale_patch', 'stale general have-it check-in is rejected');
select ok(
  not exists (select 1 from public.issue_checkins where voter_ip_hash = 'stale-have-network')
  and not exists (select 1 from public.issue_confirmation_attempts where voter_ip_hash = 'stale-have-network'),
  'stale general have-it check-in creates no check-in or ledger entry'
);

update public.official_patch_notes set is_current = false where is_current = true;
insert into public.official_patch_notes (board_no, title, patch_version, official_url, published_at, is_current)
values ('checkin-hotfix-board', 'Patch 1.13.02', '1.13.02', 'https://official.example/1.13.02', now(), true);
select is(public.record_issue_checkin('f1000000-0000-4000-8000-000000000001', '1.13.02', 'ps5', 'have_it', 'replace-network', pg_temp.token('replace-3')), 'recorded', 'same network can check in on the newly current hotfix');
select is((select count(*) from public.issue_checkins where cluster_id = 'f1000000-0000-4000-8000-000000000001' and voter_ip_hash = 'replace-network'), 2::bigint, 'hotfix response preserves the earlier exact-patch row');

update public.official_patch_notes set is_current = false where is_current = true;
insert into public.official_patch_notes (board_no, title, patch_version, official_url, published_at, is_current)
values ('checkin-claim-board', 'Patch 1.14.00', '1.14.00', 'https://official.example/1.14.00', now(), true);

select is(public.record_issue_checkin('f1000000-0000-4000-8000-000000000001', '1.14.00', 'ps5', 'have_it', 'kind-have-it', pg_temp.token('kind-have-it')), 'recorded', 'have_it is accepted');
select is(public.record_issue_checkin('f1000000-0000-4000-8000-000000000001', '1.14.00', 'ps5', 'not_happening', 'kind-not-happening', pg_temp.token('kind-not-happening')), 'recorded', 'not_happening is accepted');
select is(public.record_issue_checkin('f1000000-0000-4000-8000-000000000001', '1.13.01', 'ps5', 'not_happening', 'stale-not-network', pg_temp.token('stale-not')), 'stale_patch', 'stale general not-happening check-in is rejected');
select ok(
  not exists (select 1 from public.issue_checkins where voter_ip_hash = 'stale-not-network')
  and not exists (select 1 from public.issue_confirmation_attempts where voter_ip_hash = 'stale-not-network'),
  'stale general not-happening check-in creates no check-in or ledger entry'
);
select is(public.record_issue_checkin('f1000000-0000-4000-8000-000000000001', '1.14.00', 'ps5', 'fixed_for_me', 'claim-sync-network', pg_temp.token('claim-sync')), 'claim_context_unavailable', 'claim-specific choice waits for the first durable claim sync');
select ok(
  not exists (select 1 from public.issue_checkins where voter_ip_hash = 'claim-sync-network')
  and not exists (select 1 from public.issue_confirmation_attempts where voter_ip_hash = 'claim-sync-network'),
  'unavailable claim context creates no check-in or ledger entry'
);

insert into public.claim_review_sync_state (first_synced_at, last_synced_at) values (now(), now());

select is(public.record_issue_checkin('f1000000-0000-4000-8000-000000000001', '1.14.00', 'ps5', 'still_happening', 'claim-preclaim-network', pg_temp.token('claim-preclaim')), 'claim_required', 'claim-specific choice requires a current confirmed claim');
select ok(
  not exists (select 1 from public.issue_checkins where voter_ip_hash = 'claim-preclaim-network')
  and not exists (select 1 from public.issue_confirmation_attempts where voter_ip_hash = 'claim-preclaim-network'),
  'missing claim creates no check-in or ledger entry'
);

update public.issue_clusters
set fix_claimed_at = now(), fix_claimed_patch_version = '1.14.00'
where id = 'f1000000-0000-4000-8000-000000000001';
insert into public.official_patch_claimed_fixes (board_no, position, fix_text, category)
values ('checkin-claim-board', 1, 'Fixed a crash on launch.', 'crash_startup');
insert into public.claim_review_pairings (
  pairing_key, claim_key, board_no, patch_version, official_url, exact_official_text, official_section,
  cluster_id, cluster_slug, cluster_title, cluster_category, cluster_lifecycle_revision,
  proposal_kind, proposal_reason, state, first_seen_at, last_seen_at, confirmed_at
) values (
  public.claim_review_claim_key('1.14.00', 'Fixed a crash on launch.') || chr(10) || 'f1000000-0000-4000-8000-000000000001',
  public.claim_review_claim_key('1.14.00', 'Fixed a crash on launch.'),
  'checkin-claim-board', '1.14.00', 'https://official.example/1.14.00', 'Fixed a crash on launch.', null,
  'f1000000-0000-4000-8000-000000000001', 'checkin-public', 'Public check-in issue', 'crash_startup', 1,
  'keyword_proposal', 'Exact official claim for check-in test.', 'confirmed', now(), now(), now()
);
update public.issue_clusters
set admin_override = true
where id = 'f1000000-0000-4000-8000-000000000001';

select is(public.record_issue_checkin('f1000000-0000-4000-8000-000000000001', '1.14.00', 'ps5', 'fixed_for_me', 'claim-locked-network', pg_temp.token('claim-locked')), 'claim_required', 'maintainer lifecycle lock rejects a claim-specific choice');
select ok(
  not exists (select 1 from public.issue_checkins where voter_ip_hash = 'claim-locked-network')
  and not exists (select 1 from public.issue_confirmation_attempts where voter_ip_hash = 'claim-locked-network'),
  'maintainer lifecycle lock creates no claim-specific check-in or ledger entry'
);
update public.issue_clusters
set admin_override = false
where id = 'f1000000-0000-4000-8000-000000000001';

select is(public.record_issue_checkin('f1000000-0000-4000-8000-000000000001', '1.13.99', 'ps5', 'fixed_for_me', 'claim-old-patch-network', pg_temp.token('claim-old-patch')), 'stale_patch', 'old-patch claim-specific choice is rejected before claim evaluation');
select ok(
  not exists (select 1 from public.issue_checkins where voter_ip_hash = 'claim-old-patch-network')
  and not exists (select 1 from public.issue_confirmation_attempts where voter_ip_hash = 'claim-old-patch-network'),
  'old-patch claim rejection creates no check-in or ledger entry'
);
select is(public.record_issue_checkin('f1000000-0000-4000-8000-000000000001', '1.14.00', 'ps5', 'fixed_for_me', 'kind-fixed', pg_temp.token('kind-fixed')), 'recorded', 'fixed_for_me is accepted after the lifecycle lock is released');
select is(public.record_issue_checkin('f1000000-0000-4000-8000-000000000001', '1.14.00', 'ps5', 'still_happening', 'kind-still', pg_temp.token('kind-still')), 'recorded', 'still_happening is accepted after the lifecycle lock is released');
select is((select count(distinct kind) from public.issue_checkins where cluster_id = 'f1000000-0000-4000-8000-000000000001' and patch_version = '1.14.00'), 4::bigint, 'all four stances persist distinctly');

select is(public.record_issue_checkin('f1000000-0000-4000-8000-000000000002', '1.13.01', 'ps5', 'have_it', 'private-network', pg_temp.token('private')), 'unknown_issue', 'private issue is rejected inside the locked RPC');
select is((select count(*) from public.issue_checkins where cluster_id = 'f1000000-0000-4000-8000-000000000002'), 0::bigint, 'private issue receives no check-in');

-- Siteverify accepted reused tokens in local checks, so the writer refuses
-- them itself. A token is spent only by the check-in it saves.
select throws_ok($$select public.record_issue_checkin('f1000000-0000-4000-8000-000000000001', '1.14.00', 'ps5', 'have_it', 'raw-token-network', 'raw-turnstile-token')$$, '22023', 'invalid token hash', 'a raw Turnstile token is not a valid token hash');
select is(public.record_issue_checkin('f1000000-0000-4000-8000-000000000001', '1.14.00', 'ps5', 'have_it', 'token-first-network', pg_temp.token('shared')), 'recorded', 'a fresh token saves a check-in');
select is(public.record_issue_checkin('f1000000-0000-4000-8000-000000000001', '1.14.00', 'ps5', 'have_it', 'token-replay-network', pg_temp.token('shared')), 'replayed', 'a used token cannot save a check-in from another network');
select ok(
  not exists (select 1 from public.issue_checkins where voter_ip_hash = 'token-replay-network')
  and not exists (select 1 from public.issue_confirmation_attempts where voter_ip_hash = 'token-replay-network'),
  'a replayed token creates no check-in or ledger entry'
);
select is(public.record_issue_checkin('f1000000-0000-4000-8000-000000000001', '1.14.00', 'pc_steam', 'not_happening', 'token-first-network', pg_temp.token('shared')), 'replayed', 'a used token cannot replace its own network''s answer');
select ok((select kind = 'have_it' and platform = 'ps5' from public.issue_checkins where cluster_id = 'f1000000-0000-4000-8000-000000000001' and patch_version = '1.14.00' and voter_ip_hash = 'token-first-network'), 'a replay leaves the saved answer unchanged');
select is(public.record_issue_checkin('f1000000-0000-4000-8000-000000000003', '1.14.00', 'ps5', 'have_it', 'token-other-issue-network', pg_temp.token('shared')), 'replayed', 'a used token cannot save a check-in on another issue');
select is((select visibility_revision from public.issue_clusters where id = 'f1000000-0000-4000-8000-000000000003'), 0::bigint, 'a replay does not advance visibility revision');
select is((select count(*) from public.issue_checkin_tokens where token_hash = pg_temp.token('shared')), 1::bigint, 'a used token keeps one fingerprint');
select is(public.record_issue_checkin('f1000000-0000-4000-8000-000000000001', '1.13.01', 'ps5', 'have_it', 'token-refused-network', pg_temp.token('after-refusal')), 'stale_patch', 'a stale attempt is refused');
select is(public.record_issue_checkin('f1000000-0000-4000-8000-000000000001', '1.14.00', 'ps5', 'have_it', 'token-refused-network', pg_temp.token('after-refusal')), 'recorded', 'a refused attempt leaves its token unused');
select is(public.record_issue_checkin('f1000000-0000-4000-8000-000000000001', '1.14.00', 'ps5', 'have_it', 'previous-deployment-network'), 'recorded', 'the live five-argument call still saves while the migration deploys');

select lives_ok($sql$
  do $body$
  begin
    for i in 1..20 loop
      perform public.record_issue_checkin('f1000000-0000-4000-8000-000000000001', '1.14.00', 'ps5', 'have_it', 'rate-network', pg_temp.token('rate-' || i));
    end loop;
  end
  $body$
$sql$, 'twenty shared-ledger attempts are accepted');
select is(public.record_issue_checkin('f1000000-0000-4000-8000-000000000001', '1.14.00', 'ps5', 'have_it', 'rate-network', pg_temp.token('rate-21')), 'rate_limited', 'the twenty-first shared-ledger attempt is rejected');
select is((select count(*) from public.issue_confirmation_attempts where voter_ip_hash = 'rate-network'), 20::bigint, 'rate-limited write does not add another ledger row');

select is(public.record_issue_checkin('f1000000-0000-4000-8000-000000000003', '1.14.00', 'ps5', 'have_it', 'revision-network', pg_temp.token('revision')), 'recorded', 'revision fixture is recorded');
select is((select visibility_revision from public.issue_clusters where id = 'f1000000-0000-4000-8000-000000000003'), 1::bigint, 'a recorded check-in advances visibility revision');

set local role anon;
select throws_ok($$select * from public.issue_checkins$$, '42501', null, 'anon cannot read raw check-ins');
select throws_ok($$select public.record_issue_checkin('f1000000-0000-4000-8000-000000000001', '1.17.00', 'ps5', 'have_it', 'anon-network', pg_temp.token('anon'))$$, '42501', null, 'anon cannot call the write RPC');
select throws_ok($$select * from public.issue_checkin_tokens$$, '42501', null, 'anon cannot read token fingerprints');
set local role authenticated;
select throws_ok($$select * from public.issue_checkin_tokens$$, '42501', null, 'signed-in browsers cannot read token fingerprints');

set local role service_role;
insert into public.issue_confirmations (cluster_id, patch_family, patch_version, platform, kind, voter_ip_hash)
values ('f1000000-0000-4000-8000-000000000001', 'legacy', '0.99.00', 'ps5', 'have_it', 'legacy-network');
select is(public.record_issue_checkin('f1000000-0000-4000-8000-000000000001', '1.14.00', 'ps5', 'not_happening', 'legacy-network', pg_temp.token('legacy')), 'recorded', 'new check-in does not route through the legacy writer');
select ok((select kind = 'have_it' and patch_version = '0.99.00' from public.issue_confirmations where cluster_id = 'f1000000-0000-4000-8000-000000000001' and voter_ip_hash = 'legacy-network'), 'legacy confirmation row remains untouched');

reset role;
select * from finish();
rollback;
