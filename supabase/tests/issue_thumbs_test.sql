begin;
select plan(43);

insert into public.issue_clusters (id, slug, title, category, description, fix_status, confidence, is_public)
values
  ('f2000000-0000-4000-8000-000000000001', 'thumb-public', 'Public thumb issue', 'crash_startup', 'Public fixture.', 'reported', 'medium', true),
  ('f2000000-0000-4000-8000-000000000002', 'thumb-private', 'Private thumb issue', 'crash_startup', 'Private fixture.', 'reported', 'medium', false),
  ('f2000000-0000-4000-8000-000000000003', 'thumb-other', 'Other thumb issue', 'performance', 'Other fixture.', 'reported', 'medium', true);

-- Distinct labels give distinct SHA-256 token fingerprints.
create function pg_temp.token(label text) returns text
language sql
as $$ select encode(sha256(convert_to(label, 'UTF8')), 'hex') $$;

select has_function('public', 'record_issue_thumb', array['uuid', 'text', 'text', 'text', 'text'], 'the thumb writer takes a token fingerprint');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.issue_thumbs'::regclass), 'thumbs have row level security');

set local role service_role;

select is(public.record_issue_thumb('f2000000-0000-4000-8000-000000000001', '2.03.02', 'up', 'no-patch-network', pg_temp.token('no-patch')), 'current_patch_unavailable', 'no current official patch refuses a thumb');
select ok(
  not exists (select 1 from public.issue_thumbs where voter_ip_hash = 'no-patch-network')
  and not exists (select 1 from public.issue_confirmation_attempts where voter_ip_hash = 'no-patch-network'),
  'a refused thumb writes no thumb or ledger entry'
);

insert into public.official_patch_notes (board_no, title, patch_version, official_url, published_at, is_current)
values ('thumb-board', 'Patch 2.03.02', '2.03.02', 'https://official.example/2.03.02', now(), true);

select is(public.record_issue_thumb('f2000000-0000-4000-8000-000000000001', '2.03.02', 'up', 'switch-network', pg_temp.token('switch-1')), 'recorded', 'a thumb up is recorded');
select is((select direction from public.issue_thumbs where cluster_id = 'f2000000-0000-4000-8000-000000000001' and voter_ip_hash = 'switch-network'), 'up', 'the thumb is stored as up');
select is(public.record_issue_thumb('f2000000-0000-4000-8000-000000000001', '2.03.02', 'down', 'switch-network', pg_temp.token('switch-2')), 'recorded', 'the same network can switch to down');
select is((select count(*) from public.issue_thumbs where cluster_id = 'f2000000-0000-4000-8000-000000000001' and voter_ip_hash = 'switch-network'), 1::bigint, 'switching keeps one thumb per network, issue and patch');
select is((select direction from public.issue_thumbs where cluster_id = 'f2000000-0000-4000-8000-000000000001' and voter_ip_hash = 'switch-network'), 'down', 'the switch replaces the direction');
select is(public.record_issue_thumb('f2000000-0000-4000-8000-000000000001', '2.03.02', 'none', 'switch-network', pg_temp.token('switch-3')), 'recorded', 'undo is recorded');
select ok(not exists (select 1 from public.issue_thumbs where voter_ip_hash = 'switch-network'), 'undo removes the network''s thumb');
select is(public.record_issue_thumb('f2000000-0000-4000-8000-000000000001', '2.03.02', 'none', 'never-tapped-network', pg_temp.token('undo-nothing')), 'recorded', 'undo without a thumb changes nothing');

select is(public.record_issue_thumb('f2000000-0000-4000-8000-000000000001', '2.03.02', 'up', 'network-a', pg_temp.token('a-1')), 'recorded', 'a second network can tap');
select is(public.record_issue_thumb('f2000000-0000-4000-8000-000000000001', '2.03.02', 'up', 'network-b', pg_temp.token('b-1')), 'recorded', 'a third network can tap');
select is(public.record_issue_thumb('f2000000-0000-4000-8000-000000000003', '2.03.02', 'down', 'network-a', pg_temp.token('a-2')), 'recorded', 'one network can tap another issue');
select is((select count(*) from public.issue_thumbs where cluster_id = 'f2000000-0000-4000-8000-000000000001' and direction = 'up'), 2::bigint, 'each network counts once per issue');
select is((select count(*) from public.issue_thumbs where voter_ip_hash = 'network-a'), 2::bigint, 'a network keeps one thumb on each issue');

