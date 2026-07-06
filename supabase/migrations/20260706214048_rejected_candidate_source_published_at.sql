alter table automation_rejected_candidates
  add column if not exists source_published_at timestamptz;

create index if not exists idx_rejected_candidates_rescue_memory
  on automation_rejected_candidates (reason, expires_at desc)
  where rescued_at is null;
