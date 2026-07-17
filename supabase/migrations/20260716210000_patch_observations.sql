-- Observation lane: patch-day context the evidence funnel intentionally rejects
-- (press reception, patch release coverage, fix announcements). Observations are
-- explicitly NOT evidence: they never join issue clusters, never touch counts,
-- and only allowlisted (trusted) domains are ever stored.
create table if not exists patch_observations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  patch_version text not null,
  kind text not null check (kind in ('patch_release', 'press_reception', 'fix_announcement', 'community_ask')),
  title text not null,
  url text not null,
  url_hash text not null unique,
  source_domain text,
  snippet text,
  source_published_at timestamptz,
  observed_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  seen_count integer not null default 1 check (seen_count > 0),
  is_public boolean not null default true
);

create index if not exists patch_observations_patch_idx
  on patch_observations (patch_version, observed_at desc);

alter table patch_observations enable row level security;
