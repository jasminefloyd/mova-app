begin;
select plan(20);

-- Fixture: one stylist, a suite (standard price) and a home studio (own price), one service at both.
insert into public.mova_artist_businesses(id,name,status) values ('e1130000-0000-4000-8000-000000000001','PricePilot 0113 fixture','active');
insert into public.mova_locations(id,artist_business_id,name,location_type,booking_mode,calendar_ownership,payment_collector,time_zone) values
 ('e1130000-0000-4000-8000-000000000101','e1130000-0000-4000-8000-000000000001','Studio 9 Suites','suite','instant','mova','artist','America/New_York'),
 ('e1130000-0000-4000-8000-000000000102','e1130000-0000-4000-8000-000000000001','Home studio','suite','instant','mova','artist','America/New_York');
insert into public.mova_services(id,artist_business_id,name,category,duration_minutes,buffer_minutes,base_price_minor,status,deposit_type,deposit_value)
values ('e1130000-0000-4000-8000-000000000201','e1130000-0000-4000-8000-000000000001','Silk press','Styling',90,15,9500,'active','none',0);
insert into public.mova_service_locations(artist_business_id,service_id,location_id,price_minor_override,duration_minutes_override) values
 ('e1130000-0000-4000-8000-000000000001','e1130000-0000-4000-8000-000000000201','e1130000-0000-4000-8000-000000000101',null,null),
 ('e1130000-0000-4000-8000-000000000001','e1130000-0000-4000-8000-000000000201','e1130000-0000-4000-8000-000000000102',12000,null)
on conflict (service_id, location_id) do update set price_minor_override = excluded.price_minor_override;

-- Tables and privileges
select has_table('public','mova_price_pilot_runs','TC-PP-RUN-01 discovery runs table exists');
select has_table('public','mova_price_pilot_changes','TC-PP-APPLY-01 price change log exists');
select ok((select relrowsecurity from pg_class where oid='public.mova_price_pilot_changes'::regclass),'TC-PP-SEC-01 change log has RLS on');
select ok(not has_function_privilege('authenticated','public.mova_price_pilot_apply(uuid,uuid,jsonb)','EXECUTE'),'TC-PP-SEC-02 stylists cannot call apply directly; the function checks membership first');
select ok(has_function_privilege('service_role','public.mova_price_pilot_apply(uuid,uuid,jsonb)','EXECUTE'),'TC-PP-SEC-03 the function can apply');

-- Settings: PP7 radius up to 25 miles, off by default
insert into public.mova_price_pilot_settings(artist_business_id) values ('e1130000-0000-4000-8000-000000000001');
select is((select enabled from public.mova_price_pilot_settings where artist_business_id='e1130000-0000-4000-8000-000000000001'),false,'TC-PP-ON-01 PricePilot is off until the stylist turns it on');
select lives_ok($$update public.mova_price_pilot_settings set radius_miles=25 where artist_business_id='e1130000-0000-4000-8000-000000000001'$$,'TC-PP-RADIUS-01 a 25-mile radius is allowed');
select throws_ok($$update public.mova_price_pilot_settings set radius_miles=30 where artist_business_id='e1130000-0000-4000-8000-000000000001'$$,'23514',null,'TC-PP-RADIUS-02 more than 25 miles is refused');

-- Sources: auto-found salons need no stylist tick; stylist-added menus do
select lives_ok($$insert into public.mova_price_pilot_sources(artist_business_id,submitted_url,normalized_host,authorization_confirmed,origin,google_place_id,business_name)
  values ('e1130000-0000-4000-8000-000000000001','https://crown.example/services','crown.example',false,'auto','place-1','Crown Studio')$$,'TC-PP-SRC-01 a salon Mova found itself is stored without a stylist tick');
select throws_ok($$insert into public.mova_price_pilot_sources(artist_business_id,submitted_url,normalized_host,authorization_confirmed,origin)
  values ('e1130000-0000-4000-8000-000000000001','https://roots.example/menu','roots.example',false,'stylist')$$,'23514',null,'TC-PP-SRC-02 a stylist-added menu needs the permission tick');

-- Apply: standard price at the suite, own price at the home studio
select is(
  (public.mova_price_pilot_apply('e1130000-0000-4000-8000-000000000001',null,
    '[{"service_id":"e1130000-0000-4000-8000-000000000201","location_id":"e1130000-0000-4000-8000-000000000101","new_price_minor":11000,"expected_current_minor":9500,"reference_median_minor":11000,"evidence_count":6}]'::jsonb)->0->>'scope'),
  'standard','TC-PP-APPLY-02 a location on the standard price updates the standard price');
select is((select base_price_minor from public.mova_services where id='e1130000-0000-4000-8000-000000000201'),11000,'TC-PP-APPLY-03 the standard price is now $110');
select is((select price_minor_override from public.mova_service_locations where location_id='e1130000-0000-4000-8000-000000000102'),12000,'TC-PP-APPLY-04 the home studio keeps its own price of $120');
select is(
  (public.mova_price_pilot_apply('e1130000-0000-4000-8000-000000000001',null,
    '[{"service_id":"e1130000-0000-4000-8000-000000000201","location_id":"e1130000-0000-4000-8000-000000000102","new_price_minor":12500,"expected_current_minor":12000}]'::jsonb)->0->>'scope'),
  'location','TC-PP-APPLY-05 a location with its own price changes only that price');
select is((select count(*)::integer from public.mova_price_pilot_changes where artist_business_id='e1130000-0000-4000-8000-000000000001'),2,'TC-PP-APPLY-06 each change is logged');
select throws_ok($$select public.mova_price_pilot_apply('e1130000-0000-4000-8000-000000000001',null,
    '[{"service_id":"e1130000-0000-4000-8000-000000000201","location_id":"e1130000-0000-4000-8000-000000000101","new_price_minor":12000,"expected_current_minor":9500}]'::jsonb)$$,
  'P0001','PRICE_CHANGED','TC-PP-APPLY-07 a stale screen cannot overwrite a price that already changed');
select throws_ok($$select public.mova_price_pilot_apply('e1130000-0000-4000-8000-000000000099',null,
    '[{"service_id":"e1130000-0000-4000-8000-000000000201","location_id":"e1130000-0000-4000-8000-000000000101","new_price_minor":12000,"expected_current_minor":11000}]'::jsonb)$$,
  'P0002','SERVICE_NOT_FOUND','TC-PP-APPLY-08 another stylist''s service cannot be changed');
select is((select base_price_minor from public.mova_services where id='e1130000-0000-4000-8000-000000000201'),11000,'TC-PP-APPLY-09 a refused change leaves prices as they were');

-- Weekly queue: only for stylists who turned it on and whose plan includes it
select is(public.mova_price_pilot_enqueue_due_runs(),0,'TC-PP-RUN-02 nothing is queued while PricePilot is off');
update public.mova_price_pilot_settings set enabled = true where artist_business_id='e1130000-0000-4000-8000-000000000001';
select is(public.mova_price_pilot_enqueue_due_runs(),0,'TC-PP-RUN-03 nothing is queued when the plan does not include PricePilot');

select * from finish();
rollback;
