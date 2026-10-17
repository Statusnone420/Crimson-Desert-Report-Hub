create table if not exists automation_rejected_candidates (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references automation_runs(id) on delete cascade,
  title text not null,
  url text not null,
  source_domain text,
  snippet text,
  reason text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  rescued_at timestamptz
);

create index if not exists idx_rejected_candidates_created on automation_rejected_candidates (created_at desc);

alter table automation_rejected_candidates enable row level security;
