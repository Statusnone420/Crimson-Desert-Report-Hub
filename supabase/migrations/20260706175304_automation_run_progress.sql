alter table automation_runs
  add column if not exists progress jsonb;
