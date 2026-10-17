-- Private OpenRouter configuration. An unactivated dashboard preserves scanner policy.
create table public.ai_settings_state (
  id boolean primary key default true check (id),
  revision integer not null default 0 check (revision >= 0),
  configuration jsonb not null check (jsonb_typeof(configuration) = 'object')
);
insert into public.ai_settings_state(configuration) values (
  '{"active":null,"previous":null,"backup":null,"policy":{"monthlyUsd":1,"requestUsd":0.01,"recovery":"next_scan"}}'
);

create table public.ai_connections (
  provider text primary key check (provider = 'openrouter'),
  ciphertext text not null check (octet_length(ciphertext) between 1 and 16384),
  version integer not null check (version > 0),
  updated_at timestamptz not null default clock_timestamp()
);
create table public.ai_test_operations (
  id uuid primary key,
  state text not null default 'reserved' check (state in ('reserved', 'verified', 'unknown', 'not_sent')),
  reserved_usd numeric(18,9) not null check (reserved_usd >= 0 and reserved_usd <= 0.01),
  settled_usd numeric(18,9) check (settled_usd >= 0 and settled_usd::text not in ('NaN', 'Infinity', '-Infinity')),
  budget_month date not null,
  created_at timestamptz not null default clock_timestamp(),
  check ((state in ('reserved', 'unknown') and settled_usd is null)
    or (state = 'verified' and settled_usd is not null)
    or (state = 'not_sent' and settled_usd = 0))
);
create index ai_test_operations_month on public.ai_test_operations(budget_month);
create table public.ai_model_tests (
  id uuid primary key references public.ai_test_operations(id),
  profile jsonb not null check (jsonb_typeof(profile) = 'object' and profile->>'provider' = 'openrouter'
    and octet_length(profile::text) <= 16384),
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  result jsonb not null check (jsonb_typeof(result) = 'object' and octet_length(result::text) <= 32768),
  created_at timestamptz not null default clock_timestamp()
);
create index ai_model_tests_created on public.ai_model_tests(created_at desc);
create table public.ai_settings_events (
  id uuid primary key default gen_random_uuid(),
  action text not null check (length(action) between 1 and 80),
  detail text not null check (length(detail) <= 500),
  created_at timestamptz not null default clock_timestamp()
);
create index ai_settings_events_created on public.ai_settings_events(created_at desc);

alter table public.ai_settings_state enable row level security;
alter table public.ai_connections enable row level security;
alter table public.ai_test_operations enable row level security;
alter table public.ai_model_tests enable row level security;
alter table public.ai_settings_events enable row level security;
revoke all on public.ai_settings_state, public.ai_connections, public.ai_test_operations,
  public.ai_model_tests, public.ai_settings_events from public, anon, authenticated, service_role;
grant select, update on public.ai_settings_state to service_role;
grant select, insert, update on public.ai_connections, public.ai_test_operations to service_role;
grant select, insert on public.ai_model_tests, public.ai_settings_events to service_role;

