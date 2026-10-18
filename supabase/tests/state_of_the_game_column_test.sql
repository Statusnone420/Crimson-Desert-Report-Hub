begin;
select plan(67);

-- Server role only.
select ok((select relrowsecurity from pg_class where oid = 'public.editorials'::regclass), 'editorials have RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.style_notes'::regclass), 'style notes have RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.voice_examples'::regclass), 'voice examples have RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.editorial_ai_spend'::regclass), 'the column ledger has RLS enabled');
select ok(not has_table_privilege('anon', 'public.editorials', 'SELECT'), 'browsers cannot read editorials');
select ok(not has_table_privilege('authenticated', 'public.editorials', 'SELECT'), 'signed-in browsers cannot read editorials');
select ok(not has_table_privilege('anon', 'public.editorial_ai_spend', 'SELECT'), 'browsers cannot read the column ledger');
select ok(not has_table_privilege('anon', 'public.style_notes', 'INSERT'), 'browsers cannot write editor notes');
select ok(not has_table_privilege('anon', 'public.voice_examples', 'INSERT'), 'browsers cannot write voice examples');
select ok(not has_table_privilege('service_role', 'public.editorials', 'DELETE'), 'server code cannot delete an edition');
select ok(not has_table_privilege('service_role', 'public.editorial_ai_spend', 'DELETE'), 'server code cannot delete a ledger row');
select ok(not has_function_privilege('anon', 'public.editorial_ai_reserve(uuid, text, text, text, numeric, numeric, numeric, integer)', 'EXECUTE'), 'browsers cannot reserve column spend');
select ok(not has_function_privilege('authenticated', 'public.editorial_approve(uuid)', 'EXECUTE'), 'browsers cannot approve an edition');
select ok(not has_function_privilege('anon', 'public.editorial_settings_merge(jsonb)', 'EXECUTE'), 'browsers cannot change column settings');
select ok(has_function_privilege('service_role', 'public.editorial_ai_settle(uuid, text, numeric, integer, integer, integer, integer)', 'EXECUTE'), 'server code can settle column spend');

-- The seeded settings carry the disabled expansion burst and approve-first count.
select is((select value->>'paused' from public.automation_settings where key = 'column'), 'false', 'the column starts unpaused');
select is((select (value->>'approveFirstRemaining')::integer from public.automation_settings where key = 'column'), 3, 'the first three editions wait for approval');
select is((select value->'bursts'->0->>'enabled' from public.automation_settings where key = 'column'), 'false', 'the expansion burst is seeded disabled');
select is((select value->'bursts'->0->>'startDate' from public.automation_settings where key = 'column'), '2026-10-29', 'the expansion burst starts on the launch date');
select is((select value->>'paused' from public.automation_settings where key = 'scanner'), 'false', 'the scanner settings row is untouched');

set local role service_role;

-- Edition shape.
insert into public.editorials (id, slot_key, status, skip_reason)
values ('e0000000-0000-4000-8000-000000000001', '2026-W43:s0', 'skipped', 'paused');
select throws_ok(
  $$insert into public.editorials (slot_key, status, skip_reason) values ('2026-W43:s0', 'skipped', 'paused')$$,
  '23505', null, 'a slot holds one real edition'
);
select lives_ok(
  $$insert into public.editorials (slot_key, is_test, status, slug, title, body_md) values ('test:2026-10-18', true, 'held', 'test-one', 'Test one', 'Body.'),
    ('test:2026-10-18', true, 'held', 'test-two', 'Test two', 'Body.')$$,
  'test drafts may share a slot key'
);
select throws_ok(
  $$insert into public.editorials (slot_key, status) values ('2026-W43:s1', 'skipped')$$,
  '23514', null, 'a skipped row needs a reason'
);
select throws_ok(
  $$insert into public.editorials (slot_key, status, skip_reason) values ('2026-W43:s2', 'skipped', 'made_up')$$,
  '23514', null, 'an unknown skip reason is refused'
);
select lives_ok(
  $$insert into public.editorials (slot_key, status, skip_reason) values ('2026-W43:s3', 'skipped', 'slop_check_failed')$$,
  'slop_check_failed is a skip reason'
);
select throws_ok(
  $$insert into public.editorials (slot_key, status, skip_reason, slug, title, body_md) values ('2026-W43:s4', 'held', 'paused', 'held-with-reason', 'Title', 'Body.')$$,
  '23514', null, 'only skipped rows carry a skip reason'
);
select throws_ok(
  $$insert into public.editorials (slot_key, status, title, body_md) values ('2026-W43:s5', 'held', 'No slug', 'Body.')$$,
  '23514', null, 'a written edition needs a slug'
);
select throws_ok(
  $$insert into public.editorials (slot_key, status, slug, title, body_md) values ('2026-W43:s6', 'vetoed', 'veto-no-time', 'Title', 'Body.')$$,
  '23514', null, 'a vetoed edition records when'
);
select throws_ok(
  $$insert into public.editorials (slot_key, status, slug, title, body_md, author) values ('2026-W43:s7', 'held', 'other-author', 'Title', 'Body.', 'Someone')$$,
  '23514', null, 'the byline is always The Pywel Desk'
);
select throws_ok(
  $$insert into public.editorials (slot_key, is_test, status, slug, title, body_md, publish_at) values ('test:2026-10-18', true, 'held', 'test-scheduled', 'Title', 'Body.', now())$$,
  '23514', null, 'a test draft is never scheduled to publish'
);
select throws_ok(
  $$insert into public.editorials (slot_key, status, slug, title, body_md) values ('2026-W43:s8', 'held', 'Bad Slug', 'Title', 'Body.')$$,
  '23514', null, 'slugs are lowercase words joined by hyphens'
);
select is((select author from public.editorials where id = 'e0000000-0000-4000-8000-000000000001'), 'The Pywel Desk', 'the byline defaults to The Pywel Desk');

