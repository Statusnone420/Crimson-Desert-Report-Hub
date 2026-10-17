-- Steam-connected player activity is aggregate context, never issue evidence.
-- A separate timestamped record preserves intraday history without changing
-- the existing daily review snapshots. There is no fabricated backfill.
create table public.steam_player_snapshots (
  sample_hour timestamptz primary key,
  captured_at timestamptz not null,
  player_count integer not null check (player_count >= 0),
  check (isfinite(captured_at)),
  check (sample_hour = date_trunc('hour', captured_at at time zone 'UTC') at time zone 'UTC')
);

create index steam_player_snapshots_captured_idx
  on public.steam_player_snapshots (captured_at desc);

alter table public.steam_player_snapshots enable row level security;
revoke all on public.steam_player_snapshots from public, anon, authenticated, service_role;
grant select, insert on public.steam_player_snapshots to service_role;

comment on table public.steam_player_snapshots is
  'Timestamped Steam-connected concurrent player counts for app 3321460; excludes offline play and other platforms. Not player issue evidence.';
