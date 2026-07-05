create table if not exists official_patch_notes (
  id uuid primary key default gen_random_uuid(),
  board_no text not null unique,
  title text not null,
  patch_version text not null,
  official_url text not null,
  published_at timestamptz,
  summary text,
  observed_at timestamptz not null default now(),
  is_current boolean not null default false
);

create unique index if not exists idx_official_patch_notes_current
  on official_patch_notes (is_current)
  where is_current;

create index if not exists idx_official_patch_notes_published
  on official_patch_notes (published_at desc);

alter table official_patch_notes enable row level security;

drop policy if exists deny_all_public_access on official_patch_notes;
create policy deny_all_public_access
  on official_patch_notes
  for all
  to anon, authenticated
  using (false)
  with check (false);

revoke all on official_patch_notes from anon, authenticated;
grant select, insert, update, delete on official_patch_notes to service_role;
