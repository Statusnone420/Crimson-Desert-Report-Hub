-- One-tap anonymous confirmations. One voice per network per issue per patch family;
-- an upsert replaces the voter's stance. Aggregates only ever leave the server.
create table issue_confirmations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  cluster_id uuid not null references issue_clusters(id) on delete cascade,
  patch_family text not null,
  patch_version text not null,
  platform text not null check (platform in ('pc_steam','ps5','ps5_pro','xbox_series_x','xbox_series_s','other')),
  kind text not null check (kind in ('have_it','still_happening','fixed_for_me')),
  voter_ip_hash text not null
);

create unique index idx_confirmations_one_voice
  on issue_confirmations (cluster_id, patch_family, voter_ip_hash);
create index idx_confirmations_cluster on issue_confirmations (cluster_id);
create index idx_confirmations_voter_time on issue_confirmations (voter_ip_hash, created_at desc);

-- Deny-all RLS like every other table; service role only.
alter table issue_confirmations enable row level security;
