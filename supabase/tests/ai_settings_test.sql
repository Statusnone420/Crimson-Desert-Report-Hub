begin;
select no_plan();

select ok((select bool_and(relrowsecurity) from pg_class where oid in (
  'public.ai_settings_state'::regclass, 'public.ai_connections'::regclass,
  'public.ai_test_operations'::regclass, 'public.ai_model_tests'::regclass,
  'public.ai_settings_events'::regclass)), 'every AI table has RLS');
select ok(not has_table_privilege(role_name, table_name, 'SELECT,INSERT,UPDATE,DELETE'),
  role_name || ' cannot access ' || table_name)
from unnest(array['anon', 'authenticated']) role_name
cross join unnest(array['ai_settings_state','ai_connections','ai_test_operations','ai_model_tests','ai_settings_events']) table_name;
select ok(not has_function_privilege(role_name, function_name, 'EXECUTE'), role_name || ' cannot call ' || function_name)
from unnest(array['anon', 'authenticated']) role_name
cross join unnest(array['ai_settings_save(integer,jsonb)','ai_connection_save(text,integer)',
  'ai_settings_activate(integer,uuid,text)','ai_test_reserve(uuid,numeric)','ai_test_settle(uuid,text,numeric)']) function_name;
select ok(not has_table_privilege('service_role','ai_model_tests','UPDATE,DELETE'), 'receipts are append-only for service');
select ok(not has_table_privilege('service_role','ai_settings_events','UPDATE,DELETE'), 'activity is append-only for service');

set local role service_role;
select throws_ok($$select public.ai_settings_activate(0,null,'rollback')$$,
  '55000','ai_test_required','unmodified legacy configuration has nothing to roll back');
select is((public.ai_settings_save(0, '{"monthlyUsd":0.02,"requestUsd":0.01,"recovery":"next_scan"}')->>'revision')::integer,
  1, 'policy compare-and-swap increments revision');
select throws_ok($$select public.ai_settings_save(0, '{"monthlyUsd":1,"requestUsd":0.01,"recovery":"next_scan"}')$$,
  '40001','ai_settings_revision_conflict','stale policy revision rejected');
select throws_ok($$select public.ai_settings_save(1, '{"monthlyUsd":1001,"requestUsd":0.01,"recovery":"next_scan"}')$$,
  '22023','ai_invalid_policy','monthly cap bounded');
select throws_ok($$select public.ai_settings_save(1, '{"monthlyUsd":1,"requestUsd":0,"recovery":"next_scan"}')$$,
  '22023','ai_invalid_policy','request cap positive');
select throws_ok($$select public.ai_settings_save(1, '{"monthlyUsd":1,"requestUsd":1.01,"recovery":"next_scan"}')$$,
  '22023','ai_invalid_policy','request cap bounded');
select throws_ok($$select public.ai_settings_save(1, '{"monthlyUsd":1,"requestUsd":0.01,"recovery":"backup"}')$$,
  '22023','ai_invalid_policy','backup recovery requires activated backup');
select throws_ok($$select public.ai_settings_save(1, '{"monthlyUsd":null,"requestUsd":0.01,"recovery":"next_scan"}')$$,
  '22023','ai_invalid_policy','missing numeric policy rejected');
select is(public.ai_test_reserve('00000000-0000-0000-0000-000000000020',0)->>'firstAcknowledgement', 'true',
  'zero-cost test may dispatch with positive monthly allowance');
select is(public.ai_test_reserve('00000000-0000-0000-0000-000000000020',0)->>'firstAcknowledgement', 'false',
  'zero-cost reservation cannot dispatch twice');
select public.ai_test_settle('00000000-0000-0000-0000-000000000020','verified',0);
select is((public.scanner_budget_summary()->>'llmCostUsd')::numeric,0::numeric,'verified free test consumes no paid allowance');
select throws_ok($$select public.ai_test_reserve('00000000-0000-0000-0000-000000000020',0.001)$$,
  '22023','ai_reservation_conflict','free-test identity cannot be reused for a paid reservation');

