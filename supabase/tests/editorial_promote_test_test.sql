begin;
select plan(23);

select ok(not has_function_privilege('anon', 'public.editorial_promote_test(uuid, text)', 'EXECUTE'), 'browsers cannot publish a test draft');
select ok(not has_function_privilege('authenticated', 'public.editorial_promote_test(uuid, text)', 'EXECUTE'), 'signed-in browsers cannot publish a test draft');
select ok(has_function_privilege('service_role', 'public.editorial_promote_test(uuid, text)', 'EXECUTE'), 'server code can publish a test draft');

set local role service_role;

-- This week's skipped slot; a passed test draft whose newest thumbs is up; one with only
-- a thumbs down; one whose thumbs up was withdrawn by a later thumbs down; one with a note
-- but no thumbs; a test draft that failed its check; and two more approved drafts for later.
insert into public.editorials (id, slot_key, status, skip_reason) values
  ('f0000000-0000-4000-8000-000000000001', '2026-W43:mon', 'skipped', 'check_failed');
-- Two scheduled runs' claims: one taken 29 minutes ago that may still be writing, and one
-- taken 31 minutes ago by a run that died.
insert into public.editorials (id, slot_key, status, skip_reason, updated_at) values
  ('f0000000-0000-4000-8000-000000000008', '2026-W45:mon', 'skipped', 'writer_failed', now() - interval '29 minutes'),
  ('f0000000-0000-4000-8000-000000000009', '2026-W46:mon', 'skipped', 'writer_failed', now() - interval '31 minutes');
insert into public.editorials (id, slot_key, is_test, status, slug, title, body_md) values
  ('f0000000-0000-4000-8000-000000000002', 'test:2026-10-19', true, 'held', 'approved-draft', 'Approved draft', 'Body.'),
  ('f0000000-0000-4000-8000-000000000003', 'test:2026-10-19', true, 'held', 'unrated-draft', 'Unrated draft', 'Body.'),
  ('f0000000-0000-4000-8000-000000000005', 'test:2026-10-19', true, 'held', 'second-draft', 'Second draft', 'Body.'),
  ('f0000000-0000-4000-8000-000000000006', 'test:2026-10-19', true, 'held', 'withdrawn-draft', 'Withdrawn draft', 'Body.'),
  ('f0000000-0000-4000-8000-000000000007', 'test:2026-10-19', true, 'held', 'noted-draft', 'Noted draft', 'Body.'),
  ('f0000000-0000-4000-8000-000000000010', 'test:2026-10-19', true, 'held', 'third-draft', 'Third draft', 'Body.');
insert into public.editorials (id, slot_key, is_test, status, skip_reason) values
  ('f0000000-0000-4000-8000-000000000004', 'test:2026-10-19', true, 'skipped', 'check_failed');
-- Every insert in this transaction shares one now(), so ratings that must be ordered get their own times.
insert into public.style_notes (editorial_id, rating, note, created_at) values
  ('f0000000-0000-4000-8000-000000000002', 'down', 'Too long.', '2026-10-19 10:00+00'),
  ('f0000000-0000-4000-8000-000000000002', 'up', 'Approved shape.', '2026-10-19 11:00+00'),
  ('f0000000-0000-4000-8000-000000000002', null, 'Keep this voice.', '2026-10-19 12:00+00'),
  ('f0000000-0000-4000-8000-000000000003', 'down', 'Not this one.', '2026-10-19 10:00+00'),
  ('f0000000-0000-4000-8000-000000000006', 'up', 'Good.', '2026-10-19 10:00+00'),
  ('f0000000-0000-4000-8000-000000000006', 'down', 'On second thought, no.', '2026-10-19 11:00+00'),
  ('f0000000-0000-4000-8000-000000000007', null, 'Reading it now.', '2026-10-19 10:00+00'),
  ('f0000000-0000-4000-8000-000000000004', 'up', null, '2026-10-19 10:00+00'),
  ('f0000000-0000-4000-8000-000000000005', 'up', null, '2026-10-19 10:00+00'),
  ('f0000000-0000-4000-8000-000000000010', 'up', null, '2026-10-19 10:00+00');

