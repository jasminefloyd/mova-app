begin;
select plan(5);

insert into auth.users(id,email) values ('ad122000-0000-4000-8000-000000000001','geo-admin@mova.invalid');
select public.mova_grant_platform_admin('ad122000-0000-4000-8000-000000000001','Geo Admin');

set local role service_role;
select public.mova_record_website_traffic_event('ad122000-0000-4000-8000-000000000010','ad122000-0000-4000-8000-000000000020',
  '/signup','/signup','paid search','google','aig_pp_search','pricepilot',false,
  '{"visitor":"ad122000-0000-4000-8000-000000000030","device":"Mobile","browser":"Safari","country":"US"}');
select public.mova_record_website_traffic_event('ad122000-0000-4000-8000-000000000010','ad122000-0000-4000-8000-000000000021',
  '/signup','/signup','paid search','google','aig_pp_search','pricepilot',false,
  '{"visitor":"ad122000-0000-4000-8000-000000000030","device":"Mobile","browser":"Safari","country":"CA","region":"ON","city":"Toronto"}');
select public.mova_record_website_traffic_event('ad122000-0000-4000-8000-000000000010','ad122000-0000-4000-8000-000000000022',
  '/signup','/signup','paid search','google','aig_pp_search','pricepilot',false,
  '{"visitor":"ad122000-0000-4000-8000-000000000030","device":"Mobile","browser":"Safari","country":"US","region":"NY","city":"Brooklyn"}');
select public.mova_record_website_traffic_event('ad122000-0000-4000-8000-000000000011','ad122000-0000-4000-8000-000000000023',
  '/pricing','/pricing','direct / unknown','','','',false, '{"country":"CA"}');
select public.mova_record_discovery_event('ad122000-0000-4000-8000-000000000012','ad122000-0000-4000-8000-000000000024',
  '/calculator','/calculator','direct / unknown','','','',false);
reset role;

select set_config('request.jwt.claims','{"sub":"ad122000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select ok(public.mova_admin_website_traffic('24h')->'geography' @> '[{"city":"Brooklyn","region":"NY","country":"US","sessions":1,"visitors":1}]', 'fills in city and state from a matching country and keeps the same session');
select ok(not (public.mova_admin_website_traffic('24h')->'geography' @> '[{"city":"Toronto"}]'), 'a mismatching country cannot change the location of an existing session');
select ok(public.mova_admin_website_traffic('24h')->'geography' @> '[{"city":"","region":"","country":"CA","sessions":1}]', 'country-only sessions stay visible');
select ok(public.mova_admin_website_traffic('24h')->'geography' @> '[{"city":"","region":"","country":"","sessions":1}]', 'unknown geography is left unknown');
select is(public.mova_admin_website_traffic('24h') #>> '{current,page_views}', '5', 'existing traffic collector still records page views');
select * from finish();
rollback;