select is(public.ai_test_reserve('00000000-0000-0000-0000-000000000001',0.01)->>'firstAcknowledgement', 'true', 'first reservation authorizes one dispatch');
select is(public.ai_test_reserve('00000000-0000-0000-0000-000000000001',0.01)->>'firstAcknowledgement', 'false', 'reservation replay cannot dispatch twice');
select throws_ok($$select public.ai_test_reserve('00000000-0000-0000-0000-000000000001',0.009)$$,
  '22023','ai_reservation_conflict','reservation ID cannot change amount');
select throws_ok($$select public.ai_test_reserve('00000000-0000-0000-0000-000000000003',0.010000001)$$,
  '55000','ai_spending_blocked','test cannot exceed one cent');
select throws_ok($$select public.ai_test_reserve('00000000-0000-0000-0000-000000000003','NaN'::numeric)$$,
  '22023','ai_invalid_reserve','nonfinite reservation rejected');
select lives_ok($$select public.ai_test_reserve('00000000-0000-0000-0000-000000000002',0.01)$$, 'exact remaining monthly amount admitted');
select throws_ok($$select public.ai_test_reserve('00000000-0000-0000-0000-000000000003',0.000000001)$$,
  '55000','ai_spending_blocked','third reservation cannot overspend shared monthly cap');
select is((public.scanner_budget_summary()->>'llmCostUsd')::numeric,0.02::numeric,'test reservations enter scanner total once');
select is((public.scanner_budget_summary()->>'uncertainUsd')::numeric,0.02::numeric,'reserved tests are uncertain');
select lives_ok($$select public.ai_test_settle('00000000-0000-0000-0000-000000000001','verified',0.003)$$, 'verified settlement releases unused reservation');
select lives_ok($$select public.ai_test_settle('00000000-0000-0000-0000-000000000001','verified',0.003)$$, 'same settlement replay is idempotent');
select throws_ok($$select public.ai_test_settle('00000000-0000-0000-0000-000000000001','verified',0.002)$$,
  '22023','ai_settlement_conflict','settled cost immutable');
select lives_ok($$select public.ai_test_settle('00000000-0000-0000-0000-000000000002','unknown',null)$$, 'unknown dispatch retains reservation');
select throws_ok($$select public.ai_test_settle('00000000-0000-0000-0000-000000000002','not_sent',0)$$,
  '22023','ai_settlement_conflict','unknown charge cannot be refunded by retry');
select is((public.scanner_budget_summary()->>'confirmedUsd')::numeric,0.003::numeric,'verified test is confirmed');
select is((public.scanner_budget_summary()->>'uncertainUsd')::numeric,0.01::numeric,'unknown test retains full ceiling');
select is((public.scanner_budget_summary()->>'llmCostUsd')::numeric,0.013::numeric,'settled and unknown amounts not double-counted');
select is((public.scanner_budget_summary(clock_timestamp()+interval '1 month')->>'llmCostUsd')::numeric,0::numeric,'unknown test debt stops counting at month rollover');
select is((public.scanner_budget_summary(clock_timestamp()+interval '1 month')->>'confirmedUsd')::numeric,0::numeric,'prior verified test is not charged in new month');

-- The service stores only the application-sanitized receipt, after settlement.
insert into public.ai_model_tests(id,profile,fingerprint,result) values
('00000000-0000-0000-0000-000000000001',
 '{"provider":"openrouter","modelId":"fixture/model-a","reasoning":"none","retention":"standard","maxOutputTokens":400,"connectionVersion":0,"metadata":{}}', repeat('a',64), '{"passed":true}');
select throws_ok($$select public.ai_settings_activate(0,'00000000-0000-0000-0000-000000000001','primary')$$,
  '40001','ai_settings_revision_conflict','activation rejects stale revision');
select throws_ok($$select public.ai_settings_activate(1,'00000000-0000-0000-0000-000000000099','primary')$$,
  '55000','ai_test_required','activation requires test receipt');

