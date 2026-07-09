alter table issue_clusters
  add column if not exists fix_claimed_at timestamptz,
  add column if not exists admin_override boolean not null default false,
  add column if not exists lifecycle_reason text;

create index if not exists idx_issue_clusters_admin_override
  on issue_clusters (admin_override);

create index if not exists idx_issue_clusters_fix_claimed_at
  on issue_clusters (fix_claimed_at)
  where fix_claimed_at is not null;
