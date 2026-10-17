begin;
select no_plan();

select ok((select relrowsecurity from pg_class where oid = 'public.site_problem_reports'::regclass), 'reports have RLS');
select is((select count(*) from pg_policy where polrelid = 'public.site_problem_reports'::regclass), 0::bigint, 'no browser policy exposes reports');
select ok(not has_table_privilege(role_name, 'public.site_problem_reports', privilege_name), role_name || ' has no ' || privilege_name)
from unnest(array['anon', 'authenticated']) role_name
cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) privilege_name;
select ok(not has_function_privilege(role_name, signature, 'EXECUTE'), role_name || ' cannot execute ' || signature)
from unnest(array['anon', 'authenticated']) role_name
cross join unnest(array['public.record_site_problem_report(text,text,text,text,text,text)', 'public.review_site_problem_report(uuid,integer,text,text)']) signature;
select ok(not prosecdef, proname || ' uses invoker permissions') from pg_proc where oid in (
  'public.record_site_problem_report(text,text,text,text,text,text)'::regprocedure,
  'public.review_site_problem_report(uuid,integer,text,text)'::regprocedure
);
select ok(not has_column_privilege('service_role', 'public.site_problem_reports', 'description', 'UPDATE'), 'review cannot rewrite submitted descriptions');
select ok(not has_column_privilege('service_role', 'public.site_problem_reports', 'ip_hash', 'UPDATE'), 'review cannot rewrite rate hashes');
select ok(not has_column_privilege('service_role', 'public.site_problem_reports', 'turnstile_token_hash', 'UPDATE'), 'review cannot rewrite token hashes');
delete from public.site_problem_reports;
set local role service_role;
select throws_ok($$select public.record_site_problem_report('other','hello','https://crimsonreporthub.com/',null,'203.0.113.7',repeat('1',64))$$, '22023', null, 'raw IP is not a valid hash');
select throws_ok($$select public.record_site_problem_report('other','hello','https://crimsonreporthub.com/',null,repeat('a',64),'raw-turnstile-token')$$, '22023', null, 'raw Turnstile token is not a valid hash');
select throws_ok($$select public.record_site_problem_report('remove_content','Remove my video','https://crimsonreporthub.com/watch',null,repeat('a',64),repeat('1',64))$$, '23514', null, 'creator email is required');
select throws_ok($$select public.record_site_problem_report('other',' ','https://crimsonreporthub.com/',null,repeat('a',64),repeat('1',64))$$, '23514', null, 'blank description is rejected');
select throws_ok($$select public.record_site_problem_report('other',repeat('x',2001),'https://crimsonreporthub.com/',null,repeat('a',64),repeat('1',64))$$, '23514', null, 'description cap is enforced');
select throws_ok($$select public.record_site_problem_report('other','A problem','https://crimsonreporthub.com/?private=1',null,repeat('a',64),repeat('1',64))$$, '23514', null, 'URL query strings are not stored');
select is(public.record_site_problem_report('broken_link','A broken source link','https://crimsonreporthub.com/news',null,repeat('a',64),repeat('1',64))->>'outcome','created','first report is saved');
select is((select status from public.site_problem_reports where ip_hash=repeat('a',64)),'new','new reports wait for review');
select is(public.record_site_problem_report('other','Second report','https://crimsonreporthub.com/',null,repeat('a',64),repeat('2',64))->>'outcome','rate_limited','same network cannot report twice');
select ok((public.record_site_problem_report('other','Third report','https://crimsonreporthub.com/',null,repeat('a',64),repeat('3',64))->>'retry_after')::integer between 86390 and 86400,'limit is rolling 24 hours');
select is((select count(*) from public.site_problem_reports),1::bigint,'denials do not add rows');
select is(public.record_site_problem_report('other','Replayed token','https://crimsonreporthub.com/',null,repeat('d',64),repeat('1',64))->>'outcome','replayed','a used token cannot report from another network');
select is((select count(*) from public.site_problem_reports),1::bigint,'a replayed token adds no row');
select is(public.record_site_problem_report('remove_content','Remove my video','https://crimsonreporthub.com/watch','creator@example.test',repeat('b',64),repeat('4',64))->>'outcome','created','different network can submit creator request');
select is(public.review_site_problem_report((select id from public.site_problem_reports where ip_hash=repeat('a',64)),0,'approved','Verified source link')->>'outcome','updated','admin can approve and add private note');
select is((select private_notes->0->>'text' from public.site_problem_reports where ip_hash=repeat('a',64)),'Verified source link','note is private and preserved');
select is(public.review_site_problem_report((select id from public.site_problem_reports where ip_hash=repeat('a',64)),0,'dismissed','Stale write')->>'outcome','conflict','stale update is rejected');
select is((select status from public.site_problem_reports where ip_hash=repeat('a',64)),'approved','stale update cannot overwrite approval');
select is(public.review_site_problem_report((select id from public.site_problem_reports where ip_hash=repeat('a',64)),1,'done','Change approved separately')->>'outcome','updated','review can move to done');
select is((select jsonb_array_length(private_notes) from public.site_problem_reports where ip_hash=repeat('a',64)),2,'notes append without replacing earlier notes');
select is((select description from public.site_problem_reports where ip_hash=repeat('a',64)),'A broken source link','review never changes report content');
select throws_ok($$select public.review_site_problem_report(gen_random_uuid(),0,'published',null)$$,'22023',null,'unsupported status rejected');
select is(public.review_site_problem_report(gen_random_uuid(),0,'dismissed',null)->>'outcome','not_found','missing report is explicit');
reset role;
update public.site_problem_reports set created_at=clock_timestamp()-interval '24 hours' where ip_hash=repeat('a',64);
set local role service_role;
select is(public.record_site_problem_report('other','Later replay','https://crimsonreporthub.com/',null,repeat('a',64),repeat('1',64))->>'outcome','replayed','a used token stays used after the daily window');
select is(public.record_site_problem_report('other','Later report','https://crimsonreporthub.com/',null,repeat('a',64),repeat('5',64))->>'outcome','created','daily capacity returns after expiry');
reset role;
set local role anon;
select throws_ok($$select * from public.site_problem_reports$$,'42501',null,'anonymous browser cannot read email, message or hash');
select throws_ok($$select public.record_site_problem_report('other','test','https://crimsonreporthub.com/',null,repeat('c',64),repeat('6',64))$$,'42501',null,'anonymous browser cannot bypass Turnstile using RPC');
select throws_ok($$select public.review_site_problem_report(gen_random_uuid(),0,'done',null)$$,'42501',null,'anonymous browser cannot review reports');
reset role;
select * from finish();
rollback;
