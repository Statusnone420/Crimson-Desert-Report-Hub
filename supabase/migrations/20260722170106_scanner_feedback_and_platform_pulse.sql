-- Durable operator feedback for the public-source scanner.
--
-- Visibility remains separate: these records teach discovery/relevance only.
-- Every decision is an immutable audit event; Undo revokes its active rule and
-- marks the event undone without erasing history.

create table if not exists public.scanner_decisions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  candidate_id uuid references public.automation_rejected_candidates(id) on delete set null,
  signal_id uuid references public.source_signals(id) on delete set null,
  target_url text not null check (pg_catalog.btrim(target_url) <> ''),
  target_url_hash text not null check (target_url_hash ~ '^[0-9a-f]{64}$'),
  source_domain text,
  decision text not null check (decision in ('relevant', 'off_topic', 'wrong_patch', 'not_issue_report', 'duplicate')),
  reason text not null check (char_length(pg_catalog.btrim(reason)) between 3 and 500),
  actor text not null default 'admin' check (actor = 'admin'),
  undone_at timestamptz
);

create index if not exists scanner_decisions_candidate_idx
  on public.scanner_decisions (candidate_id, created_at desc);
create index if not exists scanner_decisions_signal_idx
  on public.scanner_decisions (signal_id, created_at desc);
create index if not exists scanner_decisions_url_idx
  on public.scanner_decisions (target_url_hash, created_at desc);

create table if not exists public.scanner_feedback_rules (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  decision_id uuid not null references public.scanner_decisions(id) on delete cascade,
  action text not null check (action in ('allow', 'block')),
  decision text not null check (decision in ('relevant', 'off_topic', 'wrong_patch', 'not_issue_report', 'duplicate')),
  scope_type text not null check (scope_type in ('exact_url', 'source_path', 'source_domain')),
  scope_value text not null check (pg_catalog.btrim(scope_value) <> ''),
  reason text not null check (char_length(pg_catalog.btrim(reason)) between 3 and 500),
  confirmed_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  superseded_by_rule_id uuid references public.scanner_feedback_rules(id) on delete set null,
  check (scope_type = 'exact_url' or confirmed_at is not null),
  check (expires_at is null or expires_at > created_at),
  check ((decision = 'relevant' and action = 'allow') or (decision <> 'relevant' and action = 'block'))
);

create index if not exists scanner_feedback_rules_active_idx
  on public.scanner_feedback_rules (scope_type, scope_value, created_at desc)
  where revoked_at is null;
create index if not exists scanner_feedback_rules_decision_idx
  on public.scanner_feedback_rules (decision_id);

alter table public.automation_rejected_candidates
  add column if not exists decision_id uuid references public.scanner_decisions(id) on delete set null,
  add column if not exists feedback_rule_id uuid references public.scanner_feedback_rules(id) on delete set null,
  add column if not exists decided_at timestamptz;

alter table public.automation_runs
  add column if not exists operator_rules_matched integer not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'automation_runs_operator_rules_matched_nonnegative'
      and conrelid = 'public.automation_runs'::pg_catalog.regclass
  ) then
    alter table public.automation_runs
      add constraint automation_runs_operator_rules_matched_nonnegative
      check (operator_rules_matched >= 0);
  end if;
end $$;