-- Saving dashboard policy alone must not change the scanner's historical caps.
select public.ai_settings_save(1,'{"monthlyUsd":10,"requestUsd":0.2,"recovery":"next_scan"}');
select is(public.scanner_admit_run('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','manual',
  clock_timestamp()+interval '2 minutes',clock_timestamp()+interval '3 minutes',
  '{"monthlyLlmUsdCap":10,"remainingMonthUsd":10,"remainingLlmUsd":5,"maxTavilyCreditsPerRun":10,"maxLlmCalls":10}','{}')->>'status',
  'admitted','legacy scanner admission works before activation');
select is((select budget_monthly_usd::numeric from public.automation_runs where id='10000000-0000-0000-0000-000000000001'),1::numeric,'legacy scanner monthly hard cap retained');
select is((select run_llm_cap_usd from public.automation_runs where id='10000000-0000-0000-0000-000000000001'),1::numeric,'legacy scanner run hard cap retained');
select throws_ok($$select public.scanner_reserve_operation('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001','extraction',repeat('b',64),1.1,0)$$,
  '55000','scanner_spending_blocked','dashboard policy cannot raise legacy scanner cap before activation');
update public.automation_runs set status='success' where id='10000000-0000-0000-0000-000000000001';

select is(public.ai_settings_activate(2,'00000000-0000-0000-0000-000000000001','primary')->'active'->>'modelId',
  'fixture/model-a','current passing environment-credential test activates primary');
select is((public.ai_settings_activate(3,null,'rollback')->>'revision')::integer,4,
  'first activation rollback increments revision');
select is((select configuration->'active' from public.ai_settings_state where id),'null'::jsonb,
  'first activation rollback restores legacy configuration');
select is((select configuration->'previous'->>'modelId' from public.ai_settings_state where id),'fixture/model-a',
  'legacy rollback retains displaced profile for undo');
select is((select detail from public.ai_settings_events where action='primary_rolled_back' order by created_at desc limit 1),
  'Legacy scanner configuration restored.','legacy rollback records activity');
select is((public.scanner_budget_summary()->>'llmCostUsd')::numeric,0.013::numeric,
  'legacy rollback retains shared test charges');
select is(public.scanner_admit_run('10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000003','manual',
  clock_timestamp()+interval '2 minutes',clock_timestamp()+interval '3 minutes',
  '{"monthlyLlmUsdCap":10,"remainingMonthUsd":10,"remainingLlmUsd":5,"maxTavilyCreditsPerRun":10,"maxLlmCalls":10}','{}')->>'status',
  'admitted','legacy scanner can run after rollback');
select is((select budget_monthly_usd::numeric from public.automation_runs where id='10000000-0000-0000-0000-000000000003'),
  1::numeric,'rollback restores legacy one-dollar monthly hard cap');
select is((select run_llm_cap_usd from public.automation_runs where id='10000000-0000-0000-0000-000000000003'),
  1::numeric,'rollback restores legacy one-dollar run hard cap');
select throws_ok($$select public.scanner_reserve_operation('10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000003',
  '30000000-0000-0000-0000-000000000003','extraction',repeat('b',64),0.488,0)$$,
  '55000','scanner_spending_blocked','rolled-back scanner shares test charges under original monthly policy');
update public.automation_runs set status='success' where id='10000000-0000-0000-0000-000000000003';
select is(public.ai_settings_activate(4,null,'rollback')->'active'->>'modelId','fixture/model-a',
  'legacy rollback can itself be undone with a valid profile generation');
select is(public.scanner_admit_run('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','manual',
  clock_timestamp()+interval '2 minutes',clock_timestamp()+interval '3 minutes',
  '{"monthlyLlmUsdCap":10,"remainingMonthUsd":10,"remainingLlmUsd":5,"maxTavilyCreditsPerRun":10,"maxLlmCalls":10}','{}')->>'status',
  'admitted','configured scanner admission works after activation');