select is(public.record_issue_thumb('f2000000-0000-4000-8000-000000000001', '2.03.01', 'up', 'stale-network', pg_temp.token('stale')), 'stale_patch', 'a thumb for an earlier patch is refused');
select is(public.record_issue_thumb('f2000000-0000-4000-8000-000000000002', '2.03.02', 'up', 'private-network', pg_temp.token('private')), 'unknown_issue', 'a private issue takes no thumb');
select is(public.record_issue_thumb('f2000000-0000-4000-8000-00000000000f', '2.03.02', 'up', 'missing-network', pg_temp.token('missing')), 'unknown_issue', 'a missing issue takes no thumb');
select ok(
  not exists (select 1 from public.issue_thumbs where voter_ip_hash in ('stale-network', 'private-network', 'missing-network'))
  and not exists (select 1 from public.issue_confirmation_attempts where voter_ip_hash in ('stale-network', 'private-network', 'missing-network')),
  'refused thumbs write no thumb or ledger entry'
);

select throws_ok($$select public.record_issue_thumb('f2000000-0000-4000-8000-000000000001', '2.03.02', 'sideways', 'bad-network', encode(sha256('bad'::bytea), 'hex'))$$, '22023', 'invalid thumb direction', 'an unknown direction is rejected');
select throws_ok($$select public.record_issue_thumb('f2000000-0000-4000-8000-000000000001', '2.03.02', 'up', 'bad-network', 'raw-turnstile-token')$$, '22023', 'invalid token hash', 'a raw Turnstile token is not a token hash');
select throws_ok($$select public.record_issue_thumb('f2000000-0000-4000-8000-000000000001', '2.03.02', 'up', 'bad-network', null)$$, '22023', 'invalid token hash', 'a thumb always needs a token hash');

-- Thumbs and check-ins share one token store: each verified token saves one answer.
select is(public.record_issue_thumb('f2000000-0000-4000-8000-000000000003', '2.03.02', 'up', 'token-network', pg_temp.token('shared')), 'recorded', 'a fresh token saves a thumb');
select is(public.record_issue_thumb('f2000000-0000-4000-8000-000000000003', '2.03.02', 'down', 'token-other-network', pg_temp.token('shared')), 'replayed', 'a used token cannot save another thumb');
select is(public.record_issue_checkin('f2000000-0000-4000-8000-000000000003', '2.03.02', 'ps5', 'have_it', 'token-checkin-network', pg_temp.token('shared')), 'replayed', 'a thumb''s token cannot save a check-in');
select is(public.record_issue_checkin('f2000000-0000-4000-8000-000000000003', '2.03.02', 'ps5', 'have_it', 'checkin-first-network', pg_temp.token('checkin-first')), 'recorded', 'a check-in saves with its own token');
select is(public.record_issue_thumb('f2000000-0000-4000-8000-000000000003', '2.03.02', 'up', 'checkin-first-network', pg_temp.token('checkin-first')), 'replayed', 'a check-in''s token cannot save a thumb');
select ok(
  not exists (select 1 from public.issue_thumbs where voter_ip_hash in ('token-other-network', 'checkin-first-network'))
  and (select direction from public.issue_thumbs where voter_ip_hash = 'token-network') = 'up',
  'a replay leaves every saved thumb as it was'
);
select is((select visibility_revision from public.issue_clusters where id = 'f2000000-0000-4000-8000-000000000001'), 0::bigint, 'thumbs never advance the visibility revision');

