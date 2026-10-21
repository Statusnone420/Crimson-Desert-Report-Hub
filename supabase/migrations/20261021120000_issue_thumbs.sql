-- Anonymous thumbs on public issues: one per network, issue and exact patch.
-- No count is shown anywhere. The board reads them only for a small ranking
-- bonus, which never publishes a topic or keeps one public.
create table public.issue_thumbs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  cluster_id uuid not null references public.issue_clusters(id) on delete cascade,
  patch_version text not null,
  direction text not null check (direction in ('up', 'down')),
  voter_ip_hash text not null,
  unique (cluster_id, patch_version, voter_ip_hash)
);

create index issue_thumbs_patch_cluster_idx
  on public.issue_thumbs (patch_version, cluster_id);

-- Individual network hashes and taps never leave service-role code.
alter table public.issue_thumbs enable row level security;
revoke all on table public.issue_thumbs from public, anon, authenticated;
grant select, insert, update, delete on table public.issue_thumbs to service_role;

-- "Happening to me" becomes a thumb up and "Not happening for me" a thumb
-- down. The rows are copied: issue_checkins keeps every original row.
insert into public.issue_thumbs (created_at, cluster_id, patch_version, direction, voter_ip_hash)
select created_at, cluster_id, patch_version, case kind when 'have_it' then 'up' else 'down' end, voter_ip_hash
from public.issue_checkins
where kind in ('have_it', 'not_happening')
on conflict (cluster_id, patch_version, voter_ip_hash) do nothing;

-- p_direction 'none' removes the network's thumb (undo).
create function public.record_issue_thumb(
  p_cluster_id uuid,
  p_patch_version text,
  p_direction text,
  p_voter_ip_hash text,
  p_token_hash text
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  written_at timestamptz;
  cluster record;
  current_patch record;
begin
  if p_direction is null or p_direction not in ('up', 'down', 'none') then
    raise exception 'invalid thumb direction' using errcode = '22023';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid token hash' using errcode = '22023';
  end if;

  -- The check-in writer's lock order: global -> official patch -> cluster -> network.
  perform pg_catalog.pg_advisory_xact_lock(20260709, 1);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('official_patch_notes_current', 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_cluster_id::text, 1));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_voter_ip_hash, 0));
  written_at := clock_timestamp();

  select id, is_public
    into cluster
    from public.issue_clusters
    where id = p_cluster_id
    for share;
  if not found or not cluster.is_public then
    return 'unknown_issue';
  end if;

  select patch_version
    into current_patch
    from public.official_patch_notes
    where is_current = true
    order by published_at desc nulls last
    limit 1
    for share;
  if not found then
    return 'current_patch_unavailable';
  end if;
  if p_patch_version is distinct from current_patch.patch_version then
    return 'stale_patch';
  end if;

  -- Thumbs share the check-ins' attempt ledger and token store, so one
  -- network has one hourly allowance and a token saves one answer of either kind.
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

  insert into public.issue_checkin_tokens (token_hash, used_at)
  values (p_token_hash, written_at)
  on conflict (token_hash) do nothing;
  if not found then
    return 'replayed';
  end if;

  insert into public.issue_confirmation_attempts (created_at, voter_ip_hash)
  values (written_at, p_voter_ip_hash);

  if p_direction = 'none' then
    delete from public.issue_thumbs
    where cluster_id = p_cluster_id
      and patch_version = p_patch_version
      and voter_ip_hash = p_voter_ip_hash;
  else
    insert into public.issue_thumbs (cluster_id, patch_version, direction, voter_ip_hash, created_at)
    values (p_cluster_id, p_patch_version, p_direction, p_voter_ip_hash, written_at)
    on conflict (cluster_id, patch_version, voter_ip_hash)
    do update set
      direction = excluded.direction,
      created_at = excluded.created_at;
  end if;

  return 'recorded';
end;
$$;

revoke all on function public.record_issue_thumb(uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_issue_thumb(uuid, text, text, text, text)
  to service_role;
