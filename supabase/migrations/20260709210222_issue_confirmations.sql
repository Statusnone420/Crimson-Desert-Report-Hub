-- One-tap anonymous confirmations. One voice per network per issue per patch family;
-- an upsert replaces the voter's stance. Aggregates only ever leave the server.
alter table issue_clusters
  add column fix_claimed_patch_version text;

-- Existing clocks have no exact-version provenance, so leave them null. The
-- lifecycle pass may establish a fresh clock only from a current exact claim.

create table issue_confirmations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  cluster_id uuid not null references issue_clusters(id) on delete cascade,
  patch_family text not null,
  patch_version text not null,
  platform text not null check (platform in ('pc_steam','ps5','ps5_pro','xbox_series_x','xbox_series_s','other')),
  kind text not null check (kind in ('have_it','still_happening','fixed_for_me')),
  voter_ip_hash text not null
);

create unique index idx_confirmations_one_voice
  on issue_confirmations (cluster_id, patch_family, voter_ip_hash);
create index idx_confirmations_patch_cluster on issue_confirmations (patch_family, cluster_id);
create index idx_confirmations_cluster on issue_confirmations (cluster_id);
create index idx_confirmations_voter_time on issue_confirmations (voter_ip_hash, created_at desc);

-- Deny-all RLS like every other table; service role only.
alter table issue_confirmations enable row level security;

-- Event-pruned write ledger. The RPC deletes rows older than one hour on a
-- later valid write; quiet databases can retain the final stale rows longer.
create table issue_confirmation_attempts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  voter_ip_hash text not null
);

create index idx_confirmation_attempts_voter_time
  on issue_confirmation_attempts (voter_ip_hash, created_at desc);
create index idx_confirmation_attempts_created_at
  on issue_confirmation_attempts (created_at);

alter table issue_confirmation_attempts enable row level security;

create or replace function record_issue_confirmation(
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

revoke all on table issue_confirmations from public, anon, authenticated;
revoke all on table issue_confirmation_attempts from public, anon, authenticated;
grant select, insert, update, delete on table issue_confirmations to service_role;
grant select, insert, update, delete on table issue_confirmation_attempts to service_role;
revoke all on function record_issue_confirmation(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function record_issue_confirmation(uuid, text, text, text, text, text) to service_role;
