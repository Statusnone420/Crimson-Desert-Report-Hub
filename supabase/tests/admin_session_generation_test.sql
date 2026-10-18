begin;
select plan(32);

select ok((select relrowsecurity from pg_class where oid = 'public.admin_session_state'::regclass), 'admin session state has RLS enabled');
select is((select count(*) from pg_policy where polrelid = 'public.admin_session_state'::regclass), 0::bigint, 'no RLS policy exposes the session generation to browsers');
select ok(not has_table_privilege(role_name, 'public.admin_session_state', privilege_name), role_name || ' has no ' || privilege_name || ' on admin session state')
from unnest(array['anon', 'authenticated']) role_name
cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) privilege_name;
select ok(has_table_privilege('service_role', 'public.admin_session_state', privilege_name), 'service role has ' || privilege_name || ' on admin session state')
from unnest(array['SELECT', 'UPDATE']) privilege_name;
select ok(not has_table_privilege('service_role', 'public.admin_session_state', privilege_name), 'service role cannot ' || privilege_name || ' admin session state rows')
from unnest(array['INSERT', 'DELETE', 'TRUNCATE']) privilege_name;
select ok(not has_function_privilege(role_name, function_name, 'EXECUTE'), role_name || ' cannot execute ' || function_name)
from unnest(array['anon', 'authenticated']) role_name
cross join unnest(array['public.admin_session_generation()', 'public.revoke_admin_sessions()']) function_name;
select ok(has_function_privilege('service_role', function_name, 'EXECUTE'), 'service role can execute ' || function_name)
from unnest(array['public.admin_session_generation()', 'public.revoke_admin_sessions()']) function_name;
select ok(not (select prosecdef from pg_proc where oid = function_name::regprocedure), function_name || ' uses caller privileges')
from unnest(array['public.admin_session_generation()', 'public.revoke_admin_sessions()']) function_name;

select is((select count(*) from public.admin_session_state), 1::bigint, 'exactly one generation row exists');
select throws_ok($$insert into public.admin_session_state (id) values (false)$$, '23514', null, 'a second generation row is refused');

-- All changes roll back at the end.
set local role service_role;
select is(public.admin_session_generation(), 1, 'sessions start at generation 1');
select is(public.revoke_admin_sessions(), 2, 'signing out everywhere moves to the next generation');
select is(public.admin_session_generation(), 2, 'the new generation is the current one');
select is(public.revoke_admin_sessions(), 3, 'each sign-out-everywhere moves on again');
select throws_ok($$update public.admin_session_state set generation = 0$$, '23514', null, 'the generation cannot drop below 1');

select * from finish();
rollback;
