-- Private scanner accounting. Apply only after draining legacy scanner work.
-- Expiry closes execution; it never refunds an uncertain external request.
alter table public.automation_runs
  add column accounting_version smallint not null default 0 check (accounting_version in (0, 1)),
  add column execution_token uuid,
  add column work_deadline_at timestamptz,
  add column lease_expires_at timestamptz,
  add column progress_revision bigint not null default 0,
  add column finalization_key uuid,
  add column finalization_payload jsonb,
  add column accounting_state text not null default 'recorded'
    check (accounting_state in ('recorded', 'unresolved', 'anomalous')),
  add column run_llm_cap_usd numeric(18,9),
  add column run_tavily_cap integer,
  add column run_llm_calls_cap integer;
alter table public.automation_runs add constraint scanner_guarded_run_contract check (
  accounting_version = 0 or (execution_token is not null and work_deadline_at is not null
    and lease_expires_at is not null and work_deadline_at < lease_expires_at
    and run_llm_cap_usd is not null and run_llm_cap_usd >= 0
    and run_tavily_cap is not null and run_tavily_cap >= 0
    and run_llm_calls_cap is not null and run_llm_calls_cap >= 0));

create unique index scanner_one_guarded_run on public.automation_runs ((true))
  where accounting_version = 1 and status = 'running';

create table public.automation_paid_operations (
  id uuid primary key,
  run_id uuid not null references public.automation_runs(id),
  kind text not null check (kind in ('extraction', 'claim_mapping', 'tavily_search', 'tavily_extract')),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  budget_month date not null,
  admitted_at timestamptz not null default clock_timestamp(),
  reserved_llm_usd numeric(18,9) not null check (reserved_llm_usd >= 0),
  reserved_tavily_credits integer not null check (reserved_tavily_credits >= 0),
  settled_llm_usd numeric(18,9) check (settled_llm_usd >= 0),
  settled_tavily_credits integer check (settled_tavily_credits >= 0),
  state text not null default 'reserved'
    check (state in ('reserved', 'verified', 'estimated', 'unknown', 'not_sent')),
  settled_at timestamptz,
  revision bigint not null default 0,
  check ((kind in ('extraction', 'claim_mapping') and reserved_tavily_credits = 0)
      or (kind in ('tavily_search', 'tavily_extract') and reserved_llm_usd = 0))
);
create index scanner_paid_run on public.automation_paid_operations(run_id);
create index scanner_paid_month on public.automation_paid_operations(budget_month);
create index scanner_paid_unresolved on public.automation_paid_operations(budget_month)
  where state in ('reserved', 'unknown');
alter table public.automation_paid_operations enable row level security;
revoke all on public.automation_paid_operations from public, anon, authenticated, service_role;
grant select, insert, update on public.automation_paid_operations to service_role;

