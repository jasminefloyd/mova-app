begin;
select plan(28);

insert into auth.users(id,aud,role,email,email_confirmed_at) values
  ('e7800000-0000-4000-8000-000000000001','authenticated','authenticated','p6-stylist@example.invalid',now()),
  ('e7800000-0000-4000-8000-000000000002','authenticated','authenticated','p6-other@example.invalid',now());
insert into public.mova_artist_businesses(id,name,status) values
  ('e7800000-0000-4000-8000-000000000101','P6 booking fixture','active'),
  ('e7800000-0000-4000-8000-000000000102','P6 other fixture','active');
insert into public.mova_artist_memberships(artist_business_id,user_id,role,status) values
  ('e7800000-0000-4000-8000-000000000101','e7800000-0000-4000-8000-000000000001','owner','active'),
  ('e7800000-0000-4000-8000-000000000102','e7800000-0000-4000-8000-000000000002','owner','active');
insert into public.mova_locations(id,artist_business_id,name,location_type,booking_mode,calendar_ownership,payment_collector,time_zone)
values('e7800000-0000-4000-8000-000000000201','e7800000-0000-4000-8000-000000000101','Studio 9','suite','instant','mova','artist','UTC');
insert into public.mova_location_policies(location_id,artist_business_id)
values('e7800000-0000-4000-8000-000000000201','e7800000-0000-4000-8000-000000000101');
insert into public.mova_location_hours(artist_business_id,location_id,weekday,opens_at,closes_at)
select 'e7800000-0000-4000-8000-000000000101','e7800000-0000-4000-8000-000000000201',day,time '09:00',time '17:00' from generate_series(0,6) day;
insert into public.mova_services(id,artist_business_id,name,category,duration_minutes,buffer_minutes,base_price_minor,status,deposit_type,deposit_value)
values('e7800000-0000-4000-8000-000000000301','e7800000-0000-4000-8000-000000000101','Silk press','Styling',90,0,15000,'active','none',0),
      ('e7800000-0000-4000-8000-000000000302','e7800000-0000-4000-8000-000000000102','Other tenant service','Styling',60,0,8000,'active','none',0);
insert into public.mova_service_locations(artist_business_id,service_id,location_id)
values('e7800000-0000-4000-8000-000000000101','e7800000-0000-4000-8000-000000000301','e7800000-0000-4000-8000-000000000201')
on conflict (service_id, location_id) do nothing;
insert into public.mova_clients(id,artist_business_id,display_name,email,phone,preferred_locale)
values('e7800000-0000-4000-8000-000000000401','e7800000-0000-4000-8000-000000000101','Simone A.','simone@example.invalid','+15555550100','en-US'),
      ('e7800000-0000-4000-8000-000000000402','e7800000-0000-4000-8000-000000000102','Other client','other@example.invalid',null,'en-US');

select has_function('public','mova_artist_appointment_create',array['uuid','uuid','uuid','uuid','timestamp with time zone','text']::name[],'TC-SCR-08C-01 the artist booking RPC exists');
select ok(has_function_privilege('authenticated','public.mova_artist_appointment_create(uuid,uuid,uuid,uuid,timestamptz,text)','EXECUTE'),'TC-SCR-08C-01 signed-in stylists can call it');
select ok(not has_function_privilege('anon','public.mova_artist_appointment_create(uuid,uuid,uuid,uuid,timestamptz,text)','EXECUTE'),'TC-SCR-08C-01 anonymous visitors cannot call it');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e7800000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select public.mova_artist_appointment_create('e7800000-0000-4000-8000-000000000101','e7800000-0000-4000-8000-000000000401','e7800000-0000-4000-8000-000000000201','e7800000-0000-4000-8000-000000000301','2030-03-05 11:00+00','p6-key-outsider')$$,
  '42501', 'ARTIST_MEMBERSHIP_REQUIRED', 'TC-SCR-08C-02 a stylist from another business cannot book into this one');

select set_config('request.jwt.claims','{"sub":"e7800000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$select public.mova_artist_appointment_create('e7800000-0000-4000-8000-000000000101','e7800000-0000-4000-8000-000000000401','e7800000-0000-4000-8000-000000000201','e7800000-0000-4000-8000-000000000301','2030-03-05 11:00+00','short')$$,
  '22023', 'IDEMPOTENCY_KEY_REQUIRED', 'TC-SCR-08C-03 a booking needs an idempotency key');
