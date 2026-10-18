-- One row holds the admin login generation. Every signed admin session carries
-- the generation it was issued under, and only the current generation is
-- accepted. "Sign out everywhere" moves to the next generation, which ends
-- every earlier session at once, the owner's and any agent's alike.
create table public.admin_session_state (
  id boolean primary key default true check (id),
  generation integer not null default 1 check (generation > 0)
);
insert into public.admin_session_state (id) values (true);
alter table public.admin_session_state enable row level security;
revoke all on public.admin_session_state from public, anon, authenticated, service_role;
grant select, update on public.admin_session_state to service_role;

create function public.admin_session_generation()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select generation from public.admin_session_state where id;
$$;

create function public.revoke_admin_sessions()
returns integer
language sql
security invoker
set search_path = ''
as $$
  update public.admin_session_state set generation = generation + 1 where id returning generation;
$$;

revoke all on function public.admin_session_generation() from public, anon, authenticated;
revoke all on function public.revoke_admin_sessions() from public, anon, authenticated;
grant execute on function public.admin_session_generation() to service_role;
grant execute on function public.revoke_admin_sessions() to service_role;
