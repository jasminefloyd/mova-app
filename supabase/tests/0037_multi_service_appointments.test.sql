begin;
set local time zone 'America/New_York';
select plan(14);

select has_table('public','mova_appointment_services','TC-MODEL-01 ordered appointment service snapshots exist');
select ok((select relrowsecurity from pg_class where oid='public.mova_appointment_services'::regclass),'service snapshots have RLS enabled');
select has_function('public','mova_booking_create_multi',array['uuid','uuid[]','timestamp with time zone','text','text','text','text','text','bytea']::name[],'multi-service RPC accepts ordered service IDs');
select ok(has_function_privilege('service_role','public.mova_booking_create_multi(uuid,uuid[],timestamptz,text,text,text,text,text,bytea)','EXECUTE'),'multi-service booking RPC is service-role only');
select ok(not has_function_privilege('anon','public.mova_booking_create_multi(uuid,uuid[],timestamptz,text,text,text,text,text,bytea)','EXECUTE'),'anonymous role cannot call the booking RPC');

insert into public.mova_artist_businesses(id,name,status)
values('e2500000-0000-4000-8000-000000000001','E1 multi-service test tenant','active');
insert into public.mova_locations(id,artist_business_id,name,location_type,booking_mode,calendar_ownership,payment_collector,time_zone)
values('e2500000-0000-4000-8000-000000000101','e2500000-0000-4000-8000-000000000001','E1 test studio','suite','instant','mova','artist','America/New_York');
insert into public.mova_location_policies(location_id,artist_business_id)
values('e2500000-0000-4000-8000-000000000101','e2500000-0000-4000-8000-000000000001');
insert into public.mova_location_hours(artist_business_id,location_id,weekday,opens_at,closes_at)
select 'e2500000-0000-4000-8000-000000000001','e2500000-0000-4000-8000-000000000101',day,time '09:00',time '17:00' from generate_series(0,6) day;
insert into public.mova_services(id,artist_business_id,name,category,duration_minutes,buffer_minutes,base_price_minor,status,deposit_type,deposit_value)
values
 ('e2500000-0000-4000-8000-000000000201','e2500000-0000-4000-8000-000000000001','Service one','Styling',90,15,12000,'active','fixed',3000),
 ('e2500000-0000-4000-8000-000000000202','e2500000-0000-4000-8000-000000000001','Service two','Treatment',60,10,8000,'active','fixed',2000);
insert into public.mova_service_locations(artist_business_id,service_id,location_id,price_minor_override,duration_minutes_override)
values
 ('e2500000-0000-4000-8000-000000000001','e2500000-0000-4000-8000-000000000201','e2500000-0000-4000-8000-000000000101',14000,90),
 ('e2500000-0000-4000-8000-000000000001','e2500000-0000-4000-8000-000000000202','e2500000-0000-4000-8000-000000000101',9000,50);

select set_config('mova.allow_deposit_bookings','on',true);
create temporary table e1_test_booking as
select public.mova_booking_create_multi(
  'e2500000-0000-4000-8000-000000000101',
  array['e2500000-0000-4000-8000-000000000201'::uuid,'e2500000-0000-4000-8000-000000000202'::uuid],
  ((date_trunc('day',now() at time zone 'America/New_York')+interval '14 days'+time '09:00') at time zone 'America/New_York'),
  'E1 Synthetic Client','e1-multi@example.invalid','+12025550199','en-US','e1-multi-service-test',decode(repeat('ab',32),'hex')
) as result;

select is((select result->>'status' from e1_test_booking),'pending_payment','combined deposit creates a pending-payment appointment');
select is((select array_agg(service_id::text order by position) from public.mova_appointment_services where appointment_id=(select (result->>'id')::uuid from e1_test_booking)),array['e2500000-0000-4000-8000-000000000201','e2500000-0000-4000-8000-000000000202']::text[],'child services preserve the selected order');
select is((select sum(duration_minutes_snapshot)::int from public.mova_appointment_services where appointment_id=(select (result->>'id')::uuid from e1_test_booking)),165,'location duration overrides plus service buffers are summed');
select is((select sum(price_minor_snapshot)::int from public.mova_appointment_services where appointment_id=(select (result->>'id')::uuid from e1_test_booking)),23000,'location price overrides are summed');
select is((select sum(deposit_due_minor_snapshot)::int from public.mova_appointment_services where appointment_id=(select (result->>'id')::uuid from e1_test_booking)),5000,'per-service deposits are calculated then summed');
select is((select service_price_minor::int from public.mova_appointments where id=(select (result->>'id')::uuid from e1_test_booking)),23000,'legacy parent monetary total contains combined price');
select is((select deposit_due_minor::int from public.mova_appointments where id=(select (result->>'id')::uuid from e1_test_booking)),5000,'legacy parent deposit contains combined deposits');
select is((select (extract(epoch from ends_at-starts_at)/60)::int from public.mova_appointments where id=(select (result->>'id')::uuid from e1_test_booking)),165,'appointment interval reserves the combined service duration');
select is((select count(*)::int from public.mova_booking_holds where appointment_id=(select (result->>'id')::uuid from e1_test_booking) and status='active'),1,'one hold covers the combined appointment interval');

select * from finish();
rollback;
