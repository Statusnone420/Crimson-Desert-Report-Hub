alter table automation_runs
  add column if not exists funnel jsonb not null default '{}'::jsonb;