select is((select budget_monthly_usd::numeric from public.automation_runs where id='10000000-0000-0000-0000-000000000002'),10::numeric,'activated monthly policy replaces legacy hard cap');
select is((select run_llm_cap_usd from public.automation_runs where id='10000000-0000-0000-0000-000000000002'),5::numeric,'activated scanner run may exceed legacy dollar cap');
select throws_ok($$select public.scanner_reserve_operation('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002',
  '30000000-0000-0000-0000-000000000002','extraction',repeat('b',64),0.21,0)$$,
  '55000','scanner_spending_blocked','configured request cap is enforced in SQL');
select lives_ok($$select public.scanner_reserve_operation('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002',
  '30000000-0000-0000-0000-000000000002','extraction',repeat('b',64),0.2,0)$$,'request at configured cap admitted');
select is((public.scanner_budget_summary()->>'llmCostUsd')::numeric,0.213::numeric,'scanner and test commitments share one total');
select public.scanner_settle_operation('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002',
  '30000000-0000-0000-0000-000000000002','verified',0.1,0);
select is((public.scanner_budget_summary()->>'confirmedUsd')::numeric,0.103::numeric,'scanner and tests share confirmed total');

select public.ai_settings_activate(5,'00000000-0000-0000-0000-000000000001','backup');
select lives_ok($$select public.ai_settings_save(6,'{"monthlyUsd":10,"requestUsd":0.2,"recovery":"backup"}')$$,'validated backup permits recovery policy');
select is(public.ai_connection_save('fixture-ciphertext-not-a-secret',0),'{"version":1}'::jsonb,'connection returns generation only');
select throws_ok($$select public.ai_connection_save('other-fixture',0)$$,
  '40001','ai_connection_version_conflict','credential update rejects stale generation');
select throws_ok($$select public.ai_settings_activate(7,'00000000-0000-0000-0000-000000000001','primary')$$,
  '55000','ai_connection_changed','credential rotation invalidates old successful test');
select public.ai_test_reserve('00000000-0000-0000-0000-000000000003',0.01);
select public.ai_test_settle('00000000-0000-0000-0000-000000000003','verified',0.001);
insert into public.ai_model_tests(id,profile,fingerprint,result) values
('00000000-0000-0000-0000-000000000003',
 '{"provider":"openrouter","modelId":"fixture/model-b","connectionVersion":1}', repeat('b',64), '{"passed":true}');
select is(public.ai_settings_activate(7,'00000000-0000-0000-0000-000000000003','primary')->'previous'->>'modelId',
  'fixture/model-a','new primary preserves previous primary');
select throws_ok($$select public.ai_settings_activate(8,null,'rollback')$$,
  '55000','ai_connection_changed','rollback cannot restore stale credential generation');
select public.ai_test_reserve('00000000-0000-0000-0000-000000000004',0.01);
select public.ai_test_settle('00000000-0000-0000-0000-000000000004','verified',0.001);
insert into public.ai_model_tests(id,profile,fingerprint,result) values
('00000000-0000-0000-0000-000000000004',
 '{"provider":"openrouter","modelId":"fixture/model-c","connectionVersion":1}', repeat('c',64), '{"passed":true}');
select public.ai_settings_activate(8,'00000000-0000-0000-0000-000000000004','primary');
select is(public.ai_settings_activate(9,null,'rollback')->'active'->>'modelId', 'fixture/model-b','rollback restores previous with valid generation');

select public.ai_test_reserve('00000000-0000-0000-0000-000000000005',0.01);
select public.ai_test_settle('00000000-0000-0000-0000-000000000005','verified',0.001);
insert into public.ai_model_tests(id,profile,fingerprint,result,created_at) values
('00000000-0000-0000-0000-000000000005',
 '{"provider":"openrouter","modelId":"fixture/expired","connectionVersion":1}', repeat('d',64), '{"passed":true}',clock_timestamp()-interval '25 hours');
select throws_ok($$select public.ai_settings_activate(10,'00000000-0000-0000-0000-000000000005','primary')$$,
  '55000','ai_test_required','expired passing test rejected');
