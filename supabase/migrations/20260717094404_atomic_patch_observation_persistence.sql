-- Serialize observation persistence per patch so overlapping scans cannot both
-- reserve the same remaining capacity. The application calls this function
-- with the service-role client; the function owns the cap and the transaction.
create or replace function public.persist_patch_observations(
  p_patch_version text,
  p_observations jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  observation jsonb;
  observation_hash text;
  existing_id uuid;
  current_count integer;
  inserted_count integer := 0;
begin
  if p_patch_version is null
    or p_patch_version !~ '^[0-9]+\.[0-9]{1,2}(\.[0-9]{1,2})?$' then
    raise exception 'invalid patch version' using errcode = '22023';
  end if;

  if p_observations is null or pg_catalog.jsonb_typeof(p_observations) <> 'array' then
    raise exception 'observations must be a JSON array' using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_observations) as items(value)
    where pg_catalog.jsonb_typeof(items.value) <> 'object'
  ) then
    raise exception 'observations must contain JSON objects' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('patch_observations:' || p_patch_version, 0)
  );

  select count(*)::integer
    into current_count
  from public.patch_observations
  where patch_version = p_patch_version;

  -- Deduplicate in the transaction as well as in the caller. This keeps the
  -- cap correct even if another trusted caller sends repeated hashes.
  for observation in
    select candidates.value
    from (
      select distinct on (items.value->>'url_hash')
        items.value,
        items.ordinal
      from pg_catalog.jsonb_array_elements(p_observations)
        with ordinality as items(value, ordinal)
      order by items.value->>'url_hash', items.ordinal
    ) as candidates
    order by candidates.ordinal
  loop
    observation_hash := observation->>'url_hash';
    if observation_hash is null or pg_catalog.btrim(observation_hash) = '' then
      raise exception 'observation URL hash is required' using errcode = '22023';
    end if;
    if observation->>'kind' not in ('patch_release', 'press_reception', 'fix_announcement', 'community_ask') then
      raise exception 'invalid observation kind' using errcode = '22023';
    end if;
    if observation->>'title' is null or pg_catalog.btrim(observation->>'title') = '' then
      raise exception 'observation title is required' using errcode = '22023';
    end if;
    if observation->>'url' is null or pg_catalog.btrim(observation->>'url') = '' then
      raise exception 'observation URL is required' using errcode = '22023';
    end if;
    if observation->>'observed_at' is null then
      raise exception 'observation time is required' using errcode = '22023';
    end if;

    existing_id := null;
    select id
      into existing_id
    from public.patch_observations
    where patch_version = p_patch_version
      and url_hash = observation_hash
    for update;

    if existing_id is not null then
      update public.patch_observations as target
      set seen_count = target.seen_count + 1,
          observed_at = (observation->>'observed_at')::timestamptz,
          last_seen_at = (observation->>'observed_at')::timestamptz,
          title = pg_catalog.left(observation->>'title', 240),
          url = observation->>'url',
          snippet = pg_catalog.left(observation->>'snippet', 500)
      where target.id = existing_id;
    elsif current_count < 40 then
      insert into public.patch_observations (
        patch_version,
        kind,
        title,
        url,
        url_hash,
        source_domain,
        snippet,
        source_published_at,
        observed_at
      ) values (
        p_patch_version,
        observation->>'kind',
        pg_catalog.left(observation->>'title', 240),
        observation->>'url',
        observation_hash,
        observation->>'source_domain',
        pg_catalog.left(observation->>'snippet', 500),
        (observation->>'source_published_at')::timestamptz,
        (observation->>'observed_at')::timestamptz
      );
      current_count := current_count + 1;
      inserted_count := inserted_count + 1;
    end if;
  end loop;

  return inserted_count;
end;
$$;

revoke all on function public.persist_patch_observations(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.persist_patch_observations(text, jsonb)
  to service_role;
