begin;
select plan(18);

insert into auth.users(id,email) values ('ad121000-0000-4000-8000-000000000001','traffic-admin@mova.invalid');
select public.mova_grant_platform_admin('ad121000-0000-4000-8000-000000000001','Traffic Admin');

set local role service_role;
select public.mova_record_website_traffic_event('ad121000-0000-4000-8000-000000000010','ad121000-0000-4000-8000-000000000020',
  '/signup','/signup','paid search','google','aig_pp_search','pricepilot',false,
  '{"visitor":"ad121000-0000-4000-8000-000000000030","device":"Mobile","browser":"Safari","country":"US","referrer":"google.com"}');
select public.mova_record_website_traffic_event('ad121000-0000-4000-8000-000000000010','ad121000-0000-4000-8000-000000000020',
  '/signup','/signup','paid search','google','aig_pp_search','pricepilot',false,
  '{"visitor":"ad121000-0000-4000-8000-000000000030","device":"Mobile","browser":"Safari","country":"US","referrer":"google.com"}');
select public.mova_record_website_traffic_event('ad121000-0000-4000-8000-000000000011','ad121000-0000-4000-8000-000000000021',
  '/pricing','/pricing','direct / unknown','','','',false,
  '{"visitor":"ad121000-0000-4000-8000-000000000030","device":"Mobile","browser":"Safari","country":"US"}');
select public.mova_record_website_traffic_event('ad121000-0000-4000-8000-000000000012','ad121000-0000-4000-8000-000000000022',
  '/guides/booth-rent','/guides/booth-rent','referral','example.org','','',false,
  '{"visitor":"ad121000-0000-4000-8000-000000000031","device":"Desktop","browser":"Firefox","country":"CA","referrer":"example.org"}');
select public.mova_record_discovery_event('ad121000-0000-4000-8000-000000000013','ad121000-0000-4000-8000-000000000023',
  '/calculator','/calculator','direct / unknown','','','',false);
reset role;

update public.mova_discovery_visitors
set first_seen_at = now() - interval '25 hours'
where id = 'ad121000-0000-4000-8000-000000000031';
insert into auth.users(id,email,created_at,raw_user_meta_data) values (
  'ad121000-0000-4000-8000-000000000002','traffic-stylist@mova.invalid',now(),
  '{"first_name":"Test","last_name":"Stylist","mova_discovery_visit":"ad121000-0000-4000-8000-000000000010"}'
);
update auth.users set email_confirmed_at=now() where id='ad121000-0000-4000-8000-000000000002';

select ok(not has_table_privilege('authenticated','public.mova_discovery_visitors','SELECT'), 'browser identifiers are private');
select ok(not has_function_privilege('authenticated','public.mova_record_website_traffic_event(uuid,uuid,text,text,text,text,text,text,boolean,jsonb)','EXECUTE'), 'visitor events only use service writer');
select set_config('request.jwt.claims','{"sub":"ad121000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select throws_ok('select public.mova_admin_website_traffic()', '42501', 'PLATFORM_ADMIN_REQUIRED', 'regular stylists cannot see platform traffic');
reset role;
select set_config('request.jwt.claims','{"sub":"ad121000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select is(public.mova_admin_website_traffic() #>> '{current,sessions}', '4', 'the default report includes today and older clients');
select is(public.mova_admin_website_traffic('24h') #>> '{current,visitors}', '2', 'two sessions for one browser count as one visitor');
select is(public.mova_admin_website_traffic('24h') #>> '{current,identified_sessions}', '3', 'legacy sessions count separately from visitors');
select is(public.mova_admin_website_traffic('24h') #>> '{current,new_users}', '1', 'new visitor first seen within the range');
select is(public.mova_admin_website_traffic('24h') #>> '{current,returning_users}', '1', 'returning visitor first seen before the range');
select is(public.mova_admin_website_traffic('24h') #>> '{current,page_views}', '4', 'replayed view does not inflate the total');
select is(public.mova_admin_website_traffic('24h') #>> '{current,signups}', '1', 'verified signup is tied to its session');
select ok(public.mova_admin_website_traffic('24h')->'breakdown' @> '[{"kind":"campaign","label":"aig_pp_search / pricepilot","signups":1}]', 'PricePilot campaign and content receive signup credit');
select ok(public.mova_admin_website_traffic('24h')->'breakdown' @> '[{"kind":"landing","label":"/guides/booth-rent","sessions":1}]', 'guide appears without UTMs');
select ok(public.mova_admin_website_traffic('24h')->'breakdown' @> '[{"kind":"referrer","label":"example.org","sessions":1}]', 'referrer host reported separately');
select ok(public.mova_admin_website_traffic('24h')->'breakdown' @> '[{"kind":"device","label":"Mobile","sessions":2}]', 'device aggregates include repeat sessions');
select ok(public.mova_admin_website_traffic('24h')->'breakdown' @> '[{"kind":"browser","label":"Firefox","sessions":1}]', 'browser family reported');
select ok(public.mova_admin_website_traffic('24h')->'breakdown' @> '[{"kind":"country","label":"US","sessions":2}]', 'country code is the geographic dimension');
select is(public.mova_admin_website_traffic('custom', (now() at time zone 'UTC')::date, (now() at time zone 'UTC')::date) #>> '{current,sessions}', '4', 'same-day custom period includes current traffic');
select throws_ok($$select public.mova_admin_website_traffic('custom', current_date, current_date - 1)$$, '22023', 'TRAFFIC_DATE_RANGE_INVALID', 'reversed custom dates are refused');
select * from finish();
rollback;
