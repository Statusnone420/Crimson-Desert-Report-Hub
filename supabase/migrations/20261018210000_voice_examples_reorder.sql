-- Reorder the column's voice examples in one transaction. The caller passes every
-- example id once, in the new order; anything else changes nothing, so a failed or
-- concurrent reorder can never leave duplicate or half-moved positions.
create function public.voice_examples_reorder(p_ids uuid[])
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform pg_advisory_xact_lock(pg_catalog.hashtextextended('voice_examples_limit', 0));
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

revoke all on function public.voice_examples_reorder(uuid[]) from public, anon, authenticated;
grant execute on function public.voice_examples_reorder(uuid[]) to service_role;