-- Preserve recoverable legacy exposure once, without counting this month's
-- legacy rows twice. A null ceiling blocks spending until private reconciliation.
create table public.scanner_legacy_debt (
  run_id uuid primary key references public.automation_runs(id),
  budget_month date not null,
  llm_ceiling_usd numeric(18,9),
  tavily_ceiling integer,
  resolved boolean not null default false,
  revision bigint not null default 0
);
alter table public.scanner_legacy_debt enable row level security;
revoke all on public.scanner_legacy_debt from public, anon, authenticated, service_role;
grant select, insert, update on public.scanner_legacy_debt to service_role;
insert into public.scanner_legacy_debt(run_id, budget_month, llm_ceiling_usd, tavily_ceiling)
select id, date_trunc('month', started_at at time zone 'UTC')::date,
  -- The accounting fix first reached production at this time.
  -- Its finalized totals include every unknown request's conservative ceiling.
  -- Earlier, stale, or incomplete runs cannot establish that bound. The extra
  -- microdollar covers downward rounding in the old numeric(10,6) run total.
  case when status not in ('running', 'skipped') and finished_at >= started_at
    and progress->>'stage' = 'done' and not (errors ? 'stale_running_run')
    and llm_calls_used > 0 and search_queries_used >= 0
    and estimated_cost_usd >= search_queries_used * 0.008
    and (progress->>'llmCostUsd' is null or progress->>'llmCostUsd' ~ '^[0-9]+(\.[0-9]+)?$')
    then case
      when started_at >= timestamptz '2026-07-10 22:39:37+00'
        and (estimated_cost_usd > search_queries_used * 0.008
          or coalesce((progress->>'llmCostUsd')::numeric, 0) > 0)
        then ceil(greatest(estimated_cost_usd - search_queries_used * 0.008 + 0.000001,
          coalesce((progress->>'llmCostUsd')::numeric, 0)) * 1000000000) / 1000000000
      -- The preceding deployed source pins deepseek-v4-flash, price limits
      -- $0.10/M input and $0.20/M output, and at most 400 completion tokens.
      -- Its July 9 official endpoint catalogue caps every context at 1,048,576
      -- tokens: a whole request cannot exceed $0.1049376; round up per call.
      -- Keep that whole-run bound unresolved, never claim it was billed.
      when started_at >= timestamptz '2026-07-10 01:37:56+00'
        and started_at < timestamptz '2026-07-10 22:39:37+00'
        then ceil(greatest(llm_calls_used * 0.104938,
          estimated_cost_usd - search_queries_used * 0.008 + 0.000001,
          coalesce((progress->>'llmCostUsd')::numeric, 0)) * 1000000000) / 1000000000
      else null end
    else null end,
  case when status <> 'running' and finished_at >= started_at and search_queries_used >= 0
    and progress->>'stage' = 'done' and not (errors ? 'stale_running_run')
    then search_queries_used else null end
from public.automation_runs
where accounting_version = 0 and (skips ? 'openrouter_cost_unverified' or status = 'running');

