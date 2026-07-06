create table if not exists official_patch_claimed_fixes (
  id uuid primary key default gen_random_uuid(),
  board_no text not null,
  position integer not null,
  fix_text text not null,
  category text,
  created_at timestamptz not null default now(),
  unique (board_no, position)
);

alter table official_patch_claimed_fixes enable row level security;