select throws_ok($$select public.mova_artist_appointment_create('e7800000-0000-4000-8000-000000000101','e7800000-0000-4000-8000-000000000402','e7800000-0000-4000-8000-000000000201','e7800000-0000-4000-8000-000000000301','2030-03-05 11:00+00','p6-key-client')$$,
  '22023', 'CLIENT_NOT_FOUND', 'TC-SCR-08C-03 a client from another business is not found');
select throws_ok($$select public.mova_artist_appointment_create('e7800000-0000-4000-8000-000000000101','e7800000-0000-4000-8000-000000000401','e7800000-0000-4000-8000-000000000201','e7800000-0000-4000-8000-000000000302','2030-03-05 11:00+00','p6-key-service')$$,
  '22023', 'SERVICE_NOT_FOUND', 'TC-SCR-08C-03 another business service is not found');
select throws_ok($$select public.mova_artist_appointment_create('e7800000-0000-4000-8000-000000000101','e7800000-0000-4000-8000-000000000401','e7800000-0000-4000-8000-000000000201','e7800000-0000-4000-8000-000000000301','2020-01-01 11:00+00','p6-key-past')$$,
  '22023', 'SLOT_OUTSIDE_BOOKING_WINDOW', 'TC-SCR-08C-04 a time in the past is refused');
select throws_ok($$select public.mova_artist_appointment_create('e7800000-0000-4000-8000-000000000101','e7800000-0000-4000-8000-000000000401','e7800000-0000-4000-8000-000000000201','e7800000-0000-4000-8000-000000000301','2030-03-05 20:00+00','p6-key-late')$$,
  '22023', 'SLOT_OUTSIDE_LOCATION_HOURS', 'TC-SCR-08C-04 a time outside location hours is refused');

reset role;
insert into public.mova_availability_blocks(artist_business_id,location_id,starts_at,ends_at,reason,label)
values('e7800000-0000-4000-8000-000000000101','e7800000-0000-4000-8000-000000000201','2030-03-05 15:00+00','2030-03-05 15:30+00','personal_break','');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e7800000-0000-4000-8000-000000000001","role":"authenticated"}',true);

create temporary table p6_first_booking as
select public.mova_artist_appointment_create('e7800000-0000-4000-8000-000000000101','e7800000-0000-4000-8000-000000000401','e7800000-0000-4000-8000-000000000201','e7800000-0000-4000-8000-000000000301','2030-03-05 11:00+00','p6-key-first') as id;
select ok((select id from p6_first_booking) is not null, 'TC-SCR-08C-05 a stylist books a known client into a free time');
select is(public.mova_artist_appointment_create('e7800000-0000-4000-8000-000000000101','e7800000-0000-4000-8000-000000000401','e7800000-0000-4000-8000-000000000201','e7800000-0000-4000-8000-000000000301','2030-03-05 11:00+00','p6-key-first'), (select id from p6_first_booking), 'TC-SCR-08C-05 the same key returns the same booking');
select throws_ok($$select public.mova_artist_appointment_create('e7800000-0000-4000-8000-000000000101','e7800000-0000-4000-8000-000000000401','e7800000-0000-4000-8000-000000000201','e7800000-0000-4000-8000-000000000301','2030-03-05 11:30+00','p6-key-overlap')$$,
  '23505', 'SLOT_TAKEN', 'TC-SCR-08C-06 an overlapping booking is refused');
select throws_ok($$select public.mova_artist_appointment_create('e7800000-0000-4000-8000-000000000101','e7800000-0000-4000-8000-000000000401','e7800000-0000-4000-8000-000000000201','e7800000-0000-4000-8000-000000000301','2030-03-05 14:30+00','p6-key-block')$$,
  '23505', 'SLOT_TAKEN', 'TC-SCR-08C-06 a time that runs into block time is refused');

reset role;
select is((select status||'/'||source||'/'||deposit_due_minor::text from public.mova_appointments where id=(select id from p6_first_booking)), 'confirmed/artist/0', 'TC-SCR-08C-07 the booking is confirmed, from the stylist, with no deposit');
select is((select count(*)::int from public.mova_appointment_services where appointment_id=(select id from p6_first_booking)), 1, 'TC-SCR-08C-07 the service snapshot is written');

update public.mova_location_policies set buffer_before_minutes = 5, buffer_after_minutes = 15
where location_id = 'e7800000-0000-4000-8000-000000000201';
insert into public.mova_services(id,artist_business_id,name,category,duration_minutes,buffer_minutes,base_price_minor,status,location_assignment_mode)
values
  ('e7800000-0000-4000-8000-000000000303','e7800000-0000-4000-8000-000000000101','Trim','Styling',45,10,5000,'active','selected'),
  ('e7800000-0000-4000-8000-000000000304','e7800000-0000-4000-8000-000000000101','Twists','Styling',60,0,7500,'active','selected');
