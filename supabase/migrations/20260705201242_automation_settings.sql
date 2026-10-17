create table if not exists automation_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into automation_settings (key, value)
values ('scanner', '{"paused": false}'::jsonb)
on conflict (key) do nothing;

alter table automation_settings enable row level security;

grant select, insert, update, delete on automation_settings to service_role;

drop policy if exists deny_all_public_access on automation_settings;
create policy deny_all_public_access on automation_settings
  for all to anon, authenticated
  using (false)
  with check (false);
