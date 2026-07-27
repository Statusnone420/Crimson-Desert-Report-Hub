-- A corrected publication date must be able to heal a stored one.
--
-- The update branch previously kept the stored value (`coalesce(stored,
-- incoming)`), so a row persisted with a bad date — pre-era, future-skewed,
-- junk — held it forever: the backfill only filled NULLs, the Brief kept
-- hiding the row, and the scanner's shelf could still treat the row as dated
-- in memory. Flipping to incoming-first makes re-observation converge stored
-- state toward renderability.
--
-- The flip is gated IN-BAND rather than by deploy ordering: incoming-first
-- coalescing applies only to observations whose JSON carries
-- `date_contract = 'displayable_only'` — the marker the paired
-- `persistObservations` stamps on every row after it started sending
-- `source_published_at` non-null ONLY when the date passes the Brief's own
-- display gate (format allowlist, 48h future-skew bound, patch-era floor).
-- Every marked non-null date is therefore renderable, so "replace" can only
-- move a stored date toward the Brief; marked undisplayable sightings arrive
-- as NULL and preserve whatever is stored.
--
-- Unmarked rows — any in-flight invocation of a previous deployment, or a
-- rolled-back revision — keep the legacy stored-first coalesce exactly as
-- before this migration, so no deploy/apply/rollback ordering can let an
-- unvetted raw date replace a stored good one. Enforcement lives in the
-- payload, not in a runbook: every pairing of old/new code with old/new
-- function behaves identically to the older half of the pair.
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
  parsed_source_published_at timestamptz;
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

    -- published_date is external and optional; a malformed value must not roll
    -- back the batch. Parsed once here so both branches can use it.
    parsed_source_published_at := null;
    if nullif(pg_catalog.btrim(observation->>'source_published_at'), '') is not null then
      begin
        parsed_source_published_at := (observation->>'source_published_at')::timestamptz;
      exception when others then
        parsed_source_published_at := null;
      end;
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
          snippet = pg_catalog.left(observation->>'snippet', 500),
          -- Marked rows: incoming-first — the marker certifies the caller
          -- only sends a non-null date the Brief can render, so replacing is
          -- always a step toward renderability, and NULL preserves stored.
          -- Unmarked rows (legacy callers): stored-first, exactly the
          -- pre-migration behavior.
          source_published_at = case
            when observation->>'date_contract' = 'displayable_only'
              then coalesce(parsed_source_published_at, target.source_published_at)
            else coalesce(target.source_published_at, parsed_source_published_at)
          end
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
        parsed_source_published_at,
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
