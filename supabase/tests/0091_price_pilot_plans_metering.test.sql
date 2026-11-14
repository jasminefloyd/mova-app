begin;
select plan(4);

insert into public.mova_artist_businesses(id,name,status) values ('e9100000-0000-4000-8000-000000000101','PricePilot metering fixture','active');

select has_table('public'::name,'mova_price_plans'::name,'TC-PP-PLAN-01 saved price plans table exists');
select throws_ok($$select public.mova_price_pilot_consume('e9100000-0000-4000-8000-000000000101')$$,'P0001','PRICE_PILOT_LIMIT_REACHED','TC-PP-METER-01 a business without a plan has no lookup allowance');
select throws_ok($$select public.mova_price_pilot_replace_observations('e9100000-0000-4000-8000-000000000101','e9100000-0000-4000-8000-000000000999','[]'::jsonb)$$,'P0002','SOURCE_NOT_FOUND','TC-PP-REPLACE-01 replacing prices for an unknown source is refused');
select is((select count(*)::integer from public.mova_price_pilot_usage where artist_business_id='e9100000-0000-4000-8000-000000000101'),0,'TC-PP-METER-01 a refused lookup is not counted');

select * from finish();
rollback;