-- Approve-first.
insert into public.editorials (id, slot_key, status, slug, title, body_md, hold_hours)
values ('e0000000-0000-4000-8000-000000000002', '2026-W44:s0', 'held', 'first-edition', 'First edition', 'Body.', 24);
select is(public.editorial_approve('e0000000-0000-4000-8000-000000000002'), 'approved', 'a held edition waiting for approval is approved');
select ok(
  (select status = 'published' and publish_at is not null and published_at is not null from public.editorials where id = 'e0000000-0000-4000-8000-000000000002'),
  'approval publishes it now'
);
select is((select (value->>'approveFirstRemaining')::integer from public.automation_settings where key = 'column'), 2, 'approval counts one approve-first edition down');
select is(public.editorial_approve('e0000000-0000-4000-8000-000000000002'), 'not_pending', 'a second approval changes nothing');
select is((select (value->>'approveFirstRemaining')::integer from public.automation_settings where key = 'column'), 2, 'a repeated approval does not count down again');
insert into public.editorials (id, slot_key, status, slug, title, body_md, vetoed_at)
values ('e0000000-0000-4000-8000-000000000003', '2026-W44:s1', 'vetoed', 'vetoed-edition', 'Vetoed', 'Body.', now());
select is(public.editorial_approve('e0000000-0000-4000-8000-000000000003'), 'not_pending', 'a vetoed edition cannot be approved');
insert into public.editorials (id, slot_key, is_test, status, slug, title, body_md)
values ('e0000000-0000-4000-8000-000000000004', 'test:2026-10-19', true, 'held', 'test-draft', 'Test', 'Body.');
select is(public.editorial_approve('e0000000-0000-4000-8000-000000000004'), 'not_pending', 'a test draft cannot be approved');
insert into public.editorials (id, slot_key, status, slug, title, body_md, publish_at)
values ('e0000000-0000-4000-8000-000000000005', '2026-W44:s2', 'held', 'scheduled-edition', 'Scheduled', 'Body.', now() + interval '24 hours');
select is(public.editorial_approve('e0000000-0000-4000-8000-000000000005'), 'not_pending', 'an edition already on the 24-hour hold is not an approval');
update public.automation_settings set value = jsonb_set(value, '{approveFirstRemaining}', '0') where key = 'column';
insert into public.editorials (id, slot_key, status, slug, title, body_md)
values ('e0000000-0000-4000-8000-000000000006', '2026-W44:s3', 'held', 'late-approval', 'Late', 'Body.');
select is(public.editorial_approve('e0000000-0000-4000-8000-000000000006'), 'approved', 'a pending edition can still be approved after the count reaches zero');
select is((select (value->>'approveFirstRemaining')::integer from public.automation_settings where key = 'column'), 0, 'the approve-first count never goes below zero');

-- Settings writers merge their own keys.
select is(public.editorial_settings_merge('{"paused": true}'::jsonb)->>'paused', 'true', 'a settings patch is saved');
select is((select value->'bursts'->0->>'id' from public.automation_settings where key = 'column'), 'expansion-launch', 'a settings patch keeps the other keys');
select throws_ok($$select public.editorial_settings_merge('[1]'::jsonb)$$, '22023', null, 'a settings patch is an object');
select is(public.editorial_settings_merge('{"nextEditionModel": "claude-sonnet-5-5"}'::jsonb)->>'nextEditionModel', 'claude-sonnet-5-5', 'a one-shot override is saved');
select is(public.editorial_settings_clear_next_model('claude-fable-5-1'), false, 'a changed override is left alone');
select is(public.editorial_settings_clear_next_model('claude-sonnet-5-5'), true, 'the used override is cleared');
select is((select value->'nextEditionModel' from public.automation_settings where key = 'column'), 'null'::jsonb, 'the override is null after use');

