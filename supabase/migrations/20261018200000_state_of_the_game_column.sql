-- The State of the Game column: its editions, the editor's notes, the voice
-- examples and the column's own AI spending ledger. Every table is server-only,
-- like the rest of the public schema. The scanner's ledger, budget and settings
-- are separate and untouched.

create table public.editorials (
  id uuid primary key default gen_random_uuid(),
  slot_key text not null check (char_length(slot_key) between 1 and 120),
  is_test boolean not null default false,
  slug text unique check (char_length(slug) <= 120 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  status text not null check (status in ('held', 'published', 'vetoed', 'skipped')),
  title text check (char_length(title) between 1 and 200),
  dek text check (char_length(dek) <= 400),
  body_md text check (char_length(body_md) <= 20000),
  facts_box jsonb,
  fact_pack jsonb,
  check_report jsonb,
  relevance_score integer,
  writer_model text check (char_length(writer_model) <= 80),
  writer_effort text check (writer_effort in ('low', 'medium', 'high')),
  skip_reason text check (skip_reason in (
    'paused', 'below_threshold', 'min_gap', 'budget', 'prompt_too_large', 'provider_unavailable',
    'model_not_allowed', 'writer_failed', 'check_failed', 'person_named', 'too_short',
    'missing_required_section', 'slop_check_failed', 'no_time', 'too_long'
  )),
  hold_hours integer check (hold_hours between 0 and 336),
  created_at timestamptz not null default now(),
  publish_at timestamptz,
  published_at timestamptz,
  vetoed_at timestamptz,
  updated_at timestamptz not null default now(),
  author text not null default 'Statusnone' check (author = 'Statusnone'),
  constraint editorials_skip_reason check ((status = 'skipped') = (skip_reason is not null)),
  constraint editorials_written check (status = 'skipped' or (slug is not null and title is not null and body_md is not null)),
  constraint editorials_vetoed check ((status = 'vetoed') = (vetoed_at is not null)),
  constraint editorials_skipped_unscheduled check (status <> 'skipped' or publish_at is null),
  constraint editorials_tests_private check (not is_test or (status <> 'published' and publish_at is null))
);

-- One real edition per slot, so concurrent wakes cannot both write one.
create unique index editorials_slot_key_unique on public.editorials (slot_key) where not is_test;
create index editorials_visible on public.editorials (publish_at desc)
  where not is_test and vetoed_at is null and status in ('held', 'published');
create index editorials_created on public.editorials (created_at desc);

create table public.style_notes (
  id uuid primary key default gen_random_uuid(),
  editorial_id uuid references public.editorials (id) on delete set null,
  rating text check (rating in ('up', 'down')),
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  constraint style_notes_not_empty check (rating is not null or char_length(btrim(coalesce(note, ''))) > 0)
);
create index style_notes_created on public.style_notes (created_at desc);
create index style_notes_editorial on public.style_notes (editorial_id);

create table public.voice_examples (
  id uuid primary key default gen_random_uuid(),
  body text not null check (char_length(body) <= 1500 and char_length(btrim(body)) >= 1),
  label text check (char_length(label) <= 80),
  position integer not null default 0 check (position between 0 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index voice_examples_position on public.voice_examples (position, created_at);

-- At most five examples. The lock makes two concurrent inserts count in turn.
create function public.voice_examples_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(pg_catalog.hashtextextended('voice_examples_limit', 0));
  if (select count(*) from public.voice_examples) >= 5 then
    raise exception 'voice_examples_limit' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger voice_examples_limit
  before insert on public.voice_examples
  for each row execute function public.voice_examples_limit();

-- The column's own ledger. A row is a reservation until it is settled; an
-- unsettled reservation keeps counting against the month at its reserved cost.
create table public.editorial_ai_spend (
  id uuid primary key,
  month text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  operation text not null check (operation in ('writer', 'checker', 'test_writer', 'test_checker')),
  provider text not null default 'anthropic' check (provider in ('anthropic', 'openrouter')),
  model text not null check (char_length(model) between 1 and 80),
  input_tokens integer check (input_tokens >= 0),
  cache_write_tokens integer check (cache_write_tokens >= 0),
  cache_read_tokens integer check (cache_read_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  reserved_usd numeric(14, 8) not null check (reserved_usd >= 0),
  settled_usd numeric(14, 8) check (settled_usd >= 0),
  cost_state text not null default 'reserved' check (cost_state in ('reserved', 'settled', 'estimated')),
  created_at timestamptz not null default now(),
  constraint editorial_ai_spend_settlement check ((cost_state = 'reserved') = (settled_usd is null))
);
create index editorial_ai_spend_month on public.editorial_ai_spend (month);
create index editorial_ai_spend_tests on public.editorial_ai_spend (created_at) where operation = 'test_writer';

-- Reserve the worst-case cost of one call. Blocked reservations write nothing.
-- The monthly cap never exceeds $50, whatever the caller passes.
create function public.editorial_ai_reserve(
  p_id uuid,
  p_operation text,
  p_provider text,
  p_model text,
  p_reserved_usd numeric,
  p_request_cap_usd numeric,
  p_monthly_cap_usd numeric,
  p_test_daily_cap integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
set lock_timeout = '4s'
set statement_timeout = '8s'
as $$
declare
  v_month text := to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM');
  v_reserve numeric;
  v_spent numeric;
  v_tests integer;
begin
  if p_id is null or p_operation is null or p_provider is null or p_model is null
    or p_reserved_usd is null or p_request_cap_usd is null or p_monthly_cap_usd is null or p_test_daily_cap is null
    or p_reserved_usd < 0 or p_request_cap_usd < 0 or p_monthly_cap_usd < 0 or p_test_daily_cap < 0
    or 'NaN'::numeric in (p_reserved_usd, p_request_cap_usd, p_monthly_cap_usd)
    or 'Infinity'::numeric in (p_reserved_usd, p_request_cap_usd, p_monthly_cap_usd) then
    raise exception 'editorial_invalid_reservation' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(pg_catalog.hashtextextended('editorial_ai_spend', 0));
  v_reserve := ceil(p_reserved_usd * 100000000) / 100000000;
  select coalesce(sum(coalesce(settled_usd, reserved_usd)), 0) into v_spent
    from public.editorial_ai_spend where month = v_month;
  if v_reserve > p_request_cap_usd then
    return jsonb_build_object('status', 'blocked', 'reason', 'request_cap', 'spentUsd', v_spent);
  end if;
  if v_spent + v_reserve > least(p_monthly_cap_usd, 50) then
    return jsonb_build_object('status', 'blocked', 'reason', 'monthly_cap', 'spentUsd', v_spent);
  end if;
  if p_operation = 'test_writer' then
    select count(*) into v_tests from public.editorial_ai_spend
      where operation = 'test_writer'
        and created_at >= (date_trunc('day', clock_timestamp() at time zone 'UTC') at time zone 'UTC');
    if v_tests >= p_test_daily_cap then
      return jsonb_build_object('status', 'blocked', 'reason', 'test_daily_cap', 'spentUsd', v_spent);
    end if;
  end if;
  insert into public.editorial_ai_spend (id, month, operation, provider, model, reserved_usd)
    values (p_id, v_month, p_operation, p_provider, p_model, v_reserve);
  return jsonb_build_object('status', 'reserved', 'reservedUsd', v_reserve, 'spentUsd', v_spent);
end;
$$;

-- Settle a reservation once. A second settlement of the same row changes nothing.
create function public.editorial_ai_settle(
  p_id uuid,
  p_state text,
  p_settled_usd numeric,
  p_input_tokens integer,
  p_cache_write_tokens integer,
  p_cache_read_tokens integer,
  p_output_tokens integer
)
returns text
language plpgsql
security invoker
set search_path = ''
set lock_timeout = '4s'
set statement_timeout = '8s'
as $$
begin
  if p_id is null or p_state is null or p_state not in ('settled', 'estimated')
    or p_settled_usd is null or p_settled_usd < 0 or p_settled_usd in ('NaN'::numeric, 'Infinity'::numeric) then
    raise exception 'editorial_invalid_settlement' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(pg_catalog.hashtextextended('editorial_ai_spend', 0));
  update public.editorial_ai_spend
    set settled_usd = ceil(p_settled_usd * 100000000) / 100000000,
        cost_state = p_state,
        input_tokens = p_input_tokens,
        cache_write_tokens = p_cache_write_tokens,
        cache_read_tokens = p_cache_read_tokens,
        output_tokens = p_output_tokens
    where id = p_id and cost_state = 'reserved';
  if found then return 'settled'; end if;
  if exists (select 1 from public.editorial_ai_spend where id = p_id) then return 'already_settled'; end if;
  return 'missing';
end;
$$;

-- The column settings live under the automation_settings key 'column'. Writers
-- merge only the top-level keys they own, so a cadence save never overwrites
-- the approve-first count or a one-shot model override written meanwhile.
create function public.editorial_settings_merge(p_patch jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_value jsonb;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'editorial_invalid_settings' using errcode = '22023';
  end if;
  insert into public.automation_settings as s (key, value, updated_at)
    values ('column', p_patch, now())
    on conflict (key) do update set value = s.value || excluded.value, updated_at = now()
    returning value into v_value;
  return v_value;
end;
$$;

-- Clear the one-shot writer override only if it still names the model that was used.
create function public.editorial_settings_clear_next_model(p_model text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.automation_settings
    set value = jsonb_set(value, '{nextEditionModel}', 'null'::jsonb), updated_at = now()
    where key = 'column' and value->>'nextEditionModel' = p_model;
  return found;
end;
$$;

-- Approve an edition waiting for approval: publish it now and count one
-- approve-first edition down. Anything else changes nothing.
create function public.editorial_approve(p_id uuid)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.editorials
    set status = 'published', publish_at = now(), published_at = now(), updated_at = now()
    where id = p_id and status = 'held' and not is_test and publish_at is null and vetoed_at is null;
  if not found then return 'not_pending'; end if;
  insert into public.automation_settings as s (key, value, updated_at)
    values ('column', '{"approveFirstRemaining": 2}'::jsonb, now())
    on conflict (key) do update set value = jsonb_set(
      s.value,
      '{approveFirstRemaining}',
      to_jsonb(greatest(
        case when jsonb_typeof(s.value->'approveFirstRemaining') = 'number'
          then floor((s.value->>'approveFirstRemaining')::numeric)::integer else 3 end - 1,
        0
      ))
    ), updated_at = now();
  return 'approved';
end;
$$;

insert into public.automation_settings (key, value)
values ('column', '{
  "paused": false,
  "mode": "weekly",
  "days": ["mon"],
  "hourUtc": 14,
  "holdHours": 24,
  "relevance": "normal",
  "minGapHours": 20,
  "defaultWriterModel": null,
  "nextEditionModel": null,
  "monthlyCapUsd": null,
  "provider": "anthropic",
  "approveFirstRemaining": 3,
  "bursts": [{
    "id": "expansion-launch",
    "label": "Expansion launch",
    "enabled": false,
    "startDate": "2026-10-29",
    "endDate": "2026-11-04",
    "cadence": "daily",
    "hourUtc": 14,
    "model": "claude-opus-5-5",
    "holdHours": 8,
    "relevance": "always"
  }]
}'::jsonb)
on conflict (key) do nothing;

alter table public.editorials enable row level security;
alter table public.style_notes enable row level security;
alter table public.voice_examples enable row level security;
alter table public.editorial_ai_spend enable row level security;

revoke all on public.editorials, public.style_notes, public.voice_examples, public.editorial_ai_spend
  from public, anon, authenticated, service_role;
grant select, insert, update on public.editorials to service_role;
grant select, insert, delete on public.style_notes to service_role;
grant select, insert, update, delete on public.voice_examples to service_role;
grant select, insert, update on public.editorial_ai_spend to service_role;

do $$
declare
  column_table text;
begin
  foreach column_table in array array['editorials', 'style_notes', 'voice_examples', 'editorial_ai_spend']
  loop
    execute format('drop policy if exists deny_all_public_access on public.%I', column_table);
    execute format(
      'create policy deny_all_public_access on public.%I for all to anon, authenticated using (false) with check (false)',
      column_table
    );
  end loop;
end $$;

revoke all on function public.editorial_ai_reserve(uuid, text, text, text, numeric, numeric, numeric, integer),
  public.editorial_ai_settle(uuid, text, numeric, integer, integer, integer, integer),
  public.editorial_settings_merge(jsonb),
  public.editorial_settings_clear_next_model(text),
  public.editorial_approve(uuid)
  from public, anon, authenticated;
grant execute on function public.editorial_ai_reserve(uuid, text, text, text, numeric, numeric, numeric, integer),
  public.editorial_ai_settle(uuid, text, numeric, integer, integer, integer, integer),
  public.editorial_settings_merge(jsonb),
  public.editorial_settings_clear_next_model(text),
  public.editorial_approve(uuid)
  to service_role;
