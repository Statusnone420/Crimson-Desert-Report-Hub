-- Crimson Desert Report Hub schema. All access is via service role; RLS is deny-all.

create table issue_clusters (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  slug text not null unique,
  title text not null,
  category text not null check (category in ('performance','crash_startup','controls_gameplay','graphics_visual','audio','quest_progression','other')),
  description text not null default '',
  fix_status text not null default 'reported' check (fix_status in ('reported','acknowledged','fix_claimed','verified_fixed','persists')),
  confidence text not null default 'seed_unverified' check (confidence in ('seed_unverified','low','medium','confirmed')),
  is_public boolean not null default true
);

create table bug_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  patch_version text not null,
  platform text not null check (platform in ('pc_steam','ps5','ps5_pro','xbox_series_x','xbox_series_s','other')),
  category text not null check (category in ('performance','crash_startup','controls_gameplay','graphics_visual','audio','quest_progression','other')),
  severity text not null check (severity in ('low','medium','high','blocking')),
  frequency text not null check (frequency in ('once','sometimes','often','always')),
  issue_title text not null,
  description text not null,
  repro_steps text,
  expected_behavior text,
  actual_behavior text,
  location_quest text,
  hardware_specs text,
  graphics_mode text,
  driver_os text,
  troubleshooting_tried text,
  pers_id text,
  official_report_submitted boolean not null default false,
  evidence_url text,
  moderation_status text not null default 'pending' check (moderation_status in ('pending','approved','rejected','spam')),
  cluster_id uuid references issue_clusters(id) on delete set null,
  duplicate_fingerprint text not null,
  submitter_ip_hash text
);

create index idx_reports_status on bug_reports (moderation_status);
create index idx_reports_created on bug_reports (created_at desc);
create index idx_reports_fingerprint on bug_reports (duplicate_fingerprint);
create index idx_reports_cluster on bug_reports (cluster_id);
create index idx_reports_ip_time on bug_reports (submitter_ip_hash, created_at desc);

create table approved_excerpts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  report_id uuid not null references bug_reports(id) on delete cascade,
  excerpt_text text not null check (char_length(excerpt_text) <= 500)
);

create table source_signals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  source text not null check (source in ('reddit','x_manual','x_search')),
  source_url text not null,
  external_id_hash text not null unique,
  summary text not null,
  extracted_facts jsonb not null default '{}'::jsonb,
  category text not null check (category in ('performance','crash_startup','controls_gameplay','graphics_visual','audio','quest_progression','other')),
  confidence text not null check (confidence in ('low','medium','high')),
  observed_at timestamptz not null,
  raw_text text,
  raw_expires_at timestamptz
);

create index idx_signals_observed on source_signals (observed_at desc);

create table dossier_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  markdown text not null,
  provider text not null default 'deterministic',
  stats jsonb not null default '{}'::jsonb
);

-- Deny-all RLS: service role bypasses RLS; anon/authenticated get nothing.
alter table issue_clusters enable row level security;
alter table bug_reports enable row level security;
alter table approved_excerpts enable row level security;
alter table source_signals enable row level security;
alter table dossier_runs enable row level security;
