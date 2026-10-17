begin;
select plan(65);

select ok((select relrowsecurity from pg_class where oid = 'public.admin_login_attempts'::regclass), 'login attempts have RLS enabled');
select ok(not has_table_privilege(role_name, 'public.admin_login_attempts', privilege_name), role_name || ' has no ' || privilege_name || ' on login attempts')
from unnest(array['anon', 'authenticated']) role_name
cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) privilege_name;
select ok(has_table_privilege('service_role', 'public.admin_login_attempts', privilege_name), 'service role has ' || privilege_name || ' for reservations')
from unnest(array['SELECT', 'INSERT', 'DELETE']) privilege_name;
select ok(not has_table_privilege('service_role', 'public.admin_login_attempts', 'UPDATE'), 'service role cannot rewrite attempt history');
select ok(not has_function_privilege(role_name, 'public.reserve_admin_login_attempt(text)', 'EXECUTE'), role_name || ' cannot execute the reservation RPC')
from unnest(array['anon', 'authenticated']) role_name;
select ok(has_function_privilege('service_role', 'public.reserve_admin_login_attempt(text)', 'EXECUTE'), 'service role can execute the reservation RPC');
select ok(not (select prosecdef from pg_proc where oid = 'public.reserve_admin_login_attempt(text)'::regprocedure), 'reservation RPC uses caller privileges');
select is((select count(*) from pg_policy where polrelid = 'public.admin_login_attempts'::regclass), 0::bigint, 'no RLS policy exposes login attempts to browsers');

-- All mutations, including fixture isolation, roll back at the end.
delete from public.admin_login_attempts;
set local role service_role;
select throws_ok($$select public.reserve_admin_login_attempt(null)$$, '22023', null, 'missing address hash is rejected');
select throws_ok($$select public.reserve_admin_login_attempt(repeat('A', 64))$$, '22023', null, 'uppercase address hash is rejected');
select throws_ok($$select public.reserve_admin_login_attempt(repeat('a', 63))$$, '22023', null, 'short address hash is rejected');
select throws_ok($$select public.reserve_admin_login_attempt(repeat('g', 64))$$, '22023', null, 'non-hex address hash is rejected');
select is((select count(*) from public.admin_login_attempts), 0::bigint, 'invalid identities create no ledger entries');

select is((public.reserve_admin_login_attempt(repeat('a', 64)) ->> 'allowed')::boolean, true, 'address attempt ' || attempt || ' is accepted')
from generate_series(1, 5) attempt;
select is((select count(*) from public.admin_login_attempts where address_hash = repeat('a', 64)), 5::bigint, 'five address attempts are retained');
select is((public.reserve_admin_login_attempt(repeat('a', 64)) ->> 'allowed')::boolean, false, 'sixth address attempt is denied');
select ok((public.reserve_admin_login_attempt(repeat('a', 64)) ->> 'retry_after')::integer between 1 and 900, 'address denial reports the remaining fifteen-minute window');
select ok(bool_and(not (public.reserve_admin_login_attempt(repeat('a', 64)) ->> 'allowed')::boolean), 'repeated address attempts remain denied')
from generate_series(1, 20);
select is((select count(*) from public.admin_login_attempts), 5::bigint, 'denied address attempts do not grow the ledger');
select is((public.reserve_admin_login_attempt(repeat('b', 64)) ->> 'allowed')::boolean, true, 'another address can reserve below the global limit');

delete from public.admin_login_attempts;
select ok(bool_and((public.reserve_admin_login_attempt(lpad(to_hex(address_number), 64, '0')) ->> 'allowed')::boolean), 'thirty rotated addresses are accepted')
from generate_series(1, 30) address_number;
select is((public.reserve_admin_login_attempt(repeat('c', 64)) ->> 'allowed')::boolean, false, 'thirty-first global attempt is denied');
select ok((public.reserve_admin_login_attempt(repeat('c', 64)) ->> 'retry_after')::integer between 1 and 900, 'global denial reports the remaining fifteen-minute window');
select ok(bool_and(not (public.reserve_admin_login_attempt(lpad(to_hex(address_number), 64, '0')) ->> 'allowed')::boolean), 'additional rotated addresses cannot bypass the global limit')
from generate_series(31, 50) address_number;
select is((select count(*) from public.admin_login_attempts), 30::bigint, 'denied global attempts do not grow the ledger');

