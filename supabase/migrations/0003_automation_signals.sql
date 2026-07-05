alter table issue_clusters
  add column if not exists signal_count integer not null default 0,
  add column if not exists direct_report_count integer not null default 0,
  add column if not exists verified_report_count integer not null default 0,
  add column if not exists public_signal_count integer not null default 0,
  add column if not exists last_signal_at timestamptz,
  add column if not exists auto_public boolean not null default false,
  add column if not exists admin_visibility_override text check (admin_visibility_override in ('force_public','force_hidden'));

alter table source_signals drop constraint if exists source_signals_source_check;
alter table source_signals add constraint source_signals_source_check
  check (source in ('reddit','web_search','x_manual','x_search'));

alter table source_signals
  add column if not exists canonical_url text,
  add column if not exists title text,
  add column if not exists source_domain text,
  add column if not exists source_type text check (source_type in ('reddit','web_search','x_manual','x_search')),
  add column if not exists semantic_fingerprint text,
  add column if not exists cluster_id uuid references issue_clusters(id) on delete set null,
  add column if not exists public_status text not null default 'private' check (public_status in ('private','public','hidden')),
  add column if not exists promoted_at timestamptz,
  add column if not exists promotion_reason text,
  add column if not exists extraction_provider text not null default 'deterministic' check (extraction_provider in ('deterministic','openrouter')),
  add column if not exists extraction_model text,
  add column if not exists cost_estimate_usd numeric(10,6) not null default 0;

update source_signals set source_type = source where source_type is null;
update source_signals set canonical_url = source_url where canonical_url is null;
update source_signals set title = summary where title is null;

create index if not exists idx_signals_cluster on source_signals (cluster_id);
create index if not exists idx_signals_public on source_signals (public_status, observed_at desc);
create index if not exists idx_signals_semantic on source_signals (semantic_fingerprint);

create table if not exists automation_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','success','partial','failed','skipped')),
  mode text not null default 'scheduled' check (mode in ('scheduled','manual','dry_run')),
  budget_monthly_usd numeric(10,2) not null default 5,
  budget_remaining_before_usd numeric(10,4) not null default 0,
  estimated_cost_usd numeric(10,6) not null default 0,
  reddit_posts_seen integer not null default 0,
  search_queries_used integer not null default 0,
  search_results_seen integer not null default 0,
  llm_calls_used integer not null default 0,
  signals_inserted integer not null default 0,
  signals_deduped integer not null default 0,
  clusters_promoted integer not null default 0,
  skips jsonb not null default '[]'::jsonb,
  errors jsonb not null default '[]'::jsonb
);

create index if not exists idx_automation_runs_started on automation_runs (started_at desc);
create index if not exists idx_automation_runs_status on automation_runs (status);

alter table automation_runs enable row level security;
