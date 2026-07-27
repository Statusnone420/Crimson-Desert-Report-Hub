-- A corrected publication date must be able to heal a stored one.
--
-- The update branch previously kept the stored value (`coalesce(stored,
-- incoming)`), so a row persisted with a bad date — pre-era, future-skewed,
-- junk — held it forever: the backfill only filled NULLs, the Brief kept
-- hiding the row, and the scanner's shelf could still treat the row as dated
-- in memory. Flipping to incoming-first makes re-observation converge stored
-- state toward renderability.
--
-- The flip is safe ONLY together with the caller-side contract that ships in
-- the same change: `persistObservations` sends `source_published_at` non-null
-- ONLY when the date passes the Brief's own display gate (format allowlist,
-- 48h future-skew bound, patch-era floor). Every non-null incoming date is
-- therefore renderable, so "replace" can only move a stored date toward the
-- Brief; undisplayable sightings arrive as NULL and `coalesce` preserves
-- whatever is stored.
--
-- Rollout order (rolling deploys): deploy the code FIRST, then apply this
-- migration. New code + old function degrades gracefully (stored-first
-- coalesce, inserts store NULL instead of junk). Old code + new function is
-- the one unsafe pairing — a raw unvetted date could replace a stored good
-- one — so this file must never be applied ahead of the code it pairs with.
--
-- Two ways that pairing sneaks back in, and the guard for each:
--   - Ordering alone is not airtight: a scheduled scan that BEGAN before the
--     deploy promotion runs old code to completion, and applying mid-flight
--     puts that run against the new function. Pause the scanner, deploy,
--     apply, unpause.
--   - A deployment ROLLBACK re-promotes old code while this migration stays
--     applied. Re-deploy the code before (or instead of) rolling back. A
--     junk date written in such a window is sticky: the new contract sends
--     unvouched dates as NULL, which preserves stored values, so nothing
--     heals it until a displayable sighting of that same URL arrives.
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
          -- Incoming-first: the caller only sends a non-null date the Brief
          -- can render, so replacing is always a step toward renderability,
          -- and a NULL incoming preserves whatever is stored.
          source_published_at = coalesce(parsed_source_published_at, target.source_published_at)
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
