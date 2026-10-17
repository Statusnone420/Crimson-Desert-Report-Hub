-- Re-observation event ledger for tracked source signals.
--
-- Why: source_signals stores only seen_count / first_seen_at / last_seen_at,
-- so the site can say a lead was seen 9 times but not WHEN — recurrence
-- timelines have to be reconstructed instead of read. This additive table
-- records one row per re-observation going forward so recurrence and streak
-- charts become genuinely truthful as history accumulates.
--
-- Exposure contract: server-only. The scanner writes rows with the service
-- role; no anonymous or authenticated grant exists, and no view exposes raw
-- rows. Anything public stays a count or a day bucket computed server-side.
--
-- The application treats this table as optional: until this migration is
-- applied, the scanner's best-effort write degrades to a no-op and nothing
-- else changes.

create table if not exists public.signal_observation_events (
  id bigint generated always as identity primary key,
  signal_id uuid not null references public.source_signals(id) on delete cascade,
  run_id uuid references public.automation_runs(id) on delete set null,
  observed_at timestamptz not null default now()
);

create index if not exists signal_observation_events_signal_idx
  on public.signal_observation_events (signal_id, observed_at);

alter table public.signal_observation_events enable row level security;

revoke all on public.signal_observation_events from public, anon, authenticated;

-- Keep this migration self-contained: service-role access is explicit even if
-- the project-wide default grants migration has not been applied yet.
grant usage on schema public to service_role;
grant select, insert, update, delete on public.signal_observation_events to service_role;
revoke all on sequence public.signal_observation_events_id_seq from public, anon, authenticated;
grant usage, select on sequence public.signal_observation_events_id_seq to service_role;