insert into public.mova_service_locations(artist_business_id,service_id,location_id,duration_minutes_override,price_minor_override)
values('e7800000-0000-4000-8000-000000000101','e7800000-0000-4000-8000-000000000303','e7800000-0000-4000-8000-000000000201',30,4000);
insert into public.mova_availability_blocks(artist_business_id,location_id,starts_at,ends_at,reason,label)
values('e7800000-0000-4000-8000-000000000101','e7800000-0000-4000-8000-000000000201','2030-03-07 12:20+00','2030-03-07 12:21+00','personal_break','');

create function pg_temp.manual_multi(
  starts_at timestamptz, check_only boolean, key text default 'p6-multi-booking',
  services uuid[] default array['e7800000-0000-4000-8000-000000000303'::uuid,'e7800000-0000-4000-8000-000000000301'::uuid]
) returns jsonb language sql as $$
  select public.mova_artist_appointment_create_multi(
    'e7800000-0000-4000-8000-000000000101','e7800000-0000-4000-8000-000000000401',
    'e7800000-0000-4000-8000-000000000201',services,starts_at,key,check_only
  )
$$;

select ok(not has_function_privilege('anon','public.mova_artist_appointment_create_multi(uuid,uuid,uuid,uuid[],timestamptz,text,boolean)','EXECUTE'),
  'Anonymous callers cannot run the manual booking check or create RPC');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e7800000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select pg_temp.manual_multi('2030-03-06 10:00+00',true)$$,
  '42501','ARTIST_MEMBERSHIP_REQUIRED','Another tenant cannot check the slot');
select set_config('request.jwt.claims','{"sub":"e7800000-0000-4000-8000-000000000001","role":"authenticated"}',true);

select is((pg_temp.manual_multi('2030-03-06 10:00+00',true)->>'ends_at')::timestamptz,'2030-03-06 12:10+00'::timestamptz,
  'Preview end uses the ordered services, including the duration override and service buffer');
select ok(not exists(select 1 from public.mova_appointments where idempotency_key='p6-multi-booking'), 'Preview does not book the slot');
select is(pg_temp.manual_multi('2030-03-07 10:00+00',true)->>'available','false','A block inside the after buffer makes the full slot unavailable');
select throws_ok($$select pg_temp.manual_multi('2030-03-07 10:00+00',false,'p6-multi-block')$$,
  '23505','SLOT_TAKEN','Booking independently refuses the same buffered conflict');
select throws_ok($$select pg_temp.manual_multi('2030-03-06 15:00+00',true)$$,
  '22023','SLOT_OUTSIDE_LOCATION_HOURS','The combined duration must fit within location hours');
select throws_ok($$select pg_temp.manual_multi('2030-03-06 10:00+00',true,services => array['e7800000-0000-4000-8000-000000000301'::uuid,'e7800000-0000-4000-8000-000000000304'::uuid])$$,
  '22023','SERVICE_NOT_OFFERED_AT_LOCATION','Every selected service must be offered at the location');
select throws_ok($$select pg_temp.manual_multi('2030-03-06 10:00+00',true,services => array['e7800000-0000-4000-8000-000000000301'::uuid,'e7800000-0000-4000-8000-000000000301'::uuid])$$,
  '22023','SERVICES_INVALID','The same service cannot be selected twice');

create temporary table p6_multi_booking as
select (pg_temp.manual_multi('2030-03-06 10:00+00',false)->>'appointment_id')::uuid as id;
select is((select string_agg(service_name_snapshot||':'||duration_minutes_snapshot||':'||price_minor_snapshot,',' order by position)
  from public.mova_appointment_services where appointment_id=(select id from p6_multi_booking)),
  'Trim:40:4000,Silk press:90:15000','One booking stores both services in order with their own duration and price');
select is((select ends_at||'/'||buffer_before_minutes||'/'||buffer_after_minutes||'/'||service_price_minor||'/'||deposit_due_minor
  from public.mova_appointments where id=(select id from p6_multi_booking)),
  '2030-03-06 12:10:00+00/5/15/19000/0','The confirmed appointment stores the full span, location buffers and combined price');
select is(pg_temp.manual_multi('2030-03-06 12:29+00',true)->>'available','false','A following booking cannot overlap the existing after-buffer');
select is(pg_temp.manual_multi('2030-03-06 12:30+00',true)->>'available','true','Touching buffered windows are allowed');

select * from finish();
rollback;
