-- Preserve the engine-owned cluster visibility while an admin override is
-- active. Clearing an override restores that baseline before the application
-- re-runs the shared promotion engine for current reports and source signals.
alter table public.issue_clusters
  add column visibility_restore_is_public boolean;

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

  -- Keep this as the first application-defined lock so the snapshot and
  -- effective visibility change share the existing write-order boundary.
  perform pg_catalog.pg_advisory_xact_lock(20260709, 1);

  update public.issue_clusters
  set
    visibility_restore_is_public = case
      when p_visibility = 'auto' then null
      when admin_visibility_override is null then is_public
      else coalesce(visibility_restore_is_public, is_public)
    end,
    admin_visibility_override = case when p_visibility = 'auto' then null else p_visibility end,
    is_public = case
      when p_visibility = 'force_public' then true
      when p_visibility = 'force_hidden' then false
      else coalesce(visibility_restore_is_public, is_public)
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

revoke all on function public.set_cluster_visibility_override(uuid, text) from public, anon, authenticated;
grant execute on function public.set_cluster_visibility_override(uuid, text) to service_role;
