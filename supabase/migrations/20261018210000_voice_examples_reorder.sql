-- Reorder the column's voice examples in one transaction. The caller passes every
-- example id once in the new order, plus the order it read them in. Anything else
-- changes nothing: a partial or repeated list, or a list that changed since the caller
-- read it. So a failed reorder never leaves duplicate or half-moved positions, and two
-- tabs moving examples at once can't silently undo each other's move.
create function public.voice_examples_reorder(p_ids uuid[], p_expected uuid[])
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform pg_advisory_xact_lock(pg_catalog.hashtextextended('voice_examples_limit', 0));
  if p_expected is null or p_expected is distinct from (
    select coalesce(array_agg(e.id order by e.position, e.created_at, e.id), '{}'::uuid[]) from public.voice_examples e
  ) then
    raise exception 'voice_examples_reorder_stale' using errcode = '22023';
  end if;
  if p_ids is null
    or cardinality(p_ids) <> (select count(*) from public.voice_examples)
    or cardinality(p_ids) <> (select count(distinct id) from unnest(p_ids) as given(id))
    or exists (select 1 from unnest(p_ids) as given(id) where not exists (select 1 from public.voice_examples e where e.id = given.id)) then
    raise exception 'voice_examples_reorder_mismatch' using errcode = '22023';
  end if;
  update public.voice_examples e
    set position = given.ordinality - 1, updated_at = now()
    from unnest(p_ids) with ordinality as given(id, ordinality)
    where e.id = given.id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.voice_examples_reorder(uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.voice_examples_reorder(uuid[], uuid[]) to service_role;
