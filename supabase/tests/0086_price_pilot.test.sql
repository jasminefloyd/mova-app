begin;
select plan(9);
insert into auth.users(id,email) values('af860000-0000-4000-8000-000000000001','pilot@mova.invalid');
insert into public.mova_artist_businesses(id,name,status) values('af860000-0000-4000-8000-000000000101','Pilot Studio','active');
insert into public.mova_artist_memberships(artist_business_id,user_id,status,role)
values('af860000-0000-4000-8000-000000000101','af860000-0000-4000-8000-000000000001','active','owner');

select ok((select relrowsecurity from pg_class where oid='public.mova_price_pilot_sources'::regclass),'menu source table has RLS');
select ok((select relrowsecurity from pg_class where oid='public.mova_price_pilot_observations'::regclass),'observation table has RLS');
select ok(not has_table_privilege('anon','public.mova_price_pilot_sources','SELECT'),'anon cannot read menu sources');
select ok(not has_table_privilege('authenticated','public.mova_price_pilot_sources','SELECT'),'stylists cannot read source rows directly');
select ok(not has_table_privilege('authenticated','public.mova_price_pilot_observations','SELECT'),'stylists cannot read observations directly');
select ok(not has_table_privilege('authenticated','public.mova_price_pilot_sources','INSERT'),'stylists cannot write sources directly');
select ok(not has_table_privilege('authenticated','public.mova_price_pilot_observations','INSERT'),'stylists cannot write observations directly');
select ok(not coalesce((public.mova_feature_gate('af860000-0000-4000-8000-000000000101','ai_price_pilot',null)->>'enabled')::boolean,false),'PricePilot is disabled by default');

select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
insert into public.mova_price_pilot_sources(id,artist_business_id,submitted_url,normalized_host,authorization_confirmed)
values('af860000-0000-4000-8000-000000000201','af860000-0000-4000-8000-000000000101','https://example.com/services','example.com',true);
select lives_ok($$insert into public.mova_price_pilot_observations(source_id,artist_business_id,service_name,price_min_minor,price_max_minor,pricing_basis,extraction_confidence) values('af860000-0000-4000-8000-000000000201','af860000-0000-4000-8000-000000000101','Silk press',15000,15000,'fixed',0.9)$$,'service-role import stores normalized price facts');
reset role;
select * from finish();
rollback;
