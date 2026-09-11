begin;
select plan(4);

select ok(not has_function_privilege('anon', 'public.owner_attention_brief()', 'EXECUTE'), 'anonymous visitors cannot read the private brief');
select ok(not has_function_privilege('authenticated', 'public.owner_attention_brief()', 'EXECUTE'), 'public authenticated accounts cannot read the private brief');
select ok(has_function_privilege('service_role', 'public.owner_attention_brief()', 'EXECUTE'), 'service role retains brief access');

set local role service_role;
select is(public.owner_attention_brief() #>> '{adminAttention,scannerQueuePath}', '/operator?view=scanner', 'the stored brief links to the private scanner workspace');
reset role;

select * from finish();
rollback;
