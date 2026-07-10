-- Serialize confirmation, cluster, and source-signal visibility decisions before
-- any affected row lock is taken. The previous row-trigger advisory lock could
-- invert lock order against the admin RPC and deadlock under a concurrent scan.
create or replace function public.lock_visibility_write_statement()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(20260709, 1);
  return null;
end;
$$;

revoke all on function public.lock_visibility_write_statement() from public, anon, authenticated;
grant execute on function public.lock_visibility_write_statement() to service_role;

drop trigger if exists trg_lock_cluster_visibility_write on public.issue_clusters;
create trigger trg_lock_cluster_visibility_write
before insert or update or delete
on public.issue_clusters
for each statement execute function public.lock_visibility_write_statement();

drop trigger if exists trg_lock_source_visibility_write on public.source_signals;
create trigger trg_lock_source_visibility_write
before insert or update or delete
on public.source_signals
for each statement execute function public.lock_visibility_write_statement();

create or replace function public.enforce_cluster_visibility_override()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.admin_visibility_override = 'force_hidden' then
    new.is_public := false;
  elsif new.admin_visibility_override = 'force_public' then
    new.is_public := true;
  end if;
  return new;
end;
$$;

create or replace function public.enforce_hidden_cluster_signal()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  cluster_override text;
begin
  if new.cluster_id is not null then
    select cluster.admin_visibility_override
    into cluster_override
    from public.issue_clusters as cluster
    where cluster.id = new.cluster_id
    for update;

    if cluster_override = 'force_hidden' then
      new.public_status := 'hidden';
      new.promoted_at := null;
      new.promotion_reason := 'admin_force_hidden';
    end if;
  end if;
  return new;
end;
$$;

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

  -- This must be the first application-defined lock taken by any function that
  -- writes cluster/source visibility or checks it before a confirmation write.
  perform pg_catalog.pg_advisory_xact_lock(20260709, 1);

  update public.issue_clusters
  set
    admin_visibility_override = case when p_visibility = 'auto' then null else p_visibility end,
    is_public = case
      when p_visibility = 'force_public' then true
      when p_visibility = 'force_hidden' then false
      else is_public
    end
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

create or replace function public.record_issue_confirmation(
  p_cluster_id uuid,
  p_patch_family text,
  p_patch_version text,
  p_platform text,
  p_kind text,
  p_voter_ip_hash text
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  written_at timestamptz;
begin
  -- Visibility writes and this in-transaction public check share one first lock,
  -- so a confirmation is serialized entirely before or after a hide operation.
  perform pg_catalog.pg_advisory_xact_lock(20260709, 1);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_cluster_id::text, 1));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_voter_ip_hash, 0));
  written_at := clock_timestamp();

  if not exists (
    select 1
    from public.issue_clusters
    where id = p_cluster_id
      and is_public = true
  ) then
    return 'unknown_issue';
  end if;

  delete from public.issue_confirmation_attempts
    where created_at < written_at - interval '1 hour';

  if (
    select count(*)
    from public.issue_confirmation_attempts
    where voter_ip_hash = p_voter_ip_hash
      and created_at >= written_at - interval '1 hour'
  ) >= 20 then
    return 'rate_limited';
  end if;

  insert into public.issue_confirmation_attempts (created_at, voter_ip_hash)
  values (written_at, p_voter_ip_hash);

  insert into public.issue_confirmations (
    cluster_id,
    patch_family,
    patch_version,
    platform,
    kind,
    voter_ip_hash,
    created_at
  ) values (
    p_cluster_id,
    p_patch_family,
    p_patch_version,
    p_platform,
    p_kind,
    p_voter_ip_hash,
    written_at
  )
  on conflict (cluster_id, patch_family, voter_ip_hash)
  do update set
    patch_version = excluded.patch_version,
    platform = excluded.platform,
    kind = excluded.kind,
    created_at = excluded.created_at;

  return 'recorded';
end;
$$;

revoke all on function public.set_cluster_visibility_override(uuid, text) from public, anon, authenticated;
grant execute on function public.set_cluster_visibility_override(uuid, text) to service_role;
revoke all on function public.record_issue_confirmation(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.record_issue_confirmation(uuid, text, text, text, text, text) to service_role;