delete from public.admin_login_attempts;
insert into public.admin_login_attempts (created_at, address_hash)
select clock_timestamp() - interval '15 minutes', lpad(to_hex(address_number), 64, '0')
from generate_series(1, 30) address_number;
select is((public.reserve_admin_login_attempt(repeat('a', 64)) ->> 'allowed')::boolean, true, 'database-expired global attempts release capacity');
select is((select count(*) from public.admin_login_attempts), 1::bigint, 'expired attempts are pruned before a new reservation');

delete from public.admin_login_attempts;
insert into public.admin_login_attempts (created_at, address_hash)
select clock_timestamp() - interval '15 minutes' + interval '1 second', repeat('a', 64)
from generate_series(1, 5);
select is((public.reserve_admin_login_attempt(repeat('a', 64)) ->> 'allowed')::boolean, false, 'attempts inside the database window still deny admission');
select is((public.reserve_admin_login_attempt(repeat('a', 64)) ->> 'retry_after')::integer, 1, 'subsecond remaining capacity is rounded up');
do $$ begin perform pg_sleep(1.1); end $$;
select is((public.reserve_admin_login_attempt(repeat('a', 64)) ->> 'allowed')::boolean, true, 'expiry follows the database clock inside an unchanged transaction');
select is((select count(*) from public.admin_login_attempts), 1::bigint, 'only the post-expiry reservation remains');
select ok((select created_at > transaction_timestamp() and created_at <= clock_timestamp() from public.admin_login_attempts), 'reservation timestamp comes from the current database clock');

delete from public.admin_login_attempts;
insert into public.admin_login_attempts (created_at, address_hash)
select clock_timestamp() - interval '10 minutes', repeat('a', 64)
from generate_series(1, 5);
insert into public.admin_login_attempts (created_at, address_hash)
select clock_timestamp() - interval '14 minutes', lpad(to_hex(address_number), 64, '0')
from generate_series(1, 25) address_number;
select cmp_ok((public.reserve_admin_login_attempt(repeat('a', 64)) ->> 'retry_after')::integer, '>', 290, 'retry waits for both exhausted limits');
select cmp_ok((public.reserve_admin_login_attempt(repeat('a', 64)) ->> 'retry_after')::integer, '<=', 300, 'retry does not extend the address window');
select ok((public.reserve_admin_login_attempt(repeat('b', 64)) ->> 'retry_after')::integer between 1 and 60, 'a different address waits only for global capacity');
reset role;

set local role anon;
select throws_ok($$select * from public.admin_login_attempts$$, '42501', null, 'anonymous browser cannot read login attempts');
select throws_ok($$insert into public.admin_login_attempts (created_at, address_hash) values (clock_timestamp(), repeat('f', 64))$$, '42501', null, 'anonymous browser cannot add login attempts');
select throws_ok($$update public.admin_login_attempts set created_at = clock_timestamp()$$, '42501', null, 'anonymous browser cannot rewrite login attempts');
select throws_ok($$delete from public.admin_login_attempts$$, '42501', null, 'anonymous browser cannot clear login attempts');
select throws_ok($$select public.reserve_admin_login_attempt(repeat('f', 64))$$, '42501', null, 'anonymous browser cannot call the reservation RPC');
reset role;
set local role authenticated;
select throws_ok($$select * from public.admin_login_attempts$$, '42501', null, 'authenticated browser cannot read login attempts');
select throws_ok($$insert into public.admin_login_attempts (created_at, address_hash) values (clock_timestamp(), repeat('f', 64))$$, '42501', null, 'authenticated browser cannot add login attempts');
select throws_ok($$update public.admin_login_attempts set created_at = clock_timestamp()$$, '42501', null, 'authenticated browser cannot rewrite login attempts');
select throws_ok($$delete from public.admin_login_attempts$$, '42501', null, 'authenticated browser cannot clear login attempts');
select throws_ok($$select public.reserve_admin_login_attempt(repeat('f', 64))$$, '42501', null, 'authenticated browser cannot call the reservation RPC');
reset role;

select * from finish();
rollback;
