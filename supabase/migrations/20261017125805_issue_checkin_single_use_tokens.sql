-- Real Cloudflare Siteverify accepted one Turnstile token many times in local
-- checks on 2026-10-16. Single use therefore cannot rely on Cloudflare: each
-- verified token may save at most one check-in, from any network.
create table public.issue_checkin_tokens (
  -- SHA-256 of the verified token, never the token itself.
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  used_at timestamptz not null default clock_timestamp()
);

-- Fingerprints never leave service-role code and are never rewritten.
alter table public.issue_checkin_tokens enable row level security;
revoke all on table public.issue_checkin_tokens from public, anon, authenticated, service_role;
grant select, insert on table public.issue_checkin_tokens to service_role;

drop function public.record_issue_checkin(uuid, text, text, text, text);

-- p_token_hash defaults to null only so the deployment that is live while this
-- migration applies keeps saving check-ins. The current route always sends it.
create function public.record_issue_checkin(
  p_cluster_id uuid,
  p_patch_version text,
  p_platform text,
  p_kind text,
  p_voter_ip_hash text,
  p_token_hash text default null
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
  if p_token_hash is not null and p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid token hash' using errcode = '22023';
  end if;

  -- Every check-in serializes with an official patch refresh. The order is
  -- global -> official patch -> cluster -> network.
  perform pg_catalog.pg_advisory_xact_lock(20260709, 1);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('official_patch_notes_current', 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_cluster_id::text, 1));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_voter_ip_hash, 0));
  written_at := clock_timestamp();

  select id, is_public, admin_override, fix_claimed_at, fix_claimed_patch_version
    into cluster
    from public.issue_clusters
    where id = p_cluster_id
    for update;
  if not found or not cluster.is_public then
    return 'unknown_issue';
  end if;

  select board_no, patch_version, official_url
    into current_patch
    from public.official_patch_notes
    where is_current = true
    order by published_at desc nulls last
    limit 1
    for update;
  if not found then
    return 'current_patch_unavailable';
  end if;
  if p_patch_version is distinct from current_patch.patch_version then
    return 'stale_patch';
  end if;

  if p_kind in ('fixed_for_me', 'still_happening') then
    -- An empty durable store before its first scanner pass cannot prove that
    -- a public issue has no current official claim.
    if not exists (select 1 from public.claim_review_sync_state) then
      return 'claim_context_unavailable';
    end if;

    if cluster.admin_override
       or cluster.fix_claimed_at is null
       or cluster.fix_claimed_patch_version is distinct from current_patch.patch_version
       or not exists (
         select 1
         from public.claim_review_pairings as pairing
         join public.official_patch_claimed_fixes as fix
           on fix.board_no = current_patch.board_no
          and pairing.claim_key = public.claim_review_claim_key(current_patch.patch_version, fix.fix_text)
         where pairing.cluster_id = p_cluster_id
           and pairing.state = 'confirmed'
           and pairing.board_no = current_patch.board_no
           and pairing.patch_version = current_patch.patch_version
           and pairing.official_url = current_patch.official_url
           and pairing.claim_key = public.claim_review_claim_key(current_patch.patch_version, pairing.exact_official_text)
           and public.claim_review_normalize(pairing.exact_official_text) = public.claim_review_normalize(fix.fix_text)
       ) then
      return 'claim_required';
    end if;
  end if;

  -- The existing ledger is shared across legacy and exact-patch check-ins.
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

  -- The network lock does not cover one token sent from several networks. The
  -- global lock and this primary key do. A refused attempt leaves its token
  -- unused, so a token is spent only by the check-in it saves.
  if p_token_hash is not null then
    insert into public.issue_checkin_tokens (token_hash, used_at)
    values (p_token_hash, written_at)
    on conflict (token_hash) do nothing;
    if not found then
      return 'replayed';
    end if;
  end if;

  insert into public.issue_confirmation_attempts (created_at, voter_ip_hash)
  values (written_at, p_voter_ip_hash);

  insert into public.issue_checkins (
    cluster_id,
    patch_version,
    platform,
    kind,
    voter_ip_hash,
    created_at
  ) values (
    p_cluster_id,
    p_patch_version,
    p_platform,
    p_kind,
    p_voter_ip_hash,
    written_at
  )
  on conflict (cluster_id, patch_version, voter_ip_hash)
  do update set
    platform = excluded.platform,
    kind = excluded.kind,
    created_at = excluded.created_at;

  -- A later scanner refresh must not write a visibility decision calculated
  -- before this recorded public check-in.
  update public.issue_clusters
  set visibility_revision = visibility_revision + 1
  where id = p_cluster_id;

  return 'recorded';
end;
$$;

revoke all on function public.record_issue_checkin(uuid, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_issue_checkin(uuid, text, text, text, text, text)
  to service_role;
