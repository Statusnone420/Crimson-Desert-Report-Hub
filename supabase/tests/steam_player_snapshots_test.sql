begin;
select plan(26);

select ok((select relrowsecurity from pg_class where oid='public.steam_player_snapshots'::regclass), 'RLS is enabled');
select ok(not has_table_privilege(role_name, 'public.steam_player_snapshots', privilege_name), role_name || ' has no ' || privilege_name)
from unnest(array['anon','authenticated']) role_name
cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) privilege_name;
select ok(has_table_privilege('service_role','public.steam_player_snapshots','SELECT'), 'service can read aggregates');
select ok(has_table_privilege('service_role','public.steam_player_snapshots','INSERT'), 'service can append aggregates');
select ok(not has_table_privilege('service_role','public.steam_player_snapshots','UPDATE'), 'service cannot replace history');
select ok(not has_table_privilege('service_role','public.steam_player_snapshots','DELETE'), 'service cannot remove history');

set local role service_role;
select lives_ok($$insert into public.steam_player_snapshots values ('2026-09-05T12:00Z','2026-09-05T12:05Z',0)$$, 'valid zero is retained');
select lives_ok($$insert into public.steam_player_snapshots values ('2026-09-05T12:00Z','2026-09-05T12:10Z',999) on conflict(sample_hour) do nothing$$, 'duplicate hour can be ignored without update grants');
select is((select player_count from public.steam_player_snapshots where sample_hour='2026-09-05T12:00Z'),0,'duplicate hour does not replace first count');
select lives_ok($$insert into public.steam_player_snapshots values ('2026-09-05T13:00Z','2026-09-05T13:05Z',12345)$$,'another hour retains another reading');
select is((select count(*) from public.steam_player_snapshots),2::bigint,'two hours retain two samples');
select throws_ok($$insert into public.steam_player_snapshots values ('2026-09-05T14:00Z','2026-09-05T14:05Z',-1)$$,'23514',null,'negative counts rejected');
select throws_ok($$insert into public.steam_player_snapshots values ('2026-09-05T14:00Z','2026-09-05T15:05Z',1)$$,'23514',null,'incorrect hour bucket rejected');
select throws_ok($$insert into public.steam_player_snapshots values ('2026-09-05T14:00Z',null,1)$$,'23502',null,'missing timestamp rejected');
select throws_ok($$insert into public.steam_player_snapshots values ('infinity','infinity',1)$$,'23514',null,'infinite timestamp rejected');
reset role;

set local role anon;
select throws_ok($$select * from public.steam_player_snapshots$$,'42501',null,'anon cannot read provider table');
reset role;
set local role authenticated;
select throws_ok($$select * from public.steam_player_snapshots$$,'42501',null,'authenticated cannot read provider table');
reset role;
set local role anon;
select throws_ok($$insert into public.steam_player_snapshots values ('2026-09-05T14:00Z','2026-09-05T14:05Z',1)$$,'42501',null,'anon cannot add readings');
reset role;
set local role authenticated;
select throws_ok($$insert into public.steam_player_snapshots values ('2026-09-05T14:00Z','2026-09-05T14:05Z',1)$$,'42501',null,'authenticated cannot add readings');
reset role;

select * from finish();
rollback;
