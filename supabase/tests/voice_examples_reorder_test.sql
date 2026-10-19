begin;
select plan(9);

select ok(not has_function_privilege('anon', 'public.voice_examples_reorder(uuid[], uuid[])', 'EXECUTE'), 'browsers cannot reorder voice examples');
select ok(has_function_privilege('service_role', 'public.voice_examples_reorder(uuid[], uuid[])', 'EXECUTE'), 'server code can reorder voice examples');

set local role service_role;

insert into public.voice_examples (id, body, position) values
  ('b0000000-0000-4000-8000-000000000001', 'One', 0),
  ('b0000000-0000-4000-8000-000000000002', 'Two', 1),
  ('b0000000-0000-4000-8000-000000000003', 'Three', 2);

select is(
  public.voice_examples_reorder(
    array['b0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000003']::uuid[],
    array['b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000003']::uuid[]
  ),
  3, 'a full new order moves every example'
);
select is(
  (select array_agg(body order by position) from public.voice_examples),
  array['Two', 'One', 'Three'], 'positions follow the given order'
);
-- A second tab read One, Two, Three before the move above and now moves Three up.
select throws_ok(
  $$select public.voice_examples_reorder(
    array['b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000002']::uuid[],
    array['b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000003']::uuid[]
  )$$,
  '22023', 'voice_examples_reorder_stale', 'a reorder built on an order that has since changed is refused'
);
select is(
  (select array_agg(body order by position) from public.voice_examples),
  array['Two', 'One', 'Three'], 'the stale reorder leaves the first move in place'
);
select throws_ok(
  $$select public.voice_examples_reorder(
    array['b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002']::uuid[],
    array['b0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000003']::uuid[]
  )$$,
  '22023', 'voice_examples_reorder_mismatch', 'a partial order is refused'
);
select throws_ok(
  $$select public.voice_examples_reorder(
    array['b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000003']::uuid[],
    array['b0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000003']::uuid[]
  )$$,
  '22023', 'voice_examples_reorder_mismatch', 'a repeated id is refused'
);
select is(
  (select array_agg(body order by position) from public.voice_examples),
  array['Two', 'One', 'Three'], 'a refused reorder changes nothing'
);

select * from finish();
rollback;
