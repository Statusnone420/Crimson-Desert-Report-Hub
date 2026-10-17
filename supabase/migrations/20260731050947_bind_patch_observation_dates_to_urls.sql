-- Publication and first-seen dates describe an exact page, while serialized
-- community asks deliberately share one campaign-wide url_hash. When a new
-- thread becomes the campaign's representative, move every page-owned clock
-- with the URL: accept its certified publication date (including NULL, which
-- selects the honest first-seen fallback) and reset created_at to this page's
-- first observation. Same-URL re-observations retain the established contract.
--
-- The behavior remains gated by the existing in-band date_contract marker.
-- Unmarked/legacy callers retain the previous stored-first behavior exactly.
-- The three-argument overload is also a deployment handshake: a new caller can
-- distinguish this implementation from the previous two-argument RPC before
-- deciding whether a legacy payload is safe to send.
create or replace function public.persist_patch_observations(
  p_patch_version text,
  p_observations jsonb,
  p_date_contract_version integer
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
  existing_url text;
  current_count integer;
  inserted_count integer := 0;
  parsed_source_published_at timestamptz;
begin
  if p_date_contract_version is distinct from 2 then
    raise exception 'unsupported observation date contract version' using errcode = '22023';
  end if;

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
    existing_url := null;
    select id, url
      into existing_id, existing_url
    from public.patch_observations
    where patch_version = p_patch_version
      and url_hash = observation_hash
    for update;

    if existing_id is not null then
      update public.patch_observations as target
      set seen_count = target.seen_count + 1,
          observed_at = (observation->>'observed_at')::timestamptz,
          last_seen_at = (observation->>'observed_at')::timestamptz,
          -- For a marked campaign rollover this row now represents a different
          -- page. Its first-seen clock must move with that page too.
          created_at = case
            when observation->>'date_contract' = 'displayable_only'
              and existing_url is distinct from observation->>'url'
              then (observation->>'observed_at')::timestamptz
            else target.created_at
          end,
          title = pg_catalog.left(observation->>'title', 240),
          url = observation->>'url',
          snippet = pg_catalog.left(observation->>'snippet', 500),
          source_published_at = case
            -- A marked different URL owns a different date. NULL deliberately
            -- clears the previous page's date so Community Asks can use the
            -- newly reset first-seen clock instead of displaying a false pair.
            when observation->>'date_contract' = 'displayable_only'
              and existing_url is distinct from observation->>'url'
              then parsed_source_published_at
            -- Same marked page: incoming-first lets a certified date fill/heal
            -- the row, while NULL preserves its established publication date.
            when observation->>'date_contract' = 'displayable_only'
              then coalesce(parsed_source_published_at, target.source_published_at)
            -- Unmarked rows keep the legacy stored-first contract.
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

-- Preserve the pre-migration application contract. Once this migration lands,
-- an older in-flight app still reaches the URL-bound implementation through the
-- original two-argument signature.
create or replace function public.persist_patch_observations(
  p_patch_version text,
  p_observations jsonb
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select public.persist_patch_observations(p_patch_version, p_observations, 2);
$$;

revoke all on function public.persist_patch_observations(text, jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.persist_patch_observations(text, jsonb, integer)
  to service_role;

revoke all on function public.persist_patch_observations(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.persist_patch_observations(text, jsonb)
  to service_role;
