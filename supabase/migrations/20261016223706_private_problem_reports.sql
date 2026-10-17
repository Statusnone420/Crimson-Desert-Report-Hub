-- Additive and local-first. No existing report/evidence/scanner tables change.
create table public.site_problem_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  type text not null check (type in ('broken_link', 'outdated_info', 'remove_content', 'other')),
  description text not null check (char_length(btrim(description)) between 1 and 2000),
  page_url text not null check (char_length(page_url) <= 2048 and page_url ~ '^https?://[^?#[:space:]]+$'),
  email text check (email is null or (char_length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  -- SHA-256 of the verified Turnstile token, never the token itself. Siteverify
  -- accepted one real token repeatedly in local checks, so the database makes
  -- each token create at most one report, from any network.
  turnstile_token_hash text not null unique check (turnstile_token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'new' check (status in ('new', 'approved', 'done', 'dismissed')),
  revision integer not null default 0 check (revision >= 0),
  private_notes jsonb not null default '[]'::jsonb check (jsonb_typeof(private_notes) = 'array'),
  check (type <> 'remove_content' or email is not null)
);
create index site_problem_reports_network_window on public.site_problem_reports (ip_hash, created_at desc);
create index site_problem_reports_inbox on public.site_problem_reports (status, created_at desc, id desc);
create index site_problem_reports_created on public.site_problem_reports (created_at desc, id desc);

alter table public.site_problem_reports enable row level security;
revoke all on public.site_problem_reports from public, anon, authenticated, service_role;
grant select, insert on public.site_problem_reports to service_role;
grant update (status, revision, updated_at, private_notes) on public.site_problem_reports to service_role;
-- No browser policies. Only authenticated application handlers use service_role.

create function public.record_site_problem_report(
  p_type text, p_description text, p_page_url text, p_email text, p_ip_hash text, p_token_hash text
) returns jsonb
language plpgsql security invoker
set search_path = ''
set lock_timeout = '3s'
as $$
declare
  v_now timestamptz;
  v_last timestamptz;
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid network hash' using errcode = '22023';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid token hash' using errcode = '22023';
  end if;
  -- Serialize this network across processes. A hash collision can only cause
  -- extra waiting; the full hash is still used for the actual admission check.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('site_problem_report:' || p_ip_hash, 0));
  v_now := pg_catalog.clock_timestamp();
  select max(created_at) into v_last from public.site_problem_reports
    where ip_hash = p_ip_hash and created_at > v_now - interval '24 hours';
  if v_last is not null then
    return jsonb_build_object('outcome', 'rate_limited', 'retry_after',
      greatest(1, ceil(extract(epoch from (v_last + interval '24 hours' - v_now)))::integer));
  end if;
  -- The network lock does not cover one token sent from several networks. The
  -- unique token hash does: a concurrent insert waits, then saves nothing.
  insert into public.site_problem_reports (created_at, updated_at, type, description, page_url, email, ip_hash, turnstile_token_hash)
    values (v_now, v_now, p_type, btrim(p_description), p_page_url, nullif(btrim(p_email), ''), p_ip_hash, p_token_hash)
    on conflict (turnstile_token_hash) do nothing;
  if not found then
    return jsonb_build_object('outcome', 'replayed');
  end if;
  return jsonb_build_object('outcome', 'created');
end;
$$;
revoke all on function public.record_site_problem_report(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.record_site_problem_report(text, text, text, text, text, text) to service_role;

-- Queue bookkeeping only. Approval never edits content, publishes a report,
-- contacts anyone, or feeds user text to the scanner/an agent automatically.
create function public.review_site_problem_report(
  p_id uuid, p_expected_revision integer, p_status text, p_note text
) returns jsonb
language plpgsql security invoker
set search_path = ''
set lock_timeout = '3s'
as $$
declare
  v_revision integer;
  v_now timestamptz;
  v_note text := nullif(btrim(p_note), '');
begin
  if p_expected_revision is null or p_expected_revision < 0
    or (p_status is not null and p_status not in ('new', 'approved', 'done', 'dismissed'))
    or char_length(v_note) > 2000 or (p_status is null and v_note is null) then
    raise exception 'invalid review' using errcode = '22023';
  end if;
  select revision into v_revision from public.site_problem_reports where id = p_id for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  if v_revision <> p_expected_revision then return jsonb_build_object('outcome', 'conflict'); end if;
  v_now := pg_catalog.clock_timestamp();
  update public.site_problem_reports set
    status = coalesce(p_status, status),
    private_notes = case when v_note is null then private_notes
      else private_notes || jsonb_build_array(jsonb_build_object('text', v_note, 'created_at', v_now)) end,
    updated_at = v_now, revision = revision + 1
    where id = p_id;
  return jsonb_build_object('outcome', 'updated', 'revision', v_revision + 1, 'updated_at', v_now);
end;
$$;
revoke all on function public.review_site_problem_report(uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.review_site_problem_report(uuid, integer, text, text) to service_role;