create function public.ai_settings_save(p_revision integer, p_policy jsonb)
returns jsonb language plpgsql security invoker set search_path = ''
set lock_timeout = '4s' set statement_timeout = '8s' as $$
declare v_settings public.ai_settings_state; v_monthly numeric; v_request numeric;
begin
  perform pg_advisory_xact_lock(661309132);
  select * into strict v_settings from public.ai_settings_state where id for update;
  if p_revision is distinct from v_settings.revision then
    raise exception 'ai_settings_revision_conflict' using errcode = '40001';
  end if;
  if p_policy is null or jsonb_typeof(p_policy) <> 'object'
    or jsonb_typeof(p_policy->'monthlyUsd') is distinct from 'number'
    or jsonb_typeof(p_policy->'requestUsd') is distinct from 'number'
    or p_policy->>'recovery' is null or p_policy->>'recovery' not in ('next_scan', 'backup')
    or p_policy - array['monthlyUsd', 'requestUsd', 'recovery'] <> '{}'::jsonb then
    raise exception 'ai_invalid_policy' using errcode = '22023';
  end if;
  v_monthly := (p_policy->>'monthlyUsd')::numeric;
  v_request := (p_policy->>'requestUsd')::numeric;
  if v_monthly < 0 or v_monthly > 1000 or v_request <= 0 or v_request > 1
    or (p_policy->>'recovery' = 'backup' and coalesce(v_settings.configuration->'backup', 'null') = 'null') then
    raise exception 'ai_invalid_policy' using errcode = '22023';
  end if;
  update public.ai_settings_state set configuration = jsonb_set(configuration, '{policy}', p_policy),
    revision = revision + 1 where id returning * into v_settings;
  insert into public.ai_settings_events(action, detail) values ('policy_saved', 'AI spending and recovery policy updated.');
  return v_settings.configuration || jsonb_build_object('revision', v_settings.revision);
end;
$$;

create function public.ai_connection_save(p_ciphertext text, p_expected_version integer)
returns jsonb language plpgsql security invoker set search_path = ''
set lock_timeout = '4s' set statement_timeout = '8s' as $$
declare v_version integer;
begin
  perform pg_advisory_xact_lock(661309132);
  select version into v_version from public.ai_connections where provider = 'openrouter' for update;
  v_version := coalesce(v_version, 0);
  if p_expected_version is distinct from v_version then
    raise exception 'ai_connection_version_conflict' using errcode = '40001';
  end if;
  if p_ciphertext is null or octet_length(p_ciphertext) not between 1 and 16384 then
    raise exception 'ai_invalid_connection' using errcode = '22023';
  end if;
  insert into public.ai_connections(provider, ciphertext, version) values ('openrouter', p_ciphertext, v_version + 1)
    on conflict(provider) do update set ciphertext = excluded.ciphertext,
      version = excluded.version, updated_at = clock_timestamp();
  insert into public.ai_settings_events(action, detail) values ('connection_saved', 'OpenRouter credential updated. Retest before activation.');
  return jsonb_build_object('version', v_version + 1);
end;
$$;

create function public.ai_settings_activate(p_revision integer, p_test_id uuid, p_role text)
returns jsonb language plpgsql security invoker set search_path = ''
set lock_timeout = '4s' set statement_timeout = '8s' as $$
declare v_settings public.ai_settings_state; v_test public.ai_model_tests; v_profile jsonb; v_version integer;
begin
  perform pg_advisory_xact_lock(661309132);
  select * into strict v_settings from public.ai_settings_state where id for update;
  if p_revision is distinct from v_settings.revision then
    raise exception 'ai_settings_revision_conflict' using errcode = '40001';
  end if;
  if p_role is null or p_role not in ('primary', 'backup', 'rollback') then
    raise exception 'ai_invalid_activation' using errcode = '22023';
  end if;
  if p_role = 'rollback' then
    v_profile := coalesce(v_settings.configuration->'previous', 'null');
    if v_profile = 'null' and coalesce(v_settings.configuration->'active', 'null') = 'null' then
      raise exception 'ai_test_required' using errcode = '55000';
    end if;
  else
    select * into v_test from public.ai_model_tests where id = p_test_id;
    if not found or v_test.created_at < clock_timestamp() - interval '24 hours'
      or v_test.created_at > clock_timestamp() or v_test.result->'passed' is distinct from 'true'::jsonb
      or not exists(select 1 from public.ai_test_operations where id = p_test_id and state = 'verified') then
      raise exception 'ai_test_required' using errcode = '55000';
    end if;
    v_profile := v_test.profile;
  end if;
  -- The first activation replaces the legacy configuration, represented by null.
  -- Restoring that configuration has no saved credential generation to check.
  if not (p_role = 'rollback' and v_profile = 'null') then
    if v_profile is null or jsonb_typeof(v_profile) <> 'object'
    or v_profile->>'provider' is distinct from 'openrouter'
    or coalesce(v_profile->>'modelId', '') = ''
    or jsonb_typeof(v_profile->'connectionVersion') is distinct from 'number' then
      raise exception 'ai_test_required' using errcode = '55000';
    end if;
    select version into v_version from public.ai_connections where provider = 'openrouter';
    if (v_profile->>'connectionVersion')::numeric is distinct from coalesce(v_version, 0)::numeric then
      raise exception 'ai_connection_changed' using errcode = '55000';
    end if;
  end if;
  if p_role = 'backup' then
    v_settings.configuration := jsonb_set(v_settings.configuration, '{backup}', v_profile);
  else
    v_settings.configuration := jsonb_set(jsonb_set(v_settings.configuration, '{previous}',
      coalesce(v_settings.configuration->'active', 'null')), '{active}', v_profile);
  end if;
  update public.ai_settings_state set configuration = v_settings.configuration,
    revision = revision + 1 where id returning * into v_settings;
  insert into public.ai_settings_events(action, detail) values (
    case p_role when 'backup' then 'backup_activated' when 'rollback' then 'primary_rolled_back' else 'primary_activated' end,
    case when p_role = 'backup' then 'Tested backup activated.'
      when p_role = 'rollback' and v_profile = 'null' then 'Legacy scanner configuration restored.'
      when p_role = 'rollback' then 'Previous primary restored.' else 'Tested primary activated.' end);
  return v_settings.configuration || jsonb_build_object('revision', v_settings.revision);
