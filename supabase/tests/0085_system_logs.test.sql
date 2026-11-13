begin;
select plan(14);

insert into auth.users (id,email) values
 ('ad850000-0000-4000-8000-000000000001','logs-admin@mova.invalid'),
 ('ad850000-0000-4000-8000-000000000002','logs-stylist@mova.invalid');
select public.mova_grant_platform_admin('ad850000-0000-4000-8000-000000000001','Logs Admin');
insert into public.mova_artist_businesses(id,name,status) values('ad850000-0000-4000-8000-000000000101','Logs Studio','active');

select ok((select relrowsecurity from pg_class where oid='public.mova_system_logs'::regclass),'system log table has RLS enabled');
select ok(not has_table_privilege('anon','public.mova_system_logs','SELECT'),'anon cannot read system logs');
select ok(not has_table_privilege('authenticated','public.mova_system_logs','SELECT'),'authenticated cannot read system logs directly');

select set_config('request.jwt.claims','{"sub":"ad850000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
select throws_ok($$select public.mova_admin_logs_search()$$,'42501','PLATFORM_ADMIN_REQUIRED','a stylist cannot read system logs');
select throws_ok($$select public.mova_system_log_append('info','web','forbidden.write')$$,'42501',null,'a stylist cannot append system logs');
reset role;

select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is((select count(*)::int from generate_series(1,30) where public.mova_client_log_rate_limit(repeat('a',64))),30,'client logs allow 30 reports in a rolling 10-minute window');
select is(public.mova_client_log_rate_limit(repeat('a',64)),false,'the next client log report is rate-limited');
select lives_ok($$select public.mova_system_log_append('error','function','function.exception','req-0085','booking-create',500,27,null,'ad850000-0000-4000-8000-000000000101',null,'TEST_FAILURE','Sanitized failure','{"provider":"stripe"}'::jsonb)$$,'service role can append a bounded system log');
insert into public.mova_system_logs(level,source,event_name,occurred_at,message) values
 ('info','web','retention.info.old',now()-interval '31 days','old info'),
 ('error','provider','retention.error.old',now()-interval '91 days','old error'),
 ('warning','job','retention.warning.recent',now()-interval '89 days','recent warning');
reset role;
set local role postgres;
select throws_ok($$delete from public.mova_system_logs where event_name='function.exception'$$,'42501','SYSTEM_LOGS_APPEND_ONLY','log rows cannot be deleted outside the retention routine');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is(public.mova_system_logs_cleanup(),2,'retention removes info after 30 days and errors after 90 days');
reset role;

select set_config('request.jwt.claims','{"sub":"ad850000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',true);
set local role authenticated;
select is((public.mova_admin_logs_search(p_source=>'function',p_request_id=>'req-0085')->'rows'->0->>'event_name'),'function.exception','System Admin can filter by source and request ID');
select lives_ok($$select public.mova_admin_logs_exported(1,'text')$$,'System Admin copy/export audit is accepted');
reset role;
select ok((select count(*)>=1 from public.mova_admin_activity where action='logs.viewed') and (select count(*)=1 from public.mova_admin_activity where action='logs.copied'),'admin log reads and copies are recorded in admin activity');
select ok(not exists(select 1 from public.mova_system_logs where event_name='retention.info.old' or event_name='retention.error.old'),'expired entries are absent after cleanup');

select * from finish();
rollback;