create table public.scanner_mapping_cache (
  fingerprint text primary key check (fingerprint ~ '^[a-f0-9]{64}$'),
  decision jsonb not null check (jsonb_typeof(decision) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null
);
alter table public.scanner_mapping_cache enable row level security;
revoke all on public.scanner_mapping_cache from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.scanner_mapping_cache to service_role;

-- Append-only, sanitized evidence of an explicitly authorized reconciliation.
create table public.scanner_accounting_reconciliations (
  id uuid primary key,
  target_id uuid not null,
  request jsonb not null,
  before_accounting jsonb not null,
  after_accounting jsonb not null,
  recorded_at timestamptz not null default clock_timestamp()
);
alter table public.scanner_accounting_reconciliations enable row level security;
revoke all on public.scanner_accounting_reconciliations from public, anon, authenticated, service_role;
grant select, insert on public.scanner_accounting_reconciliations to service_role;

create function public.scanner_budget_summary(p_now timestamptz default clock_timestamp())
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
      coalesce(bool_or(coalesce(settled_llm_usd, 0) > reserved_llm_usd
        or coalesce(settled_tavily_credits, 0) > reserved_tavily_credits), false) as anomaly
    from public.automation_paid_operations, period
    where budget_month = period.month
      or (budget_month < period.month and state in ('reserved', 'unknown'))
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
  select jsonb_build_object('llmCostUsd', legacy.llm + paid.llm + debt.llm,
    'tavilyCredits', legacy.credits + paid.credits + debt.credits,
    'estimatedCostUsd', legacy.llm + paid.llm + debt.llm
      + (legacy.credits + paid.credits + debt.credits) * 0.008,
    'openRouterCircuitOpen', circuit.open or paid.anomaly or debt.blocked,
    'paidSpendingAnomaly', paid.anomaly,
    'reconciliationRequired', debt.blocked,
    'accountingVersion', 1)
  from legacy, paid, debt, circuit;
$$;

-- One bounded round trip preserves finished/legacy and meaningful/validated
-- candidate selection. Do not transfer unrelated progress payload fields.
create function public.scanner_ai_health_runs(p_relevant_codes text[])
returns jsonb language sql security invoker set search_path = '' as $$
  with candidates as (
    (select started_at, finished_at, status, mode, skips, llm_calls_used, progress
     from public.automation_runs
     where status not in ('skipped', 'running') and mode <> 'dry_run' and finished_at is not null
       and (progress->>'llmSucceeded' > '0' or progress->>'aiCompletionUnverified' = 'true' or skips ?| p_relevant_codes)
     order by finished_at desc limit 1)
    union all
    (select started_at, finished_at, status, mode, skips, llm_calls_used, progress
     from public.automation_runs
     where status not in ('skipped', 'running') and mode <> 'dry_run' and finished_at is null
       and (progress->>'llmSucceeded' > '0' or progress->>'aiCompletionUnverified' = 'true' or skips ?| p_relevant_codes)
     order by started_at desc limit 1)
    union all
    (select started_at, finished_at, status, mode, skips, llm_calls_used, progress
     from public.automation_runs
     where status not in ('skipped', 'running') and mode <> 'dry_run' and finished_at is not null
       and progress->>'llmSucceeded' > '0'
     order by finished_at desc limit 1)
    union all
    (select started_at, finished_at, status, mode, skips, llm_calls_used, progress
     from public.automation_runs
     where status not in ('skipped', 'running') and mode <> 'dry_run' and finished_at is null
       and progress->>'llmSucceeded' > '0'
     order by started_at desc limit 1)
  )
  select coalesce(jsonb_agg(jsonb_build_object('started_at', started_at, 'finished_at', finished_at,
    'status', status, 'mode', mode, 'skips', skips, 'llm_calls_used', llm_calls_used,
    'progress', jsonb_build_object('llmSucceeded', progress->'llmSucceeded',
      'aiCompletionUnverified', progress->'aiCompletionUnverified', 'openRouterTrace', progress->'openRouterTrace'))), '[]'::jsonb)
  from candidates;
$$;

create function public.scanner_project_accounting(p_run_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_llm numeric; v_credits integer; v_calls integer; v_state text; v_llm_state text;
begin
  select coalesce(sum(case when state in ('reserved', 'unknown') then reserved_llm_usd
      else coalesce(settled_llm_usd, reserved_llm_usd) end), 0),
    coalesce(sum(case when state in ('reserved', 'unknown') then reserved_tavily_credits
      else coalesce(settled_tavily_credits, reserved_tavily_credits) end), 0),
    count(*) filter (where kind in ('extraction', 'claim_mapping') and state <> 'not_sent'),
    case when bool_or(coalesce(settled_llm_usd, 0) > reserved_llm_usd
      or coalesce(settled_tavily_credits, 0) > reserved_tavily_credits) then 'anomalous'
      when bool_or(state in ('reserved', 'unknown')) then 'unresolved' else 'recorded' end,
    case when count(*) filter (where kind in ('extraction', 'claim_mapping') and state <> 'not_sent') = 0 then 'not_attempted'
      when bool_or(kind in ('extraction', 'claim_mapping') and state in ('reserved', 'unknown')) then 'reserved_unknown'
      when bool_or(kind in ('extraction', 'claim_mapping') and state = 'estimated') then 'unknown' else 'verified' end
    into v_llm, v_credits, v_calls, v_state, v_llm_state
    from public.automation_paid_operations where run_id = p_run_id;
  update public.automation_runs set
    estimated_cost_usd = ceil((v_llm + v_credits * 0.008) * 1000000) / 1000000,
    search_queries_used = v_credits, llm_calls_used = v_calls, accounting_state = v_state,
    progress = progress || jsonb_build_object('llmCostUsd', v_llm, 'llmCostState', v_llm_state,
      'estimatedCostUsd', v_llm + v_credits * 0.008, 'accountingState', v_state)
    where id = p_run_id and accounting_version = 1;
end;
$$;

create function public.scanner_reject_legacy_admission()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.status = 'running' and new.accounting_version <> 1 then
    raise exception 'scanner_accounting_required' using errcode = '55000';
  end if;
  return new;
end;
$$;
create trigger scanner_legacy_admission before insert on public.automation_runs
  for each row execute function public.scanner_reject_legacy_admission();

create function public.scanner_admit_run(p_run_id uuid, p_token uuid, p_mode text,
  p_work_deadline timestamptz, p_lease_deadline timestamptz, p_budget jsonb,
  p_progress jsonb, p_patch_burst boolean default false)
returns jsonb language plpgsql security invoker set search_path = ''
set lock_timeout = '4s' set statement_timeout = '8s' as $$
declare v_existing public.automation_runs; v_policy jsonb; v_now timestamptz := clock_timestamp();
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
  insert into public.automation_runs(id, execution_token, accounting_version, mode,
    work_deadline_at, lease_expires_at, budget_monthly_usd, budget_remaining_before_usd,
    run_llm_cap_usd, run_tavily_cap, run_llm_calls_cap, progress, skips)
  values(p_run_id, p_token, 1, p_mode, p_work_deadline, p_lease_deadline,
    least(1, greatest(0, (p_budget->>'monthlyLlmUsdCap')::numeric)),
    greatest(0, (p_budget->>'remainingMonthUsd')::numeric),
    least(1, greatest(0, (p_budget->>'remainingLlmUsd')::numeric)),
    least(1000, greatest(0, (p_budget->>'maxTavilyCreditsPerRun')::integer)),
    least(100, greatest(0, (p_budget->>'maxLlmCalls')::integer)),
    p_progress, case when p_patch_burst then '["patch_burst_active"]'::jsonb else '[]'::jsonb end);
  return jsonb_build_object('status', 'admitted');
end;
$$;

create function public.scanner_reserve_operation(p_run_id uuid, p_token uuid, p_operation_id uuid,
  p_kind text, p_fingerprint text, p_llm_usd numeric, p_tavily_credits integer)
returns jsonb language plpgsql security invoker set search_path = ''
set lock_timeout = '4s' set statement_timeout = '8s' as $$
declare v_run public.automation_runs; v_op public.automation_paid_operations; v_summary jsonb;
  v_policy jsonb; v_llm numeric; v_credits integer; v_calls integer; v_reserve numeric;
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
      coalesce((v_policy->>'monthlyLlmUsdCap')::numeric, 0.5), 1))
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