end;
$$;

create function public.ai_test_reserve(p_id uuid, p_usd numeric)
returns jsonb language plpgsql security invoker set search_path = ''
set lock_timeout = '4s' set statement_timeout = '8s' as $$
declare v_operation public.ai_test_operations; v_configuration jsonb; v_policy jsonb;
  v_summary jsonb; v_reserve numeric; v_monthly numeric;
begin
  perform pg_advisory_xact_lock(661309132);
  if p_id is null or p_usd is null or p_usd < 0 or p_usd::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'ai_invalid_reserve' using errcode = '22023';
  end if;
  v_reserve := ceil(p_usd * 1000000000) / 1000000000;
  select * into v_operation from public.ai_test_operations where id = p_id;
  if found then
    if v_operation.reserved_usd <> v_reserve then
      raise exception 'ai_reservation_conflict' using errcode = '22023';
    end if;
    return jsonb_build_object('status', 'reserved', 'state', v_operation.state,
      'reservedUsd', v_operation.reserved_usd, 'firstAcknowledgement', false);
  end if;
  select configuration into strict v_configuration from public.ai_settings_state where id;
  v_monthly := (v_configuration->'policy'->>'monthlyUsd')::numeric;
  if coalesce(v_configuration->'active', 'null') = 'null' then
    select value into v_policy from public.automation_settings where key = 'scanner';
    v_monthly := least(v_monthly, coalesce((v_policy->>'monthlyLlmUsdCap')::numeric, 0.5), 1);
  end if;
  v_summary := public.scanner_budget_summary();
  if v_reserve > least(0.01, (v_configuration->'policy'->>'requestUsd')::numeric)
    or (v_summary->>'llmCostUsd')::numeric + v_reserve > v_monthly
    or (v_summary->>'openRouterCircuitOpen')::boolean
    or (v_summary->>'paidSpendingAnomaly')::boolean
    or (v_summary->>'reconciliationRequired')::boolean then
    raise exception 'ai_spending_blocked' using errcode = '55000';
  end if;
  insert into public.ai_test_operations(id, reserved_usd, budget_month) values
    (p_id, v_reserve, date_trunc('month', clock_timestamp() at time zone 'UTC')::date);
  return jsonb_build_object('status', 'reserved', 'state', 'reserved',
    'reservedUsd', v_reserve, 'firstAcknowledgement', true);
