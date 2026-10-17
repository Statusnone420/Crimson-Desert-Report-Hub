-- Keep the automatic visibility baseline live under an admin override, make
-- approved-report promotion durable in the report transaction, and reject any
-- refresh computed from a stale visibility revision before it writes rows.
alter table public.issue_clusters
  add column visibility_restore_auto_public boolean,
  add column visibility_revision bigint not null default 0;

alter table public.issue_clusters
  add constraint issue_clusters_visibility_revision_nonnegative
  check (visibility_revision >= 0);

-- No overrides were active when the preceding migration was applied, but keep
-- the follow-up safe if another environment applies it with one already set.
update public.issue_clusters
set
  visibility_restore_is_public = coalesce(visibility_restore_is_public, is_public),
  visibility_restore_auto_public = coalesce(visibility_restore_auto_public, auto_public)
where admin_visibility_override is not null;

create or replace function public.set_cluster_visibility_override(
  p_cluster_id uuid,
  p_visibility text
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

  -- This remains the first application-defined lock for visibility writes.
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
    set
      public_status = 'hidden',
      promoted_at = null,
      promotion_reason = 'admin_force_hidden'
    where cluster_id = p_cluster_id;
  end if;
end;
$$;

revoke all on function public.set_cluster_visibility_override(uuid, text) from public, anon, authenticated;
grant execute on function public.set_cluster_visibility_override(uuid, text) to service_role;

-- Report statements join the existing global lock order before taking report
-- row locks, because the row trigger below writes issue_clusters.
drop trigger if exists trg_lock_report_visibility_insert on public.bug_reports;
create trigger trg_lock_report_visibility_insert
before insert on public.bug_reports
for each statement execute function public.lock_visibility_write_statement();

drop trigger if exists trg_lock_report_visibility_update on public.bug_reports;
create trigger trg_lock_report_visibility_update
before update of moderation_status, cluster_id on public.bug_reports
for each statement execute function public.lock_visibility_write_statement();

drop trigger if exists trg_lock_report_visibility_delete on public.bug_reports;
create trigger trg_lock_report_visibility_delete
before delete on public.bug_reports
for each statement execute function public.lock_visibility_write_statement();

create or replace function public.sync_approved_report_visibility()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  old_approved_cluster uuid;
  new_approved_cluster uuid;
begin
  if tg_op in ('UPDATE', 'DELETE')
     and old.moderation_status = 'approved'
     and old.cluster_id is not null then
    old_approved_cluster := old.cluster_id;
  end if;

  if tg_op in ('INSERT', 'UPDATE')
     and new.moderation_status = 'approved'
     and new.cluster_id is not null then
    new_approved_cluster := new.cluster_id;
  end if;

  -- Moving or removing an approval invalidates any in-flight computation. It
  -- cannot blindly demote the old cluster because other evidence may qualify it.
  if old_approved_cluster is not null
     and old_approved_cluster is distinct from new_approved_cluster then
    update public.issue_clusters
    set visibility_revision = visibility_revision + 1
    where id = old_approved_cluster;
  end if;

  -- One approved direct report is sufficient automatic evidence. Under a
  -- forced override, advance the hidden automatic baseline without exposing it.
  if new_approved_cluster is not null
     and new_approved_cluster is distinct from old_approved_cluster then
    update public.issue_clusters
    set
      auto_public = true,
      is_public = case
        when admin_visibility_override = 'force_hidden' then false
        else true
      end,
      visibility_restore_auto_public = case
        when admin_visibility_override is null then null
        else true
      end,
      visibility_restore_is_public = case
        when admin_visibility_override is null then null
        else true
      end,
      visibility_revision = visibility_revision + 1
    where id = new_approved_cluster;
  end if;

  return null;
end;
$$;

revoke all on function public.sync_approved_report_visibility() from public, anon, authenticated;

drop trigger if exists trg_sync_approved_report_visibility on public.bug_reports;
create trigger trg_sync_approved_report_visibility
after insert or update of moderation_status, cluster_id or delete on public.bug_reports
for each row execute function public.sync_approved_report_visibility();

create or replace function public.apply_cluster_visibility_refresh(
  p_cluster_id uuid,
  p_expected_revision bigint,
  p_cluster_patch jsonb,
  p_signal_patches jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_override text;
  current_revision bigint;
  patch record;
begin
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'invalid expected visibility revision' using errcode = '22023';
  end if;

  if p_cluster_patch is null
     or pg_catalog.jsonb_typeof(p_cluster_patch) <> 'object'
     or not (
       p_cluster_patch ?& array[
         'signal_count',
         'direct_report_count',
         'verified_report_count',
         'public_signal_count',
         'last_signal_at',
         'auto_public',
         'is_public'
       ]
     )
     or (
       p_cluster_patch - array[
         'signal_count',
         'direct_report_count',
         'verified_report_count',
         'public_signal_count',
         'last_signal_at',
         'auto_public',
         'is_public'
       ]::text[]
     ) <> '{}'::jsonb then
    raise exception 'invalid cluster visibility patch' using errcode = '22023';
  end if;

  if p_signal_patches is null or pg_catalog.jsonb_typeof(p_signal_patches) <> 'array' then
    raise exception 'invalid signal visibility patches' using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_signal_patches) as item(value)
    where pg_catalog.jsonb_typeof(item.value) <> 'object'
       or not (item.value ?& array['id', 'public_status', 'promoted_at', 'promotion_reason'])
       or (
         item.value - array['id', 'public_status', 'promoted_at', 'promotion_reason']::text[]
       ) <> '{}'::jsonb
  ) then
    raise exception 'invalid signal visibility patch' using errcode = '22023';
  end if;

  select *
  into patch
  from pg_catalog.jsonb_to_record(p_cluster_patch) as parsed(
    signal_count integer,
    direct_report_count integer,
    verified_report_count integer,
    public_signal_count integer,
    last_signal_at timestamptz,
    auto_public boolean,
    is_public boolean
  );

  if patch.signal_count is null
     or patch.direct_report_count is null
     or patch.verified_report_count is null
     or patch.public_signal_count is null
     or patch.auto_public is null
     or patch.is_public is null
     or patch.signal_count < 0
     or patch.direct_report_count < 0
     or patch.verified_report_count < 0
     or patch.public_signal_count < 0
     or patch.public_signal_count > patch.signal_count
     or patch.signal_count <> pg_catalog.jsonb_array_length(p_signal_patches) then
    raise exception 'invalid cluster visibility values' using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_to_recordset(p_signal_patches) as signal_patch(
      id uuid,
      public_status text,
      promoted_at timestamptz,
      promotion_reason text
    )
    where signal_patch.id is null
       or signal_patch.public_status not in ('private', 'public', 'hidden')
       or signal_patch.promotion_reason is null
       or (signal_patch.public_status = 'public') is distinct from (signal_patch.promoted_at is not null)
  ) then
    raise exception 'invalid signal visibility values' using errcode = '22023';
  end if;

  if (
    select count(*)
    from pg_catalog.jsonb_to_recordset(p_signal_patches) as signal_patch(
      id uuid,
      public_status text,
      promoted_at timestamptz,
      promotion_reason text
    )
    where signal_patch.public_status = 'public'
  ) <> patch.public_signal_count then
    raise exception 'public signal count mismatch' using errcode = '22023';
  end if;

  if (
    select count(*)
    from pg_catalog.jsonb_to_recordset(p_signal_patches) as signal_patch(
      id uuid,
      public_status text,
      promoted_at timestamptz,
      promotion_reason text
    )
  ) <> (
    select count(distinct signal_patch.id)
    from pg_catalog.jsonb_to_recordset(p_signal_patches) as signal_patch(
      id uuid,
      public_status text,
      promoted_at timestamptz,
      promotion_reason text
    )
  ) then
    raise exception 'duplicate signal visibility patch' using errcode = '22023';
  end if;

  -- Acquire the shared global lock before the cluster row lock.
  perform pg_catalog.pg_advisory_xact_lock(20260709, 1);

  select admin_visibility_override, visibility_revision
  into current_override, current_revision
  from public.issue_clusters
  where id = p_cluster_id
  for update;

  if not found then
    raise exception 'issue cluster not found' using errcode = 'P0002';
  end if;

  -- A stale calculation exits before any source or cluster mutation.
  if current_revision <> p_expected_revision then
    return false;
  end if;

  -- Reject a snapshot if cluster membership changed after the application read.
  if exists (
    select 1
    from pg_catalog.jsonb_to_recordset(p_signal_patches) as signal_patch(
      id uuid,
      public_status text,
      promoted_at timestamptz,
      promotion_reason text
    )
    left join public.source_signals as signal
      on signal.id = signal_patch.id
     and signal.cluster_id = p_cluster_id
    where signal.id is null
  ) or exists (
    select 1
    from public.source_signals as signal
    where signal.cluster_id = p_cluster_id
      and not exists (
        select 1
        from pg_catalog.jsonb_to_recordset(p_signal_patches) as signal_patch(
          id uuid,
          public_status text,
          promoted_at timestamptz,
          promotion_reason text
        )
        where signal_patch.id = signal.id
      )
  ) then
    return false;
  end if;

  update public.source_signals as signal
  set
    public_status = signal_patch.public_status,
    promoted_at = signal_patch.promoted_at,
    promotion_reason = signal_patch.promotion_reason
  from pg_catalog.jsonb_to_recordset(p_signal_patches) as signal_patch(
    id uuid,
    public_status text,
    promoted_at timestamptz,
    promotion_reason text
  )
  where signal.id = signal_patch.id
    and signal.cluster_id = p_cluster_id;

  update public.issue_clusters
  set
    signal_count = patch.signal_count,
    direct_report_count = patch.direct_report_count,
    verified_report_count = patch.verified_report_count,
    public_signal_count = patch.public_signal_count,
    last_signal_at = patch.last_signal_at,
    auto_public = patch.auto_public,
    -- p_cluster_patch.is_public is the automatic baseline; effective visibility
    -- is derived from the still-current override inside this transaction.
    is_public = case current_override
      when 'force_public' then true
      when 'force_hidden' then false
      else patch.is_public
    end,
    visibility_restore_auto_public = case
      when current_override is null then null
      else patch.auto_public
    end,
    visibility_restore_is_public = case
      when current_override is null then null
      else patch.is_public
    end,
    visibility_revision = visibility_revision + 1
  where id = p_cluster_id;

  return true;
end;
$$;

revoke all on function public.apply_cluster_visibility_refresh(uuid, bigint, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_cluster_visibility_refresh(uuid, bigint, jsonb, jsonb)
  to service_role;
