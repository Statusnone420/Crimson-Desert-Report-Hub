-- Editorial Dispatch homepage: per-day reports/taps/kept-leads since the
-- current patch published (capped at 30 days back).
--
-- Exposure contract: aggregates public, raw rows private. The view is
-- owner-evaluated (security_invoker = false) with security_barrier so caller
-- predicates cannot reach beneath the aggregate boundary, and grants are
-- applied ONLY to the view — never to bug_reports, issue_confirmations,
-- automation_runs, or any other raw table. The view returns only day,
-- reports, taps, and kept_leads.
--
-- Semantics honesty: issue_confirmations is a mutable current-stance table
-- (one row per network/cluster/patch family, updated in place), so `taps`
-- means "current confirmation rows last updated on this day", not an
-- immutable historical tap ledger.

create or replace view public.daily_signal_rollup
with (security_invoker = false, security_barrier = true)
as
with current_patch as (
  select
    patch_version,
    concat(
      split_part(trim(patch_version), '.', 1)::integer,
      '.',
      split_part(trim(patch_version), '.', 2)::integer
    ) as patch_family,
    published_at::date as published_day
  from public.official_patch_notes
  where is_current = true
    and trim(patch_version) ~
      '^[0-9]+\.[0-9]{1,2}(\.[0-9]{1,2})?$'
  order by published_at desc nulls last, observed_at desc
  limit 1
),
bounds as (
  select
    least(
      current_date,
      greatest(coalesce(published_day, current_date - 30), current_date - 30)
    ) as start_day
  from current_patch

  union all

  select current_date - 30
  where not exists (select 1 from current_patch)
),
days as (
  select generate_series(
    (select start_day from bounds),
    current_date,
    interval '1 day'
  )::date as day
),
reports as (
  select r.created_at::date as day, count(*)::bigint as reports
  from public.bug_reports r
  cross join current_patch p
  where r.moderation_status = 'approved'
    and trim(r.patch_version) ~
      '^[0-9]+\.[0-9]{1,2}(\.[0-9]{1,2})?$'
    and concat(
      split_part(trim(r.patch_version), '.', 1)::integer,
      '.',
      split_part(trim(r.patch_version), '.', 2)::integer
    ) = p.patch_family
  group by 1
),
taps as (
  select c.created_at::date as day, count(*)::bigint as taps
  from public.issue_confirmations c
  cross join current_patch p
  where c.patch_family = p.patch_family
  group by 1
),
kept as (
  select
    a.started_at::date as day,
    sum(a.signals_inserted)::bigint as kept_leads
  from public.automation_runs a
  where a.mode <> 'dry_run'
    and a.status in ('success', 'partial')
    and not (
      a.mode = 'manual'
      and a.intent = 'rescue_candidate'
      and coalesce(a.search_queries_used, 0) = 0
    )
  group by 1
)
select
  d.day,
  coalesce(r.reports, 0)::bigint as reports,
  coalesce(t.taps, 0)::bigint as taps,
  coalesce(k.kept_leads, 0)::bigint as kept_leads
from days d
left join reports r using (day)
left join taps t using (day)
left join kept k using (day)
order by d.day;

revoke all on public.daily_signal_rollup from public, anon, authenticated;
grant select on public.daily_signal_rollup to anon, authenticated, service_role;