create function public.scanner_settle_operation(p_run_id uuid, p_token uuid, p_operation_id uuid,
  p_state text, p_llm_usd numeric, p_tavily_credits integer, p_revision bigint default 1)
returns jsonb language plpgsql security invoker set search_path = ''
set lock_timeout = '4s' set statement_timeout = '8s' as $$
declare v_op public.automation_paid_operations; v_token uuid;
begin
  perform pg_advisory_xact_lock(661309132);
  select execution_token into v_token from public.automation_runs where id = p_run_id for update;
  if v_token is distinct from p_token then raise exception 'scanner_owner_mismatch' using errcode = '42501'; end if;
  select * into v_op from public.automation_paid_operations where id = p_operation_id and run_id = p_run_id for update;
  if not found then raise exception 'scanner_operation_missing' using errcode = '22023'; end if;
  if p_state is null or p_state not in ('verified', 'estimated', 'unknown', 'not_sent') or p_revision is null or p_revision < 1
    or (p_state <> 'unknown' and (p_llm_usd is null or p_tavily_credits is null))
    or p_llm_usd < 0 or p_llm_usd::text in ('NaN', 'Infinity', '-Infinity') or p_tavily_credits < 0
    or (p_state = 'unknown' and (p_llm_usd is not null or p_tavily_credits is not null))
    or (v_op.kind in ('extraction', 'claim_mapping') and coalesce(p_tavily_credits, 0) <> 0)
    or (v_op.kind in ('tavily_search', 'tavily_extract') and coalesce(p_llm_usd, 0) <> 0)
    or (p_state = 'not_sent' and (p_llm_usd <> 0 or p_tavily_credits <> 0)) then
    raise exception 'scanner_invalid_settlement' using errcode = '22023';
  end if;
  if v_op.revision = p_revision then
    if v_op.state <> p_state or v_op.settled_llm_usd is distinct from p_llm_usd
      or v_op.settled_tavily_credits is distinct from p_tavily_credits then
      raise exception 'scanner_settlement_conflict' using errcode = '22023';
    end if;
  elsif v_op.revision > p_revision or (v_op.state not in ('reserved', 'unknown') and v_op.revision > 0) then
    raise exception 'scanner_settlement_conflict' using errcode = '22023';
  else
    update public.automation_paid_operations set state = p_state, settled_llm_usd = p_llm_usd,
      settled_tavily_credits = p_tavily_credits, settled_at = clock_timestamp(), revision = p_revision
      where id = p_operation_id;
    perform public.scanner_project_accounting(p_run_id);
  end if;
  return jsonb_build_object('status', 'settled', 'state', p_state,
    'anomalous', coalesce(p_llm_usd > v_op.reserved_llm_usd, false)
      or coalesce(p_tavily_credits > v_op.reserved_tavily_credits, false));