-- Editor notes and voice examples.
select throws_ok($$insert into public.style_notes (note) values (repeat('x', 501))$$, '23514', null, 'a note holds at most 500 characters');
select throws_ok($$insert into public.style_notes (note) values ('   ')$$, '23514', null, 'an empty note without a rating is refused');
select lives_ok($$insert into public.style_notes (editorial_id, rating) values ('e0000000-0000-4000-8000-000000000002', 'up')$$, 'a thumbs-up alone is a note');
select throws_ok($$insert into public.voice_examples (body) values (repeat('x', 1501))$$, '23514', null, 'an example holds at most 1,500 characters');
select throws_ok($$insert into public.voice_examples (body) values ('  ')$$, '23514', null, 'an example has text');
select throws_ok($$insert into public.voice_examples (body, label) values ('Body', repeat('x', 81))$$, '23514', null, 'a label holds at most 80 characters');
insert into public.voice_examples (body, position) values ('One', 0), ('Two', 1), ('Three', 2), ('Four', 3), ('Five', 4);
select throws_ok($$insert into public.voice_examples (body, position) values ('Six', 5)$$, '23514', 'voice_examples_limit', 'at most five voice examples');

-- The column ledger.
select is(
  public.editorial_ai_reserve('a0000000-0000-4000-8000-000000000001', 'writer', 'anthropic', 'claude-opus-5-5', 1.5, 1, 15, 10)->>'reason',
  'request_cap', 'a reservation above the per-request cap is blocked'
);
select is(
  public.editorial_ai_reserve('a0000000-0000-4000-8000-000000000002', 'writer', 'anthropic', 'claude-opus-5-5', 0.5, 1, 15, 10)->>'status',
  'reserved', 'a reservation inside both caps is saved'
);
select is(
  public.editorial_ai_reserve('a0000000-0000-4000-8000-000000000003', 'checker', 'openrouter', 'claude-haiku-5-5', 0.6, 1, 1, 10)->>'reason',
  'monthly_cap', 'an unsettled reservation counts against the month'
);
select is(public.editorial_ai_settle('a0000000-0000-4000-8000-000000000002', 'settled', 0, 0, 0, 0, 0), 'settled', 'a refused call settles at $0');
select is(public.editorial_ai_settle('a0000000-0000-4000-8000-000000000002', 'settled', 0.4, 10, 0, 0, 10), 'already_settled', 'a settlement is final');
select is(
  public.editorial_ai_reserve('a0000000-0000-4000-8000-000000000004', 'checker', 'openrouter', 'claude-haiku-5-5', 0.6, 1, 1, 10)->>'status',
  'reserved', 'a $0 settlement frees the month again'
);
select is(public.editorial_ai_settle('a0000000-0000-4000-8000-000000000004', 'estimated', 49.9, null, null, null, null), 'settled', 'a call without usage settles as an estimate');
select is(
  public.editorial_ai_reserve('a0000000-0000-4000-8000-000000000005', 'writer', 'anthropic', 'claude-opus-5-5', 0.5, 1, 500, 10)->>'reason',
  'monthly_cap', 'the monthly cap never exceeds $50'
);
select ok(not exists (select 1 from public.editorial_ai_spend where id = 'a0000000-0000-4000-8000-000000000005'), 'a blocked reservation writes nothing');
select throws_ok($$select public.editorial_ai_settle('a0000000-0000-4000-8000-000000000002', 'reserved', 0, null, null, null, null)$$, '22023', null, 'a settlement is settled or estimated');
insert into public.editorial_ai_spend (id, month, operation, model, reserved_usd, settled_usd, cost_state)
select gen_random_uuid(), to_char(now() at time zone 'UTC', 'YYYY-MM'), 'test_writer', 'claude-sonnet-5-5', 0, 0, 'settled' from generate_series(1, 2);
select is(
  public.editorial_ai_reserve('a0000000-0000-4000-8000-000000000006', 'test_writer', 'anthropic', 'claude-sonnet-5-5', 0, 1, 50, 2)->>'reason',
  'test_daily_cap', 'test drafts stop at the daily cap'
);

select * from finish();
rollback;
