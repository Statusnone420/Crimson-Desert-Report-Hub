-- Observation moderation: admin Reject-and-teach for public Wire/Asks items.
--
-- One click writes TWO explicit records — a reason-bearing hide (the decision's
-- own act, mirroring record_scanner_decision's signal quarantine) and a
-- learning rule. Learning still never changes visibility on its own: rules
-- teach discovery, and the hide travels with the auditable decision row, with
-- the same Undo path as every other scanner decision.
--
-- Also folds in two follow-ups this feature depends on:
--   1. persist_patch_observations now backfills source_published_at when a
--      re-observation supplies a real date the stored row lacks (the wire's
--      news slot is often the first source of an honest date).
--   2. undo_scanner_decision is recreated with plain COALESCE: COALESCE is
--      parser syntax, so the previous pg_catalog.coalesce(...) spelling would
--      fail at runtime on first execution (plpgsql parses lazily, which is why
--      applying the original migration never surfaced it).

alter table public.scanner_decisions
  add column if not exists observation_id uuid references public.patch_observations(id) on delete set null;

create index if not exists scanner_decisions_observation_idx
  on public.scanner_decisions (observation_id, created_at desc);

create or replace function public.record_observation_decision(
  p_observation_id uuid,
  p_target_url text,
  p_target_url_hash text,
  p_source_domain text,
  p_decision text,
  p_reason text,
  p_scope_type text,
  p_scope_value text,
  p_confirm_broad boolean default false,
  p_expires_at timestamptz default null
)
returns table (decision_id uuid, rule_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_decision_id uuid := gen_random_uuid();
  new_rule_id uuid := gen_random_uuid();
begin
  if p_observation_id is null then
    raise exception 'observation id is required' using errcode = '22023';
  end if;
  if p_target_url is null or pg_catalog.btrim(p_target_url) = '' then
    raise exception 'target URL is required' using errcode = '22023';
  end if;
  if p_target_url_hash is null or p_target_url_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'target URL hash is invalid' using errcode = '22023';
  end if;
  -- Reject-only: an observation decision always hides and always blocks.
  -- "relevant" (allow) has no meaning here — undo is the restore path.
  if p_decision not in ('off_topic', 'wrong_patch', 'not_issue_report', 'duplicate') then
    raise exception 'invalid observation decision' using errcode = '22023';
  end if;
  if p_reason is null or char_length(pg_catalog.btrim(p_reason)) not between 3 and 500 then
    raise exception 'decision reason must be 3 to 500 characters' using errcode = '22023';
  end if;
  if p_scope_type not in ('exact_url', 'source_path', 'source_domain') then
    raise exception 'invalid rule scope' using errcode = '22023';
  end if;
  if p_scope_value is null or pg_catalog.btrim(p_scope_value) = '' then
    raise exception 'rule scope value is required' using errcode = '22023';
  end if;
  if p_scope_type <> 'exact_url' and not p_confirm_broad then
    raise exception 'broader feedback rules require explicit confirmation' using errcode = '22023';
  end if;
  if p_expires_at is not null and p_expires_at <= pg_catalog.now() then
    raise exception 'rule expiry must be in the future' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.patch_observations where id = p_observation_id
  ) then
    raise exception 'observation not found' using errcode = 'P0002';
  end if;

  -- Same lock order as record_scanner_decision: global visibility lock first,
  -- then the feedback-scope lock, so concurrent refreshes cannot interleave.
  perform pg_catalog.pg_advisory_xact_lock(20260709, 1);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('scanner-feedback:' || p_scope_type || ':' || p_scope_value, 0)
  );

  insert into public.scanner_decisions (
    id,
    observation_id,
    target_url,
    target_url_hash,
    source_domain,
    decision,
    reason
  ) values (
    new_decision_id,
    p_observation_id,
    p_target_url,
    p_target_url_hash,
    p_source_domain,
    p_decision,
    pg_catalog.btrim(p_reason)
  );

  insert into public.scanner_feedback_rules (
    id,
    decision_id,
    action,
    decision,
    scope_type,
    scope_value,
    reason,
    confirmed_at,
    expires_at
  ) values (
    new_rule_id,
    new_decision_id,
    'block',
    p_decision,
    p_scope_type,
    p_scope_value,
    pg_catalog.btrim(p_reason),
    case when p_scope_type = 'exact_url' then pg_catalog.now() when p_confirm_broad then pg_catalog.now() else null end,
    p_expires_at
  );

  update public.scanner_feedback_rules
  set revoked_at = pg_catalog.now(),
      superseded_by_rule_id = new_rule_id
  where id <> new_rule_id
    and scope_type = p_scope_type
    and scope_value = p_scope_value
    and revoked_at is null;

  -- The hide is the decision's own explicit act, not a side effect of the rule.
  update public.patch_observations
  set is_public = false
  where id = p_observation_id;

  return query select new_decision_id, new_rule_id;
end;
$$;

-- Recreate undo so it also restores a hidden observation. Body otherwise
-- matches 20260722170106, with COALESCE spelled unqualified (see header note).
create or replace function public.undo_scanner_decision(p_decision_id uuid)
returns table (undone boolean, affected_cluster_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed integer;
  undone_signal_id uuid;
  undone_observation_id uuid;
  signal_cluster_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(20260709, 1);

  update public.scanner_decisions
  set undone_at = coalesce(undone_at, pg_catalog.now())
  where id = p_decision_id
    and undone_at is null
  returning signal_id, observation_id into undone_signal_id, undone_observation_id;
  get diagnostics changed = row_count;
  if changed = 0 then
    return query select false, null::uuid;
    return;
  end if;

  update public.scanner_feedback_rules
  set revoked_at = coalesce(revoked_at, pg_catalog.now())
  where decision_id = p_decision_id;

  -- Preserve the immutable decision/rule audit rows, but return an unrescued
  -- retained candidate to the teaching desk so the operator can correct it.
  update public.automation_rejected_candidates
  set decision_id = null,
      feedback_rule_id = null,
      decided_at = null
  where decision_id = p_decision_id
    and rescued_at is null;

  if undone_observation_id is not null then
    update public.patch_observations
    set is_public = true
    where id = undone_observation_id;
  end if;

  if undone_signal_id is not null then
    select cluster_id
    into signal_cluster_id
    from public.source_signals
    where id = undone_signal_id;

    if signal_cluster_id is not null then
      update public.issue_clusters
      set visibility_revision = visibility_revision + 1
      where id = signal_cluster_id;
    end if;
  end if;

  return query select true, signal_cluster_id;
end;
$$;

-- Date backfill: a re-observation that carries a real published date fills a
-- stored null instead of being discarded. An existing real date is never
-- overwritten. Body otherwise matches 20260717095918.
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
          source_published_at = coalesce(target.source_published_at, parsed_source_published_at)
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

revoke all on function public.record_observation_decision(uuid, text, text, text, text, text, text, text, boolean, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_observation_decision(uuid, text, text, text, text, text, text, text, boolean, timestamptz)
  to service_role;