end;
$$;

create function public.ai_test_settle(p_id uuid, p_state text, p_usd numeric)
returns jsonb language plpgsql security invoker set search_path = ''
set lock_timeout = '4s' set statement_timeout = '8s' as $$
declare v_operation public.ai_test_operations; v_settled numeric;
begin
  perform pg_advisory_xact_lock(661309132);
  if p_state is null or p_state not in ('verified', 'unknown', 'not_sent')
    or (p_state = 'unknown' and p_usd is not null)
    or (p_state <> 'unknown' and p_usd is null)
    or p_usd < 0 or p_usd::text in ('NaN', 'Infinity', '-Infinity')
    or (p_state = 'not_sent' and p_usd <> 0) then
    raise exception 'ai_invalid_settlement' using errcode = '22023';
  end if;
  v_settled := ceil(p_usd * 1000000000) / 1000000000;
  select * into v_operation from public.ai_test_operations where id = p_id for update;
  if not found then raise exception 'ai_operation_missing' using errcode = '22023'; end if;
  if v_operation.state <> 'reserved' then
    if v_operation.state <> p_state or v_operation.settled_usd is distinct from v_settled then
      raise exception 'ai_settlement_conflict' using errcode = '22023';
    end if;
  else
    update public.ai_test_operations set state = p_state, settled_usd = v_settled where id = p_id;
  end if;
  return jsonb_build_object('status', 'settled', 'state', p_state,
    'anomalous', coalesce(v_settled > v_operation.reserved_usd, false));
