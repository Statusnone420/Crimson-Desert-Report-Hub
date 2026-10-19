begin;
select plan(17);

select ok(not has_function_privilege('anon', 'public.editorial_promote_test(uuid, text)', 'EXECUTE'), 'browsers cannot publish a test draft');
select ok(not has_function_privilege('authenticated', 'public.editorial_promote_test(uuid, text)', 'EXECUTE'), 'signed-in browsers cannot publish a test draft');
select ok(has_function_privilege('service_role', 'public.editorial_promote_test(uuid, text)', 'EXECUTE'), 'server code can publish a test draft');

set local role service_role;

-- This week's skipped slot; a passed test draft with a thumbs up; one with only a thumbs
-- down; a test draft that failed its check; and a second approved draft for later.
insert into public.editorials (id, slot_key, status, skip_reason) values
  ('f0000000-0000-4000-8000-000000000001', '2026-W43:mon', 'skipped', 'check_failed');
insert into public.editorials (id, slot_key, is_test, status, slug, title, body_md) values
  ('f0000000-0000-4000-8000-000000000002', 'test:2026-10-19', true, 'held', 'approved-draft', 'Approved draft', 'Body.'),
  ('f0000000-0000-4000-8000-000000000003', 'test:2026-10-19', true, 'held', 'unrated-draft', 'Unrated draft', 'Body.'),
  ('f0000000-0000-4000-8000-000000000005', 'test:2026-10-19', true, 'held', 'second-draft', 'Second draft', 'Body.');
insert into public.editorials (id, slot_key, is_test, status, skip_reason) values
  ('f0000000-0000-4000-8000-000000000004', 'test:2026-10-19', true, 'skipped', 'check_failed');
insert into public.style_notes (editorial_id, rating, note) values
  ('f0000000-0000-4000-8000-000000000002', 'up', 'Approved shape.'),
  ('f0000000-0000-4000-8000-000000000003', 'down', 'Not this one.'),
  ('f0000000-0000-4000-8000-000000000004', 'up', null),
  ('f0000000-0000-4000-8000-000000000005', 'up', null);

select is(public.editorial_promote_test('f0000000-0000-4000-8000-000000000002', 'next monday'), 'bad_slot', 'a malformed slot key is refused');
select is(public.editorial_promote_test('f0000000-0000-4000-8000-000000000001', '2026-W43:mon'), 'not_promotable', 'a real edition is not a test draft');
select is(public.editorial_promote_test('f0000000-0000-4000-8000-000000000004', '2026-W43:mon'), 'not_promotable', 'a test draft that failed its check cannot be published');
select is(public.editorial_promote_test('f0000000-0000-4000-8000-000000000003', '2026-W43:mon'), 'not_approved', 'a test draft without a thumbs up cannot be published');
select is(
  (select concat_ws(',', (select count(*) from public.editorials where is_test)::text,
    (select slot_key from public.editorials where id = 'f0000000-0000-4000-8000-000000000001'))),
  '4,2026-W43:mon', 'refusals change nothing'
);

select is(public.editorial_promote_test('f0000000-0000-4000-8000-000000000002', '2026-W43:mon'), 'promoted', 'an approved test draft replaces the week''s skip');
select is(
  (select concat_ws(',', is_test::text, slot_key, status, slug, (publish_at is not null)::text, (published_at is not null)::text)
    from public.editorials where id = 'f0000000-0000-4000-8000-000000000002'),
  'false,2026-W43:mon,published,approved-draft,true,true', 'the test row is now the slot''s published edition'
);
select is(
  (select concat_ws(',', slot_key, status, skip_reason) from public.editorials where id = 'f0000000-0000-4000-8000-000000000001'),
  '2026-W43:mon:replaced,skipped,check_failed', 'the skip it replaced stays on record under a key no schedule computes'
);
select is((select count(*)::integer from public.style_notes where editorial_id = 'f0000000-0000-4000-8000-000000000002'), 1, 'the thumbs up stays with the edition');
select is((select (value->>'approveFirstRemaining')::integer from public.automation_settings where key = 'column'), 2, 'publishing counts as one approve-first approval');

select is(public.editorial_promote_test('f0000000-0000-4000-8000-000000000005', '2026-W43:mon'), 'slot_taken', 'a slot with an edition is never replaced');
select is(public.editorial_promote_test('f0000000-0000-4000-8000-000000000002', '2026-W43:mon'), 'not_promotable', 'a published edition cannot be published again');
-- A slot with no row at all takes an approved draft as its first edition.
select is(public.editorial_promote_test('f0000000-0000-4000-8000-000000000005', '2026-W44:mon'), 'promoted', 'an empty slot takes an approved draft');
select is((select (value->>'approveFirstRemaining')::integer from public.automation_settings where key = 'column'), 1, 'each publication counts once');

select * from finish();
rollback;