end;
$$;

create function public.scanner_write_progress(p_run_id uuid, p_token uuid, p_revision bigint,
  p_progress jsonb, p_intent text)
returns jsonb language plpgsql security invoker set search_path = ''
set lock_timeout = '2s' set statement_timeout = '4s' as $$
declare v_run public.automation_runs;
begin
  if p_revision is null or p_revision < 1 or p_progress is null then raise exception 'scanner_invalid_progress' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(661309132);
  select * into v_run from public.automation_runs where id = p_run_id for update;
  if not found or v_run.execution_token is distinct from p_token then
    raise exception 'scanner_owner_mismatch' using errcode = '42501';
  end if;
  if v_run.status <> 'running' then return jsonb_build_object('status', 'closed'); end if;
  if clock_timestamp() >= v_run.lease_expires_at then return jsonb_build_object('status', 'lease_expired'); end if;
  if p_revision <= v_run.progress_revision then return jsonb_build_object('status', 'superseded'); end if;
  update public.automation_runs set progress = p_progress, intent = p_intent, progress_revision = p_revision where id = p_run_id;
  perform public.scanner_project_accounting(p_run_id);
  return jsonb_build_object('status', 'applied');
end;
$$;

create function public.scanner_finalize_run(p_run_id uuid, p_token uuid, p_key uuid, p_result jsonb)
returns jsonb language plpgsql security invoker set search_path = ''
set lock_timeout = '4s' set statement_timeout = '8s' as $$
declare v_run public.automation_runs; v_status text;
begin
  if p_key is null or p_result is null then raise exception 'scanner_invalid_finalization' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(661309132);
  select * into v_run from public.automation_runs where id = p_run_id for update;
  if not found or v_run.execution_token is distinct from p_token then
    raise exception 'scanner_owner_mismatch' using errcode = '42501';
  end if;
  if v_run.finalization_key = p_key then
    if v_run.finalization_payload is distinct from p_result then
      raise exception 'scanner_finalization_conflict' using errcode = '22023';
    end if;
    return jsonb_build_object('status', 'recorded', 'runStatus', v_run.status,
      'accountingState', v_run.accounting_state, 'estimatedCostUsd', v_run.estimated_cost_usd,
      'llmCostUsd', (v_run.progress->>'llmCostUsd')::numeric,
      'llmCostState', v_run.progress->>'llmCostState',
      'tavilyCredits', v_run.search_queries_used, 'llmCalls', v_run.llm_calls_used);
  end if;
  if v_run.status <> 'running' or clock_timestamp() >= v_run.lease_expires_at then
    return jsonb_build_object('status', 'closed');
  end if;
  v_status := p_result->>'status';
  if v_status not in ('success', 'partial', 'failed', 'skipped') then
    raise exception 'scanner_invalid_finalization' using errcode = '22023';
  end if;
  perform public.scanner_project_accounting(p_run_id);
  select * into v_run from public.automation_runs where id = p_run_id;
  if v_run.accounting_state <> 'recorded' and v_status = 'success' then v_status := 'partial'; end if;
  update public.automation_runs set finished_at = clock_timestamp(), status = v_status,
    finalization_key = p_key, finalization_payload = p_result,
    search_results_seen = greatest(0, (p_result->>'search_results_seen')::integer),
    signals_inserted = greatest(0, (p_result->>'signals_inserted')::integer),
    signals_deduped = greatest(0, (p_result->>'signals_deduped')::integer),
    clusters_promoted = greatest(0, (p_result->>'clusters_promoted')::integer),
    signals_reobserved = greatest(0, (p_result->>'signals_reobserved')::integer),
    stale_signals_hidden = greatest(0, (p_result->>'stale_signals_hidden')::integer),
    candidates_rescued = greatest(0, (p_result->>'candidates_rescued')::integer),
    operator_rules_matched = greatest(0, (p_result->>'operator_rules_matched')::integer),
    intent = p_result->>'intent', skips = p_result->'skips', errors = p_result->'errors',
    funnel = p_result->'funnel', progress = p_result->'progress' where id = p_run_id;
  perform public.scanner_project_accounting(p_run_id);
  select * into v_run from public.automation_runs where id = p_run_id;
  return jsonb_build_object('status', 'recorded', 'runStatus', v_run.status,
    'accountingState', v_run.accounting_state, 'estimatedCostUsd', v_run.estimated_cost_usd,
    'llmCostUsd', (v_run.progress->>'llmCostUsd')::numeric,
    'llmCostState', v_run.progress->>'llmCostState',
    'tavilyCredits', v_run.search_queries_used, 'llmCalls', v_run.llm_calls_used);