end;
$$;
create or replace function public.scanner_budget_summary(p_now timestamptz default clock_timestamp())
returns jsonb language sql security invoker set search_path = '' as $$
  with period as (
    select date_trunc('month', p_now at time zone 'UTC')::date as month
  ), legacy as (
    select coalesce(sum(greatest(estimated_cost_usd - search_queries_used * 0.008, 0)), 0) as llm,
      coalesce(sum(search_queries_used), 0) as credits
    from public.automation_runs, period
    where accounting_version = 0 and started_at >= period.month::timestamp at time zone 'UTC'
  ), paid as (
    select coalesce(sum(case when state in ('reserved', 'unknown') then reserved_llm_usd
      else coalesce(settled_llm_usd, reserved_llm_usd) end), 0) as llm,
      coalesce(sum(case when state in ('reserved', 'unknown') then reserved_tavily_credits
      else coalesce(settled_tavily_credits, reserved_tavily_credits) end), 0) as credits,
      coalesce(sum(case when state in ('reserved', 'unknown') then reserved_llm_usd else 0 end), 0) as uncertain,
      coalesce(sum(case when state = 'verified' then settled_llm_usd else 0 end), 0) as confirmed,
      coalesce(sum(case when state = 'estimated' then settled_llm_usd else 0 end), 0) as estimated,
      coalesce(bool_or(coalesce(settled_llm_usd, 0) > reserved_llm_usd
        or coalesce(settled_tavily_credits, 0) > reserved_tavily_credits), false) as anomaly
    from public.automation_paid_operations, period
    where budget_month = period.month
      or (budget_month < period.month and state in ('reserved', 'unknown'))
  ), tests as (
    select coalesce(sum(case when state in ('reserved', 'unknown') then reserved_usd else settled_usd end), 0) as llm,
      coalesce(sum(case when state in ('reserved', 'unknown') then reserved_usd else 0 end), 0) as uncertain,
      coalesce(sum(case when state = 'verified' then settled_usd else 0 end), 0) as confirmed,
      coalesce(bool_or(settled_usd > reserved_usd), false) as anomaly
    from public.ai_test_operations, period
    where budget_month = period.month or (budget_month < period.month and state in ('reserved', 'unknown'))
  ), debt as (
    select coalesce(sum(case when d.budget_month < period.month then d.llm_ceiling_usd
        when d.budget_month = period.month then greatest(d.llm_ceiling_usd
          - greatest(r.estimated_cost_usd - r.search_queries_used * 0.008, 0), 0)
        else 0 end), 0) as llm,
      coalesce(sum(case when d.budget_month < period.month then d.tavily_ceiling
        when d.budget_month = period.month then greatest(d.tavily_ceiling - r.search_queries_used, 0)
        else 0 end), 0) as credits,
      coalesce(bool_or(d.llm_ceiling_usd is null or d.tavily_ceiling is null), false) as blocked
    from public.scanner_legacy_debt d join public.automation_runs r on r.id = d.run_id,
      period where not d.resolved
  ), circuit as (
    select coalesce(bool_or(started_at >= period.month::timestamp at time zone 'UTC'
      and (skips ? 'openrouter_unexpected_charge' or skips ? 'openrouter_budget_exceeded')), false)
      or count(*) filter (where started_at >= p_now - interval '24 hours'
        and skips ? 'openrouter_cost_unverified'
        and ((r.accounting_version = 0 and not exists (
          select 1 from public.scanner_legacy_debt d where d.run_id = r.id and d.resolved))
          or (r.accounting_version = 1 and exists (
            select 1 from public.automation_paid_operations o where o.run_id = r.id
              and o.kind in ('extraction', 'claim_mapping') and o.state in ('reserved', 'unknown'))))) >= 3 as open
    from public.automation_runs r, period
    where started_at >= least(period.month::timestamp at time zone 'UTC', p_now - interval '24 hours')
  )
  select jsonb_build_object('llmCostUsd', legacy.llm + paid.llm + debt.llm + tests.llm,
    'tavilyCredits', legacy.credits + paid.credits + debt.credits,
    'estimatedCostUsd', legacy.llm + paid.llm + debt.llm + tests.llm
      + (legacy.credits + paid.credits + debt.credits) * 0.008,
    'openRouterCircuitOpen', circuit.open or paid.anomaly or debt.blocked or tests.anomaly,
    'paidSpendingAnomaly', paid.anomaly or tests.anomaly,
    'reconciliationRequired', debt.blocked,
    'uncertainUsd', paid.uncertain + debt.llm + tests.uncertain,
    'confirmedUsd', paid.confirmed + tests.confirmed,
    'estimatedUsd', legacy.llm + paid.estimated,
    'accountingVersion', 1)
  from legacy, paid, debt, circuit, tests;
$$;


create or replace function public.scanner_admit_run(p_run_id uuid, p_token uuid, p_mode text,
  p_work_deadline timestamptz, p_lease_deadline timestamptz, p_budget jsonb,
  p_progress jsonb, p_patch_burst boolean default false)
returns jsonb language plpgsql security invoker set search_path = ''
set lock_timeout = '4s' set statement_timeout = '8s' as $$
declare v_existing public.automation_runs; v_policy jsonb; v_now timestamptz := clock_timestamp();
  v_ai_configuration jsonb; v_monthly_ceiling numeric := 1;