create or replace function public.record_scanner_decision(
  p_candidate_id uuid,
  p_signal_id uuid,
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
returns table (decision_id uuid, rule_id uuid, affected_cluster_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_decision_id uuid := gen_random_uuid();
  new_rule_id uuid := gen_random_uuid();
  rule_action text;
  signal_cluster_id uuid;
begin
  if (p_candidate_id is null) = (p_signal_id is null) then
    raise exception 'exactly one candidate or signal is required' using errcode = '22023';
  end if;
  if p_target_url is null or pg_catalog.btrim(p_target_url) = '' then
    raise exception 'target URL is required' using errcode = '22023';
  end if;
  if p_target_url_hash is null or p_target_url_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'target URL hash is invalid' using errcode = '22023';
  end if;
  if p_decision not in ('relevant', 'off_topic', 'wrong_patch', 'not_issue_report', 'duplicate') then
    raise exception 'invalid scanner decision' using errcode = '22023';
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
  if p_signal_id is not null and p_scope_type <> 'exact_url' then
    raise exception 'source-signal feedback must target one exact URL' using errcode = '22023';
  end if;
  if p_signal_id is not null and p_decision = 'relevant' then
    raise exception 'a retained source signal is already relevant' using errcode = '22023';
  end if;
  if p_expires_at is not null and p_expires_at <= pg_catalog.now() then
    raise exception 'rule expiry must be in the future' using errcode = '22023';
  end if;

  if p_candidate_id is not null and not exists (
    select 1 from public.automation_rejected_candidates where id = p_candidate_id
  ) then
    raise exception 'rejected candidate not found' using errcode = 'P0002';
  end if;
  if p_signal_id is not null and not exists (
    select 1 from public.source_signals where id = p_signal_id
  ) then
    raise exception 'source signal not found' using errcode = 'P0002';
  end if;

  rule_action := case when p_decision = 'relevant' then 'allow' else 'block' end;

  -- Signal decisions also quarantine a public row. Join the established global
  -- visibility lock order before the feedback-scope lock so a concurrent
  -- visibility refresh cannot overwrite the operator decision.
  perform pg_catalog.pg_advisory_xact_lock(20260709, 1);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('scanner-feedback:' || p_scope_type || ':' || p_scope_value, 0)
  );

  insert into public.scanner_decisions (
    id,
    candidate_id,
    signal_id,
    target_url,
    target_url_hash,
    source_domain,
    decision,
    reason
  ) values (
    new_decision_id,
    p_candidate_id,
    p_signal_id,
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
    rule_action,
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

  if p_candidate_id is not null then
    update public.automation_rejected_candidates
    set decision_id = new_decision_id,
        feedback_rule_id = new_rule_id,
        decided_at = pg_catalog.now()
    where id = p_candidate_id;
  end if;

  if p_signal_id is not null then
    update public.source_signals
    set public_status = 'hidden',
        promoted_at = null,
        promotion_reason = 'operator_feedback_blocked'
    where id = p_signal_id
    returning cluster_id into signal_cluster_id;

    if not found then
      raise exception 'source signal not found' using errcode = 'P0002';
    end if;

    if signal_cluster_id is not null then
      update public.issue_clusters
      set visibility_revision = visibility_revision + 1
      where id = signal_cluster_id;
    end if;
  end if;

  return query select new_decision_id, new_rule_id, signal_cluster_id;
end;
$$;

create or replace function public.undo_scanner_decision(p_decision_id uuid)
returns table (undone boolean, affected_cluster_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed integer;
  undone_signal_id uuid;
  signal_cluster_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(20260709, 1);

  update public.scanner_decisions
  set undone_at = pg_catalog.coalesce(undone_at, pg_catalog.now())
  where id = p_decision_id
    and undone_at is null
  returning signal_id into undone_signal_id;
  get diagnostics changed = row_count;
  if changed = 0 then
    return query select false, null::uuid;
    return;
  end if;

  update public.scanner_feedback_rules
  set revoked_at = pg_catalog.coalesce(revoked_at, pg_catalog.now())
  where decision_id = p_decision_id;

  -- Preserve the immutable decision/rule audit rows, but return an unrescued
  -- retained candidate to the teaching desk so the operator can correct it.
  update public.automation_rejected_candidates
  set decision_id = null,
      feedback_rule_id = null,
      decided_at = null
  where decision_id = p_decision_id
    and rescued_at is null;

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

alter table public.scanner_decisions enable row level security;
alter table public.scanner_feedback_rules enable row level security;

revoke all on public.scanner_decisions from public, anon, authenticated;
revoke all on public.scanner_feedback_rules from public, anon, authenticated;
revoke all on function public.record_scanner_decision(uuid, uuid, text, text, text, text, text, text, text, boolean, timestamptz)
  from public, anon, authenticated;
revoke all on function public.undo_scanner_decision(uuid)
  from public, anon, authenticated;

grant usage on schema public to service_role;
grant select, insert, update, delete on public.scanner_decisions to service_role;
grant select, insert, update, delete on public.scanner_feedback_rules to service_role;
grant execute on function public.record_scanner_decision(uuid, uuid, text, text, text, text, text, text, text, boolean, timestamptz)
  to service_role;
grant execute on function public.undo_scanner_decision(uuid)
  to service_role;

-- Steam Pulse is a source-health lane, not player evidence. Recommendation
-- identifiers are hashed by source before storage; review text and reviewer
-- identity never enter these tables.

alter table public.source_signals
  drop constraint if exists source_signals_source_check;
alter table public.source_signals
  add constraint source_signals_source_check
  check (source in ('reddit', 'web_search', 'steam_review', 'x_manual', 'x_search'));

alter table public.source_signals
  drop constraint if exists source_signals_source_type_check;
alter table public.source_signals
  add constraint source_signals_source_type_check
  check (source_type in ('reddit', 'web_search', 'steam_review', 'x_manual', 'x_search'));

create table if not exists public.steam_review_receipts (
  recommendation_hash text primary key check (recommendation_hash ~ '^[0-9a-f]{64}$'),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  source_created_at timestamptz not null,
  source_updated_at timestamptz not null,
  voted_up boolean not null,
  playtime_at_review_minutes integer check (playtime_at_review_minutes is null or playtime_at_review_minutes >= 0),
  check (source_updated_at >= source_created_at)
);

create index if not exists steam_review_receipts_updated_idx
  on public.steam_review_receipts (source_updated_at desc);

create table if not exists public.steam_pulse_snapshots (
  snapshot_day date primary key,
  collected_at timestamptz not null,
  total_reviews integer not null check (total_reviews >= 0),
  total_positive integer not null check (total_positive >= 0),
  total_negative integer not null check (total_negative >= 0),
  positive_percentage numeric(5, 1) not null check (positive_percentage between 0 and 100),
  review_count_delta integer,
  reviews_scanned integer not null check (reviews_scanned >= 0),
  issue_language_count integer not null check (issue_language_count >= 0),
  leads_retained integer not null check (leads_retained >= 0),
  check (total_positive + total_negative <= total_reviews),
  check (issue_language_count <= reviews_scanned),
  check (leads_retained <= issue_language_count)
);

create index if not exists steam_pulse_snapshots_collected_idx
  on public.steam_pulse_snapshots (collected_at desc);

alter table public.steam_review_receipts enable row level security;
alter table public.steam_pulse_snapshots enable row level security;

revoke all on public.steam_review_receipts from public, anon, authenticated;
revoke all on public.steam_pulse_snapshots from public, anon, authenticated;

grant select, insert, update on public.steam_review_receipts to service_role;
grant select, insert, update on public.steam_pulse_snapshots to service_role;

-- Platform Pulse is also context, never evidence. It stores only public IGDB
-- metadata and point-in-time Twitch aggregates; OAuth tokens, channel/user
-- identities, titles, thumbnails, and stream URLs never enter the database.

create table if not exists public.platform_context_snapshots (
  captured_at timestamptz primary key,
  igdb_status text not null check (igdb_status in ('ok', 'absent', 'unconfigured', 'malformed', 'error')),
  igdb_game_id bigint,
  igdb_name text,
  igdb_slug text,
  igdb_summary text,
  igdb_first_release_at timestamptz,
  igdb_platforms text[] not null default '{}',
  twitch_status text not null check (twitch_status in ('ok', 'absent', 'unconfigured', 'malformed', 'error')),
  twitch_live_streams integer check (twitch_live_streams is null or twitch_live_streams >= 0),
  twitch_live_viewers integer check (twitch_live_viewers is null or twitch_live_viewers >= 0),
  twitch_complete boolean,
  check (
    (igdb_status = 'ok' and igdb_game_id is not null and igdb_name is not null)
    or (igdb_status <> 'ok' and igdb_game_id is null and igdb_name is null)
  ),
  check (
    (twitch_status = 'ok' and twitch_live_streams is not null and twitch_live_viewers is not null and twitch_complete is not null)
    or (twitch_status <> 'ok' and twitch_live_streams is null and twitch_live_viewers is null and twitch_complete is null)
  )
);

create index if not exists platform_context_snapshots_captured_idx
  on public.platform_context_snapshots (captured_at desc);

alter table public.platform_context_snapshots enable row level security;
revoke all on public.platform_context_snapshots from public, anon, authenticated;
grant select, insert on public.platform_context_snapshots to service_role;

-- Visibility is a separate break-glass concern. Active overrides must explain
-- themselves; scanner feedback rules above never change issue visibility.

alter table public.issue_clusters
  add column if not exists admin_visibility_reason text,
  add column if not exists admin_visibility_changed_at timestamptz;

update public.issue_clusters
set admin_visibility_reason = coalesce(admin_visibility_reason, 'Existing override created before reason tracking.'),
    admin_visibility_changed_at = coalesce(admin_visibility_changed_at, now())
where admin_visibility_override is not null;

alter table public.issue_clusters
  add constraint issue_clusters_visibility_override_explained
  check (
    (admin_visibility_override is null and admin_visibility_reason is null and admin_visibility_changed_at is null)
    or (
      admin_visibility_override is not null
      and admin_visibility_reason is not null
      and char_length(btrim(admin_visibility_reason)) between 3 and 500
      and admin_visibility_changed_at is not null
    )
  );

drop function if exists public.set_cluster_visibility_override(uuid, text);

create function public.set_cluster_visibility_override(
  p_cluster_id uuid,
  p_visibility text,
  p_reason text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_visibility not in ('auto', 'force_public', 'force_hidden') then
    raise exception 'invalid visibility override' using errcode = '22023';
  end if;
  if p_visibility <> 'auto' and (p_reason is null or char_length(pg_catalog.btrim(p_reason)) not between 3 and 500) then
    raise exception 'visibility override reason required' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(20260709, 1);

  update public.issue_clusters
  set
    visibility_restore_is_public = case
      when p_visibility = 'auto' then null
      when admin_visibility_override is null then is_public
      else coalesce(visibility_restore_is_public, is_public)
    end,
    visibility_restore_auto_public = case
      when p_visibility = 'auto' then null
      when admin_visibility_override is null then auto_public
      else coalesce(visibility_restore_auto_public, auto_public)
    end,
    admin_visibility_override = case when p_visibility = 'auto' then null else p_visibility end,
    admin_visibility_reason = case when p_visibility = 'auto' then null else pg_catalog.btrim(p_reason) end,
    admin_visibility_changed_at = case when p_visibility = 'auto' then null else pg_catalog.now() end,
    auto_public = case
      when p_visibility = 'auto' then coalesce(visibility_restore_auto_public, auto_public)
      else auto_public
    end,
    is_public = case
      when p_visibility = 'force_public' then true
      when p_visibility = 'force_hidden' then false
      else coalesce(visibility_restore_is_public, is_public)
    end,
    visibility_revision = visibility_revision + 1
  where id = p_cluster_id;

  if not found then
    raise exception 'issue cluster not found' using errcode = 'P0002';
  end if;

  if p_visibility = 'force_hidden' then
    update public.source_signals
    set public_status = 'hidden',
        promoted_at = null,
        promotion_reason = 'admin_force_hidden'
    where cluster_id = p_cluster_id;
  end if;
end;
$$;

revoke all on function public.set_cluster_visibility_override(uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_cluster_visibility_override(uuid, text, text) to service_role;
