-- Scanner budget change (2026-10-04):
-- 1. Remove the 3-unverified-runs/24-hour AI circuit. An unverified cost still
--    stops paid work for the rest of its run (scanner_reserve_operation blocks
--    while that run has a reserved or unknown operation). A money anomaly still
--    latches the circuit for the UTC month.
-- 2. Unresolved holds stop counting when their UTC month ends. The OpenRouter
--    key limit remains the provider-side backstop for real spending.
-- Only scanner_budget_summary changes. Its signature, grants and output keys are unchanged.
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
  ), tests as (
    select coalesce(sum(case when state in ('reserved', 'unknown') then reserved_usd else settled_usd end), 0) as llm,
      coalesce(sum(case when state in ('reserved', 'unknown') then reserved_usd else 0 end), 0) as uncertain,
      coalesce(sum(case when state = 'verified' then settled_usd else 0 end), 0) as confirmed,
      coalesce(bool_or(settled_usd > reserved_usd), false) as anomaly
    from public.ai_test_operations, period
    where budget_month = period.month
  ), debt as (
    select coalesce(sum(case when d.budget_month = period.month then greatest(d.llm_ceiling_usd
          - greatest(r.estimated_cost_usd - r.search_queries_used * 0.008, 0), 0)
        else 0 end), 0) as llm,
      coalesce(sum(case when d.budget_month = period.month then greatest(d.tavily_ceiling - r.search_queries_used, 0)
        else 0 end), 0) as credits,
      coalesce(bool_or(d.llm_ceiling_usd is null or d.tavily_ceiling is null), false) as blocked
    from public.scanner_legacy_debt d join public.automation_runs r on r.id = d.run_id,
      period where not d.resolved
  ), circuit as (
    select coalesce(bool_or(skips ? 'openrouter_unexpected_charge' or skips ? 'openrouter_budget_exceeded'), false) as open
    from public.automation_runs r, period
    where started_at >= period.month::timestamp at time zone 'UTC'
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