select is(public.editorial_promote_test('f0000000-0000-4000-8000-000000000002', 'next monday'), 'bad_slot', 'a malformed slot key is refused');
select is(public.editorial_promote_test('f0000000-0000-4000-8000-000000000001', '2026-W43:mon'), 'not_promotable', 'a real edition is not a test draft');
select is(public.editorial_promote_test('f0000000-0000-4000-8000-000000000004', '2026-W43:mon'), 'not_promotable', 'a test draft that failed its check cannot be published');
select is(public.editorial_promote_test('f0000000-0000-4000-8000-000000000003', '2026-W43:mon'), 'not_approved', 'a test draft without a thumbs up cannot be published');
select is(public.editorial_promote_test('f0000000-0000-4000-8000-000000000006', '2026-W43:mon'), 'not_approved', 'a later thumbs down withdraws the approval');
select is(public.editorial_promote_test('f0000000-0000-4000-8000-000000000007', '2026-W43:mon'), 'not_approved', 'a note without a thumbs is not an approval');
select is(
  (select concat_ws(',', (select count(*) from public.editorials where is_test)::text,
    (select slot_key from public.editorials where id = 'f0000000-0000-4000-8000-000000000001'))),
  '7,2026-W43:mon', 'refusals change nothing'
);

select is(public.editorial_promote_test('f0000000-0000-4000-8000-000000000002', '2026-W43:mon'), 'promoted', 'a test draft whose newest thumbs is up replaces the week''s skip');
select is(
  (select concat_ws(',', is_test::text, slot_key, status, slug, (publish_at is not null)::text, (published_at is not null)::text)
    from public.editorials where id = 'f0000000-0000-4000-8000-000000000002'),
  'false,2026-W43:mon,published,approved-draft,true,true', 'the test row is now the slot''s published edition'
);
select is(
  (select concat_ws(',', slot_key, status, skip_reason) from public.editorials where id = 'f0000000-0000-4000-8000-000000000001'),
  '2026-W43:mon:replaced,skipped,check_failed', 'the skip it replaced stays on record under a key no schedule computes'
);
select is((select count(*)::integer from public.style_notes where editorial_id = 'f0000000-0000-4000-8000-000000000002'), 3, 'the notes stay with the edition');
select is((select (value->>'approveFirstRemaining')::integer from public.automation_settings where key = 'column'), 2, 'publishing counts as one approve-first approval');

select is(public.editorial_promote_test('f0000000-0000-4000-8000-000000000005', '2026-W43:mon'), 'slot_taken', 'a slot with an edition is never replaced');
select is(public.editorial_promote_test('f0000000-0000-4000-8000-000000000002', '2026-W43:mon'), 'not_promotable', 'a published edition cannot be published again');
-- A slot with no row at all takes an approved draft as its first edition.
select is(public.editorial_promote_test('f0000000-0000-4000-8000-000000000005', '2026-W44:mon'), 'promoted', 'an empty slot takes an approved draft');
select is((select (value->>'approveFirstRemaining')::integer from public.automation_settings where key = 'column'), 1, 'each publication counts once');

-- A run that claimed its slot saves into that row by id; replacing a live claim would let
-- it save a second edition under the renamed key.
select is(public.editorial_promote_test('f0000000-0000-4000-8000-000000000010', '2026-W45:mon'), 'slot_busy', 'a run''s claim from the last 30 minutes is never replaced');
select is(
  (select concat_ws(',', (select slot_key from public.editorials where id = 'f0000000-0000-4000-8000-000000000008'),
    (select skip_reason from public.editorials where id = 'f0000000-0000-4000-8000-000000000008'),
    (select is_test::text from public.editorials where id = 'f0000000-0000-4000-8000-000000000010'))),
  '2026-W45:mon,writer_failed,true', 'a busy slot changes nothing'
);
select is(public.editorial_promote_test('f0000000-0000-4000-8000-000000000010', '2026-W46:mon'), 'promoted', 'an older claim is a run that died, so the draft replaces it');
select is(
  (select concat_ws(',', slot_key, status, skip_reason) from public.editorials where id = 'f0000000-0000-4000-8000-000000000009'),
  '2026-W46:mon:replaced,skipped,writer_failed', 'the dead claim stays on record'
);

select * from finish();
rollback;