end;
$$;

-- Private operator reconciliation requires authoritative billing/no-charge
-- evidence. It never dispatches a provider and never reopens a finished run.
create function public.scanner_reconcile_accounting(p_request_id uuid, p_target_id uuid,
  p_target_kind text, p_expected_revision bigint, p_llm_usd numeric,
  p_tavily_credits integer, p_evidence_kind text, p_evidence_hash text, p_actor text)
returns jsonb language plpgsql security invoker set search_path = ''
set lock_timeout = '4s' set statement_timeout = '8s' as $$
declare v_request jsonb; v_receipt public.scanner_accounting_reconciliations;
  v_operation public.automation_paid_operations; v_debt public.scanner_legacy_debt;
  v_run public.automation_runs; v_before jsonb; v_after jsonb;
begin
  if p_request_id is null or p_target_id is null or p_expected_revision is null or p_expected_revision < 0
    or p_target_kind is null or p_target_kind not in ('operation', 'legacy_run')
    or p_llm_usd is null or p_llm_usd < 0 or p_llm_usd::text in ('NaN', 'Infinity', '-Infinity')
    or p_tavily_credits is null or p_tavily_credits < 0
    or p_evidence_kind is null or p_evidence_kind not in ('provider_billing', 'provider_no_charge', 'legacy_billing')
    or p_evidence_hash is null or p_evidence_hash !~ '^[a-f0-9]{64}$'
    or p_actor is null or p_actor !~ '^[a-z0-9][a-z0-9_.-]{0,63}$' then
    raise exception 'scanner_invalid_reconciliation' using errcode = '22023';
  end if;
  if p_evidence_kind = 'provider_no_charge' and (p_llm_usd <> 0 or p_tavily_credits <> 0) then
    raise exception 'scanner_invalid_reconciliation' using errcode = '22023';
  end if;
  v_request := jsonb_build_object('targetId', p_target_id, 'targetKind', p_target_kind,
    'expectedRevision', p_expected_revision, 'llmCostUsd', p_llm_usd, 'tavilyCredits', p_tavily_credits,
    'evidenceKind', p_evidence_kind, 'evidenceHash', p_evidence_hash, 'actor', p_actor);
  perform pg_advisory_xact_lock(661309132);
  select * into v_receipt from public.scanner_accounting_reconciliations where id = p_request_id;
  if found then
    if v_receipt.request is distinct from v_request then
      raise exception 'scanner_reconciliation_conflict' using errcode = '22023';
    end if;
    return jsonb_build_object('status', 'recorded', 'receiptId', v_receipt.id, 'accounting', v_receipt.after_accounting);
  end if;
  if p_target_kind = 'operation' then
    select * into v_operation from public.automation_paid_operations where id = p_target_id;
    if not found then raise exception 'scanner_operation_missing' using errcode = '22023'; end if;
    select * into v_run from public.automation_runs where id = v_operation.run_id for update;
    select * into v_operation from public.automation_paid_operations where id = p_target_id for update;
    if v_run.status = 'running' and clock_timestamp() < v_run.lease_expires_at then
      raise exception 'scanner_reconciliation_executor_active' using errcode = '55000';
    end if;
    if v_operation.revision <> p_expected_revision or v_operation.state not in ('reserved', 'unknown', 'estimated') then
      raise exception 'scanner_reconciliation_revision_conflict' using errcode = '22023';
    end if;
    if (v_operation.kind in ('extraction', 'claim_mapping') and p_tavily_credits <> 0)
      or (v_operation.kind in ('tavily_search', 'tavily_extract') and p_llm_usd <> 0) then
      raise exception 'scanner_invalid_reconciliation' using errcode = '22023';
    end if;
    v_before := jsonb_build_object('state', v_operation.state, 'revision', v_operation.revision,
      'llmCostUsd', v_operation.settled_llm_usd, 'tavilyCredits', v_operation.settled_tavily_credits);
    if v_run.status = 'running' then
      update public.automation_runs set status = 'failed', finished_at = clock_timestamp(),
        errors = errors || jsonb_build_array('scanner_lease_expired') where id = v_run.id;
    end if;
    update public.automation_paid_operations set state = 'verified', settled_llm_usd = p_llm_usd,
      settled_tavily_credits = p_tavily_credits, settled_at = clock_timestamp(), revision = revision + 1
      where id = p_target_id;
    perform public.scanner_project_accounting(v_run.id);
    v_after := jsonb_build_object('state', 'verified', 'revision', p_expected_revision + 1,
      'llmCostUsd', p_llm_usd, 'tavilyCredits', p_tavily_credits);
  else
    select * into v_run from public.automation_runs where id = p_target_id for update;
    select * into v_debt from public.scanner_legacy_debt where run_id = p_target_id for update;
    if not found or v_run.accounting_version <> 0 or v_debt.resolved or v_debt.revision <> p_expected_revision then
      raise exception 'scanner_reconciliation_revision_conflict' using errcode = '22023';
    end if;
    if v_run.status = 'running' then
      raise exception 'scanner_reconciliation_executor_active' using errcode = '55000';
    end if;
    v_before := jsonb_build_object('revision', v_debt.revision, 'llmCeilingUsd', v_debt.llm_ceiling_usd,
      'tavilyCeiling', v_debt.tavily_ceiling, 'estimatedCostUsd', v_run.estimated_cost_usd,
      'tavilyCredits', v_run.search_queries_used);
    update public.automation_runs set estimated_cost_usd = ceil((p_llm_usd + p_tavily_credits * 0.008) * 1000000) / 1000000,
      search_queries_used = p_tavily_credits,
      progress = progress || jsonb_build_object('llmCostUsd', p_llm_usd, 'accountingState', 'recorded')
      where id = p_target_id;
    update public.scanner_legacy_debt set resolved = true, revision = revision + 1,
      llm_ceiling_usd = p_llm_usd, tavily_ceiling = p_tavily_credits where run_id = p_target_id;
    v_after := jsonb_build_object('state', 'verified', 'revision', p_expected_revision + 1,
      'llmCostUsd', p_llm_usd, 'tavilyCredits', p_tavily_credits);
  end if;
  insert into public.scanner_accounting_reconciliations(id, target_id, request, before_accounting, after_accounting)
    values (p_request_id, p_target_id, v_request, v_before, v_after);
  return jsonb_build_object('status', 'recorded', 'receiptId', p_request_id, 'accounting', v_after);