begin
  perform pg_advisory_xact_lock(661309132);
  select * into v_existing from public.automation_runs where id = p_run_id for update;
  if found then
    if v_existing.execution_token = p_token then
      return jsonb_build_object('status', case when v_existing.status = 'running' then 'admitted' else 'closed' end);
    end if;
    raise exception 'scanner_admission_conflict' using errcode = '22023';
  end if;
  if p_run_id is null or p_token is null or p_mode is null or p_work_deadline is null or p_lease_deadline is null
    or p_mode not in ('scheduled', 'manual', 'dry_run') or p_work_deadline <= v_now
    or p_lease_deadline <= p_work_deadline or p_lease_deadline > v_now + interval '5 minutes'
    or jsonb_typeof(p_budget) <> 'object' or jsonb_typeof(p_progress) <> 'object' then
    raise exception 'scanner_invalid_admission' using errcode = '22023';
  end if;
  update public.automation_runs set status = 'failed', finished_at = v_now,
    errors = errors || '["execution_lease_expired"]'::jsonb
    where accounting_version = 1 and status = 'running' and lease_expires_at <= v_now;
  if exists(select 1 from public.automation_runs where status = 'running') then
    return jsonb_build_object('status', 'already_running');
  end if;
  select value into v_policy from public.automation_settings where key = 'scanner';
  if p_mode = 'scheduled' and coalesce((v_policy->>'paused')::boolean, false) then
    return jsonb_build_object('status', 'paused');
  end if;
  if p_mode = 'scheduled' and exists(select 1 from public.automation_runs
    where mode in ('scheduled', 'manual') and status <> 'skipped'
      and started_at between v_now - make_interval(mins => greatest(1,
        coalesce((v_policy->>'minIntervalMinutes')::integer, 60))) + interval '2 minutes' and v_now) then
    return jsonb_build_object('status', 'recent_run');
  end if;
  select configuration into v_ai_configuration from public.ai_settings_state where id;
  if coalesce(v_ai_configuration->'active', 'null') <> 'null' then
    v_monthly_ceiling := (v_ai_configuration->'policy'->>'monthlyUsd')::numeric;
  end if;
  insert into public.automation_runs(id, execution_token, accounting_version, mode,
    work_deadline_at, lease_expires_at, budget_monthly_usd, budget_remaining_before_usd,
    run_llm_cap_usd, run_tavily_cap, run_llm_calls_cap, progress, skips)
  values(p_run_id, p_token, 1, p_mode, p_work_deadline, p_lease_deadline,
    least(v_monthly_ceiling, greatest(0, (p_budget->>'monthlyLlmUsdCap')::numeric)),
    greatest(0, (p_budget->>'remainingMonthUsd')::numeric),
    least(v_monthly_ceiling, greatest(0, (p_budget->>'remainingLlmUsd')::numeric)),
    least(1000, greatest(0, (p_budget->>'maxTavilyCreditsPerRun')::integer)),
    least(100, greatest(0, (p_budget->>'maxLlmCalls')::integer)),
    p_progress, case when p_patch_burst then '["patch_burst_active"]'::jsonb else '[]'::jsonb end);
  return jsonb_build_object('status', 'admitted');
end;
$$;

create or replace function public.scanner_reserve_operation(p_run_id uuid, p_token uuid, p_operation_id uuid,
  p_kind text, p_fingerprint text, p_llm_usd numeric, p_tavily_credits integer)
returns jsonb language plpgsql security invoker set search_path = ''
set lock_timeout = '4s' set statement_timeout = '8s' as $$
declare v_run public.automation_runs; v_op public.automation_paid_operations; v_summary jsonb;
  v_policy jsonb; v_llm numeric; v_credits integer; v_calls integer; v_reserve numeric;
  v_ai_configuration jsonb; v_monthly_ceiling numeric; v_request_ceiling numeric;