select public.ai_test_reserve('00000000-0000-0000-0000-000000000006',0.01);
select public.ai_test_settle('00000000-0000-0000-0000-000000000006','unknown',null);
insert into public.ai_model_tests(id,profile,fingerprint,result) values
('00000000-0000-0000-0000-000000000006',
 '{"provider":"openrouter","modelId":"fixture/unknown","connectionVersion":1}', repeat('e',64), '{"passed":true}');
select throws_ok($$select public.ai_settings_activate(10,'00000000-0000-0000-0000-000000000006','primary')$$,
  '55000','ai_test_required','unknown billed test cannot activate');

select public.ai_test_reserve('00000000-0000-0000-0000-000000000010',0.01);
select public.ai_test_settle('00000000-0000-0000-0000-000000000010','verified',0.0000000001);
select is((select settled_usd from public.ai_test_operations where id='00000000-0000-0000-0000-000000000010'),
  0.000000001::numeric,'fractional nanodollar cost rounds upward');
select lives_ok($$select public.ai_test_settle('00000000-0000-0000-0000-000000000010','verified',0.0000000001)$$,
  'fractional provider cost can replay after storage precision rounding');
insert into public.ai_model_tests(id,profile,fingerprint,result) values
('00000000-0000-0000-0000-000000000010',
 '{"provider":"openrouter","modelId":"fixture/failed","connectionVersion":1}', repeat('f',64), '{"passed":false}');
select throws_ok($$select public.ai_settings_activate(10,'00000000-0000-0000-0000-000000000010','primary')$$,
  '55000','ai_test_required','failed test cannot activate');

insert into public.automation_runs(id,status,started_at) values
  ('40000000-0000-0000-0000-000000000001','failed',clock_timestamp()-interval '1 month');
insert into public.scanner_legacy_debt(run_id,budget_month) values
  ('40000000-0000-0000-0000-000000000001',date_trunc('month',clock_timestamp()-interval '1 month')::date);
select throws_ok($$select public.ai_test_reserve('00000000-0000-0000-0000-000000000009',0.001)$$,
  '55000','ai_spending_blocked','unreconciled unbounded legacy debt blocks tests');
update public.scanner_legacy_debt set resolved=true where run_id='40000000-0000-0000-0000-000000000001';
update public.automation_runs set skips='["openrouter_unexpected_charge"]',started_at=clock_timestamp()
  where id='40000000-0000-0000-0000-000000000001';
select throws_ok($$select public.ai_test_reserve('00000000-0000-0000-0000-000000000009',0.001)$$,
  '55000','ai_spending_blocked','existing scanner unexpected-charge circuit also blocks tests');
update public.automation_runs set skips='[]' where id='40000000-0000-0000-0000-000000000001';

select public.ai_test_reserve('00000000-0000-0000-0000-000000000007',0.01);
select public.ai_test_settle('00000000-0000-0000-0000-000000000007','not_sent',0);
select is((select settled_usd from public.ai_test_operations where id='00000000-0000-0000-0000-000000000007'),0::numeric,'definitely unsent request has no spend');
select public.ai_test_reserve('00000000-0000-0000-0000-000000000008',0.01);
select public.ai_test_reserve('00000000-0000-0000-0000-000000000021',0);
select is(public.ai_test_settle('00000000-0000-0000-0000-000000000021','verified',0.001)->>'anomalous','true',
  'unexpected charge on a free reservation opens spending circuit');
select is(public.ai_test_settle('00000000-0000-0000-0000-000000000008','verified',0.02)->>'anomalous','true','overcharge is recorded, not truncated');
select is(public.scanner_budget_summary()->>'paidSpendingAnomaly','true','test overcharge opens shared anomaly circuit');
select throws_ok($$select public.ai_test_reserve('00000000-0000-0000-0000-000000000009',0.001)$$,
  '55000','ai_spending_blocked','test anomaly blocks further paid tests');
select throws_ok($$select public.ai_test_reserve('00000000-0000-0000-0000-000000000022',0)$$,
  '55000','ai_spending_blocked','zero-cost reservation cannot bypass an open spending circuit');
reset role;

select * from finish();
rollback;