end;
$$;

-- A guarded invocation adds these private headers to source writes. Validate
-- them INSIDE the mutation transaction, including writes made by existing RPCs.
-- Admission/finalization/settlement use a separate context without these headers.
create function public.scanner_enter_source_transaction()
returns void language plpgsql security invoker set search_path = ''
set lock_timeout = '4s' as $$
declare v_headers jsonb; v_run_id uuid; v_token uuid;
begin
  v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  if v_headers->>'x-scanner-run-id' is null then return; end if;
  v_run_id := (v_headers->>'x-scanner-run-id')::uuid;
  v_token := (v_headers->>'x-scanner-execution-token')::uuid;
  perform pg_advisory_xact_lock(661309132);
  perform 1 from public.automation_runs where id = v_run_id and execution_token = v_token
    and accounting_version = 1 and status = 'running' and clock_timestamp() < work_deadline_at for share;
  if not found then raise exception 'scanner_source_write_fenced' using errcode = '55000'; end if;
end;
$$;
create function public.scanner_fence_source_write()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if nullif(current_setting('request.headers', true), '')::jsonb->>'x-scanner-run-id' is null then return null; end if;
  perform public.scanner_enter_source_transaction();
  return null;
end;
$$;

-- Acquire the scanner entry lock BEFORE pre-existing visibility/patch locks.
-- Table triggers alone would enter too late for these RPCs and invert lock order.
-- Preserve each RPC's exact signature, access control and body otherwise.
do $$
declare v_function record; v_definition text; v_guarded text;
begin
  for v_function in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prolang = (select oid from pg_language where lanname = 'plpgsql')
      and p.proname in ('sync_claim_review_proposals',
      'persist_patch_observations', 'apply_cluster_visibility_refresh',
      'sync_official_patch_note_with_claimed_fixes') loop
    v_definition := pg_get_functiondef(v_function.oid);
    v_guarded := regexp_replace(v_definition, '(^|\n)([[:space:]]*begin[[:space:]]*\n)',
      E'\\1\\2  perform public.scanner_enter_source_transaction();\n', 'i');
    if v_guarded = v_definition then raise exception 'scanner_rpc_entry_not_found'; end if;
    execute v_guarded;
  end loop;
end;
$$;
do $$
declare v_table record;
begin
  for v_table in select tablename from pg_tables where schemaname = 'public'
    and tablename not in ('automation_runs', 'automation_paid_operations', 'scanner_legacy_debt', 'scanner_mapping_cache', 'scanner_accounting_reconciliations') loop
    execute format('create trigger scanner_execution_fence before insert or update or delete on public.%I for each statement execute function public.scanner_fence_source_write()', v_table.tablename);
  end loop;
end;
$$;

-- Private helpers and RPCs are never callable by website visitors.
do $$
declare v_function record;
begin
  for v_function in select p.oid::regprocedure as signature from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'scanner\_%' escape '\' loop
    execute format('revoke all on function %s from public, anon, authenticated', v_function.signature);
    execute format('grant execute on function %s to service_role', v_function.signature);
  end loop;
end;
$$;
