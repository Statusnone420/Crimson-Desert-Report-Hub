-- Only accepted attempts are retained; successes count too. Denied requests
-- cannot grow the ledger. Admission must precede password verification.
create table public.admin_login_attempts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null,
  address_hash text not null check (address_hash ~ '^[0-9a-f]{64}$')
);
alter table public.admin_login_attempts enable row level security;
revoke all on public.admin_login_attempts from public, anon, authenticated, service_role;
grant select, insert, delete on public.admin_login_attempts to service_role;

create function public.reserve_admin_login_attempt(p_address_hash text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
set lock_timeout = '2s'
as $$
declare
  v_now timestamptz;
  v_global_count integer;
  v_address_count integer;
  v_global_oldest timestamptz;
  v_address_oldest timestamptz;
  v_retry_at timestamptz;
begin
  if p_address_hash is null or p_address_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid login identity' using errcode = '22023';
  end if;
  -- Shared across server instances. Sample time after locking so queued
  -- requests cannot reserve against an earlier window.
  perform pg_catalog.pg_advisory_xact_lock(20261002, 1);
  v_now := pg_catalog.clock_timestamp();
  delete from public.admin_login_attempts where created_at <= v_now - interval '15 minutes';
  select count(*), min(created_at),
         count(*) filter (where address_hash = p_address_hash),
         min(created_at) filter (where address_hash = p_address_hash)
    into v_global_count, v_global_oldest, v_address_count, v_address_oldest
    from public.admin_login_attempts;
  if v_global_count >= 30 or v_address_count >= 5 then
    v_retry_at := greatest(
      case when v_global_count >= 30 then v_global_oldest + interval '15 minutes' end,
      case when v_address_count >= 5 then v_address_oldest + interval '15 minutes' end
    );
    return jsonb_build_object('allowed', false, 'retry_after',
      greatest(1, ceil(extract(epoch from (v_retry_at - v_now)))::integer));
  end if;
  insert into public.admin_login_attempts (created_at, address_hash) values (v_now, p_address_hash);
  return jsonb_build_object('allowed', true, 'retry_after', 0);
end;
$$;
revoke all on function public.reserve_admin_login_attempt(text) from public, anon, authenticated;
grant execute on function public.reserve_admin_login_attempt(text) to service_role;
