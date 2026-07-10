-- Visibility overrides are owner safety controls, not eventual hints. Keep the
-- effective cluster/signal visibility invariant even during concurrent scans.
create or replace function public.enforce_cluster_visibility_override()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.id::text, 1));
  if new.admin_visibility_override = 'force_hidden' then
    new.is_public := false;
  elsif new.admin_visibility_override = 'force_public' then
    new.is_public := true;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_cluster_visibility_override on public.issue_clusters;
create trigger trg_enforce_cluster_visibility_override
before insert or update
on public.issue_clusters
for each row execute function public.enforce_cluster_visibility_override();

create or replace function public.enforce_hidden_cluster_signal()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.cluster_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.cluster_id::text, 1));
    if exists (
      select 1
      from public.issue_clusters
      where id = new.cluster_id
        and admin_visibility_override = 'force_hidden'
    ) then
      new.public_status := 'hidden';
      new.promoted_at := null;
      new.promotion_reason := 'admin_force_hidden';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_hidden_cluster_signal on public.source_signals;
create trigger trg_enforce_hidden_cluster_signal
before insert or update
on public.source_signals
for each row execute function public.enforce_hidden_cluster_signal();

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

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_cluster_id::text, 1));

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

revoke all on function public.enforce_cluster_visibility_override() from public, anon, authenticated;
revoke all on function public.enforce_hidden_cluster_signal() from public, anon, authenticated;
revoke all on function public.set_cluster_visibility_override(uuid, text) from public, anon, authenticated;
grant execute on function public.set_cluster_visibility_override(uuid, text) to service_role;

-- Establish the invariant for overrides written before these guards existed.
update public.issue_clusters
set is_public = case admin_visibility_override
  when 'force_public' then true
  when 'force_hidden' then false
  else is_public
end
where admin_visibility_override in ('force_public', 'force_hidden');

update public.source_signals as signal
set
  public_status = 'hidden',
  promoted_at = null,
  promotion_reason = 'admin_force_hidden'
from public.issue_clusters as cluster
where signal.cluster_id = cluster.id
  and cluster.admin_visibility_override = 'force_hidden';
