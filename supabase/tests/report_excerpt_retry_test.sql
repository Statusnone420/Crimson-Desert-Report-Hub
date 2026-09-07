begin;
select plan(10);
select ok(has_function_privilege('service_role', 'public.save_approved_report_excerpt(uuid,text)', 'EXECUTE'), 'service role can retry');
select ok(not has_function_privilege('anon', 'public.save_approved_report_excerpt(uuid,text)', 'EXECUTE'), 'anonymous cannot retry');
select ok(not has_function_privilege('authenticated', 'public.save_approved_report_excerpt(uuid,text)', 'EXECUTE'), 'authenticated cannot retry');
insert into public.bug_reports (id, patch_version, platform, category, severity, frequency, issue_title, description, moderation_status, duplicate_fingerprint)
values ('99000000-0000-4000-8000-000000000001', '9.9.9', 'pc_steam', 'performance', 'medium', 'often', 'Excerpt retry fixture', 'Private description', 'approved', 'retry-test');
set local role service_role;
select lives_ok($sql$ select public.save_approved_report_excerpt('99000000-0000-4000-8000-000000000001', ' A factual excerpt. ') $sql$, 'approved report accepts excerpt');
select lives_ok($sql$ select public.save_approved_report_excerpt('99000000-0000-4000-8000-000000000001', 'A factual excerpt.') $sql$, 'identical retry succeeds');
select is((select count(*) from public.approved_excerpts where report_id = '99000000-0000-4000-8000-000000000001'), 1::bigint, 'retry does not duplicate the excerpt');
select is((select moderation_status from public.bug_reports where id = '99000000-0000-4000-8000-000000000001'), 'approved', 'retry preserves approval');
select throws_ok($sql$ select public.save_approved_report_excerpt('99000000-0000-4000-8000-000000000001', '') $sql$, '22023', 'excerpt must contain 1 to 500 characters', 'empty excerpt fails');
select throws_ok($sql$ select public.save_approved_report_excerpt('99000000-0000-4000-8000-000000000001', repeat('x',501)) $sql$, '22023', 'excerpt must contain 1 to 500 characters', 'oversized excerpt fails');
update public.bug_reports set moderation_status = 'rejected' where id = '99000000-0000-4000-8000-000000000001';
select throws_ok($sql$ select public.save_approved_report_excerpt('99000000-0000-4000-8000-000000000001', 'A second excerpt.') $sql$, '22023', 'report is missing or no longer approved', 'retry cannot publish a rejected report');
select * from finish();
rollback;