-- One hourly allowance per network, shared with check-ins.
select lives_ok($sql$
  do $body$
  begin
    for i in 1..10 loop
      perform public.record_issue_checkin('f2000000-0000-4000-8000-000000000001', '2.03.02', 'ps5', 'have_it', 'rate-network', pg_temp.token('rate-checkin-' || i));
      perform public.record_issue_thumb('f2000000-0000-4000-8000-000000000001', '2.03.02', 'up', 'rate-network', pg_temp.token('rate-thumb-' || i));
    end loop;
  end
  $body$
$sql$, 'twenty shared-ledger attempts are accepted');
select is(public.record_issue_thumb('f2000000-0000-4000-8000-000000000001', '2.03.02', 'down', 'rate-network', pg_temp.token('rate-21')), 'rate_limited', 'the twenty-first attempt of either kind is refused');
select is((select direction from public.issue_thumbs where cluster_id = 'f2000000-0000-4000-8000-000000000001' and voter_ip_hash = 'rate-network'), 'up', 'a rate-limited thumb changes nothing');
select is(public.record_issue_thumb('f2000000-0000-4000-8000-000000000001', '2.03.02', 'down', 'rate-free-network', pg_temp.token('rate-21')), 'recorded', 'a rate-limited attempt leaves its token unused');

-- The migration's copy, run again on rows it can see: general check-ins become
-- thumbs, claim answers stay out, and an existing thumb is never overwritten.
insert into public.issue_checkins (cluster_id, patch_version, platform, kind, voter_ip_hash)
values
  ('f2000000-0000-4000-8000-000000000003', '2.03.01', 'ps5', 'have_it', 'legacy-up-network'),
  ('f2000000-0000-4000-8000-000000000003', '2.03.01', 'pc_steam', 'not_happening', 'legacy-down-network'),
  ('f2000000-0000-4000-8000-000000000003', '2.03.01', 'ps5', 'still_happening', 'legacy-claim-network');
insert into public.issue_thumbs (cluster_id, patch_version, direction, voter_ip_hash)
values ('f2000000-0000-4000-8000-000000000003', '2.03.01', 'down', 'legacy-up-network');
update public.issue_checkins set voter_ip_hash = 'legacy-kept-network'
where voter_ip_hash = 'legacy-up-network';
insert into public.issue_checkins (cluster_id, patch_version, platform, kind, voter_ip_hash)
values ('f2000000-0000-4000-8000-000000000003', '2.03.01', 'ps5', 'have_it', 'legacy-up-network')
on conflict (cluster_id, patch_version, voter_ip_hash) do nothing;

insert into public.issue_thumbs (created_at, cluster_id, patch_version, direction, voter_ip_hash)
select created_at, cluster_id, patch_version, case kind when 'have_it' then 'up' else 'down' end, voter_ip_hash
from public.issue_checkins
where kind in ('have_it', 'not_happening')
on conflict (cluster_id, patch_version, voter_ip_hash) do nothing;

select is((select direction from public.issue_thumbs where patch_version = '2.03.01' and voter_ip_hash = 'legacy-kept-network'), 'up', '"Happening to me" becomes a thumb up');
select is((select direction from public.issue_thumbs where patch_version = '2.03.01' and voter_ip_hash = 'legacy-down-network'), 'down', '"Not happening for me" becomes a thumb down');
select ok(not exists (select 1 from public.issue_thumbs where voter_ip_hash = 'legacy-claim-network'), 'claim answers are not copied');
select is((select direction from public.issue_thumbs where patch_version = '2.03.01' and voter_ip_hash = 'legacy-up-network'), 'down', 'an existing thumb is not overwritten');
select is((select count(*) from public.issue_checkins where patch_version = '2.03.01' and cluster_id = 'f2000000-0000-4000-8000-000000000003'), 4::bigint, 'every check-in row stays in place');

set local role anon;
select throws_ok($$select * from public.issue_thumbs$$, '42501', null, 'anon cannot read thumbs');
select throws_ok($$select public.record_issue_thumb('f2000000-0000-4000-8000-000000000001', '2.03.02', 'up', 'anon-network', encode(sha256('anon'::bytea), 'hex'))$$, '42501', null, 'anon cannot call the thumb writer');
set local role authenticated;
select throws_ok($$select * from public.issue_thumbs$$, '42501', null, 'signed-in browsers cannot read thumbs');

reset role;
select * from finish();
rollback;