begin
  perform pg_advisory_xact_lock(661309132);
  select * into v_run from public.automation_runs where id = p_run_id for update;
  if not found or v_run.execution_token is distinct from p_token then
    raise exception 'scanner_owner_mismatch' using errcode = '42501';
  end if;
  v_reserve := ceil(p_llm_usd * 1000000000) / 1000000000;
  select * into v_op from public.automation_paid_operations where id = p_operation_id;
  if found then
    if v_op.run_id <> p_run_id or v_op.kind <> p_kind or v_op.request_fingerprint <> p_fingerprint
      or v_op.reserved_llm_usd <> v_reserve or v_op.reserved_tavily_credits <> p_tavily_credits then
      raise exception 'scanner_reservation_conflict' using errcode = '22023';
    end if;
    return jsonb_build_object('status', 'reserved', 'state', v_op.state);
  end if;
  if v_run.status <> 'running' or clock_timestamp() >= v_run.work_deadline_at - interval '5 seconds' then
    raise exception 'scanner_execution_closed' using errcode = '55000';
  end if;
  if p_llm_usd is null or p_llm_usd < 0 or p_tavily_credits is null or p_tavily_credits < 0 then
    raise exception 'scanner_invalid_reserve' using errcode = '22023';
  end if;
  v_summary := public.scanner_budget_summary();
  select value into v_policy from public.automation_settings where key = 'scanner';
  select configuration into v_ai_configuration from public.ai_settings_state where id;
  if coalesce(v_ai_configuration->'active', 'null') <> 'null' then
    v_monthly_ceiling := (v_ai_configuration->'policy'->>'monthlyUsd')::numeric;
    v_request_ceiling := (v_ai_configuration->'policy'->>'requestUsd')::numeric;
  else
    v_monthly_ceiling := least(coalesce((v_policy->>'monthlyLlmUsdCap')::numeric, 0.5), 1);
  end if;
  select coalesce(sum(case when state in ('reserved', 'unknown') then reserved_llm_usd
      else coalesce(settled_llm_usd, reserved_llm_usd) end), 0),
    coalesce(sum(case when state in ('reserved', 'unknown') then reserved_tavily_credits
      else coalesce(settled_tavily_credits, reserved_tavily_credits) end), 0),
    count(*) filter (where kind in ('extraction', 'claim_mapping') and state <> 'not_sent')
    into v_llm, v_credits, v_calls from public.automation_paid_operations where run_id = p_run_id;
  if (v_summary->>'reconciliationRequired')::boolean
    or (v_summary->>'paidSpendingAnomaly')::boolean
    or ((v_summary->>'openRouterCircuitOpen')::boolean and p_llm_usd > 0)
    or (p_kind in ('extraction', 'claim_mapping') and (v_summary->>'llmCostUsd')::numeric + v_reserve > least(v_run.budget_monthly_usd,
      v_monthly_ceiling))
    or (p_kind in ('extraction', 'claim_mapping') and v_reserve > v_request_ceiling)
    or (p_kind in ('tavily_search', 'tavily_extract') and (v_summary->>'tavilyCredits')::numeric + p_tavily_credits > least(1000,
      coalesce((v_policy->>'monthlyTavilyCreditCap')::integer, 1000)))
    or v_llm + v_reserve > v_run.run_llm_cap_usd
    or v_credits + p_tavily_credits > v_run.run_tavily_cap
    or (p_kind in ('extraction', 'claim_mapping') and v_calls >= v_run.run_llm_calls_cap)
    or exists(select 1 from public.automation_paid_operations where run_id = p_run_id and state in ('reserved', 'unknown')) then
    raise exception 'scanner_spending_blocked' using errcode = '55000';
  end if;
  insert into public.automation_paid_operations(id, run_id, kind, request_fingerprint,
    budget_month, reserved_llm_usd, reserved_tavily_credits)
  values(p_operation_id, p_run_id, p_kind, p_fingerprint,
    date_trunc('month', clock_timestamp() at time zone 'UTC')::date, v_reserve, p_tavily_credits);
  perform public.scanner_project_accounting(p_run_id);
  return jsonb_build_object('status', 'reserved', 'state', 'reserved');
end;
$$;

revoke all on function public.ai_settings_save(integer, jsonb),
  public.ai_connection_save(text, integer), public.ai_settings_activate(integer, uuid, text),
  public.ai_test_reserve(uuid, numeric), public.ai_test_settle(uuid, text, numeric)
  from public, anon, authenticated;
grant execute on function public.ai_settings_save(integer, jsonb),
  public.ai_connection_save(text, integer), public.ai_settings_activate(integer, uuid, text),
  public.ai_test_reserve(uuid, numeric), public.ai_test_settle(uuid, text, numeric)
  to service_role;
