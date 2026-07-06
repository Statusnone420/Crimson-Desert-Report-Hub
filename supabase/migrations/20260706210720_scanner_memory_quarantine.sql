alter table source_signals
  add column if not exists source_published_at timestamptz,
  add column if not exists first_seen_at timestamptz,
  add column if not exists last_seen_at timestamptz,
  add column if not exists seen_count integer default 1,
  add column if not exists last_seen_run_id uuid;

update source_signals
set first_seen_at = coalesce(created_at, observed_at, now())
where first_seen_at is null
  and (created_at is not null or observed_at is not null);

update source_signals
set first_seen_at = now()
where first_seen_at is null;

update source_signals
set last_seen_at = coalesce(observed_at, created_at)
where last_seen_at is null
  and coalesce(observed_at, created_at) is not null;

update source_signals
set seen_count = 1
where seen_count is null;

alter table source_signals
  alter column first_seen_at set default now(),
  alter column first_seen_at set not null,
  alter column seen_count set default 1,
  alter column seen_count set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'source_signals_seen_count_positive'
      and conrelid = 'public.source_signals'::regclass
  ) then
    alter table source_signals
      add constraint source_signals_seen_count_positive check (seen_count > 0);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'source_signals_last_seen_run_id_fkey'
      and conrelid = 'public.source_signals'::regclass
  ) then
    alter table source_signals
      add constraint source_signals_last_seen_run_id_fkey
      foreign key (last_seen_run_id) references automation_runs(id) on delete set null;
  end if;
end $$;

alter table automation_runs
  add column if not exists intent text,
  add column if not exists signals_reobserved integer not null default 0,
  add column if not exists stale_signals_hidden integer not null default 0,
  add column if not exists candidates_rescued integer not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'automation_runs_memory_counts_nonnegative'
      and conrelid = 'public.automation_runs'::regclass
  ) then
    alter table automation_runs
      add constraint automation_runs_memory_counts_nonnegative check (
        signals_reobserved >= 0
        and stale_signals_hidden >= 0
        and candidates_rescued >= 0
      );
  end if;
end $$;

create index if not exists idx_source_signals_source_published_at
  on source_signals (source_published_at desc);

create index if not exists idx_source_signals_last_seen_at
  on source_signals (last_seen_at desc);

create index if not exists idx_source_signals_last_seen_run_id
  on source_signals (last_seen_run_id);

create index if not exists idx_automation_runs_intent_started
  on automation_runs (intent, started_at desc);

grant usage on schema public to service_role;
grant select, insert, update, delete on source_signals to service_role;
grant select, insert, update, delete on automation_runs to service_role;
