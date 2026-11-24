begin;
select plan(8);

insert into auth.users(id,email) values ('ad120000-0000-4000-8000-000000000001','campaign-admin@mova.invalid');
select public.mova_grant_platform_admin('ad120000-0000-4000-8000-000000000001','Campaign Admin');

set local role service_role;
select public.mova_record_discovery_event('ad120000-0000-4000-8000-000000000010','ad120000-0000-4000-8000-000000000020',
  '/signup','/signup','paid search','google','cpc','aig_pp_search',false,'pricepilot');
select public.mova_record_discovery_event('ad120000-0000-4000-8000-000000000011','ad120000-0000-4000-8000-000000000021',
  '/signup','/signup','paid search','google','cpc','aig_pp_search',false,'second-ad');
select public.mova_record_discovery_event('ad120000-0000-4000-8000-000000000012','ad120000-0000-4000-8000-000000000022',
  '/guides/booth-rent','/guides/booth-rent','other campaign','mova','guide','guides',false,'booth-rent');
select public.mova_record_discovery_event('ad120000-0000-4000-8000-000000000013','ad120000-0000-4000-8000-000000000023',
  '/signup','/signup','paid search','google','cpc','aig_pp_search',false);
reset role;

update public.mova_discovery_visits
set started_at = (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC') - interval '1 hour'
where id in ('ad120000-0000-4000-8000-000000000012','ad120000-0000-4000-8000-000000000013');

insert into auth.users(id,email,created_at,raw_user_meta_data) values (
  'ad120000-0000-4000-8000-000000000002','campaign-stylist@mova.invalid',now(),
  '{"first_name":"Test","last_name":"Stylist","mova_discovery_visit":"ad120000-0000-4000-8000-000000000010"}'
);
update auth.users set email_confirmed_at=now() where id='ad120000-0000-4000-8000-000000000002';

select is((select content from public.mova_discovery_visits where id='ad120000-0000-4000-8000-000000000013'), '', 'existing collection RPC still accepts events');
select ok(not has_function_privilege('authenticated','public.mova_record_discovery_event(uuid,uuid,text,text,text,text,text,text,boolean,text)','EXECUTE'), 'only the service writer can record content');

select set_config('request.jwt.claims','{"sub":"ad120000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select ok(public.mova_admin_discovery()->'today_campaigns' @> '[{"campaign":"aig_pp_search","content":"pricepilot","visits":1,"signups":1}]', 'PricePilot ad receives credit for the verified signup');
select ok(public.mova_admin_discovery()->'today_campaigns' @> '[{"campaign":"aig_pp_search","content":"second-ad","visits":1,"signups":0}]', 'a second ad in the campaign has separate totals');
select ok(public.mova_admin_discovery()->'breakdown' @> '[{"campaign":"guides","content":"booth-rent","visits":1}]', 'a published guide share link has its own content row');
select ok(public.mova_admin_discovery()->'breakdown' @> '[{"kind":"landing","landing_path":"/guides/booth-rent","visits":1}]', 'guide shown as a landing page');
select is(public.mova_admin_discovery() #>> '{current,visits}', '2', 'today does not change the completed-days comparison');
select ok(public.mova_admin_discovery()->'breakdown' @> '[{"campaign":"aig_pp_search","content":"","visits":1}]', 'older campaign visits remain visible without invented ad content');
select * from finish();
rollback;
