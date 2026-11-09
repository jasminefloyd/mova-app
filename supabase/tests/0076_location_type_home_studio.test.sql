begin;
select plan(4);

insert into public.mova_artist_businesses(id,name,status)
values('e7600000-0000-4000-8000-000000000001','P6 home studio fixture','active');

select lives_ok($$insert into public.mova_locations(artist_business_id,name,location_type,booking_mode,calendar_ownership,payment_collector,time_zone)
  values('e7600000-0000-4000-8000-000000000001','Home studio','home_studio','instant','mova','artist','America/New_York')$$,
  'TC-SCR-19A-01 a home studio can be saved as a location type');
select throws_ok($$insert into public.mova_locations(artist_business_id,name,location_type,booking_mode,calendar_ownership,payment_collector,time_zone)
  values('e7600000-0000-4000-8000-000000000001','Unknown','beauty_truck','instant','mova','artist','America/New_York')$$,
  '23514', null, 'TC-SCR-19A-01 an unknown location type is still refused');
select ok(exists(select 1 from pg_constraint where conname='mova_locations_location_type_check' and conrelid='public.mova_locations'::regclass and pg_get_constraintdef(oid) like '%home_studio%'),
  'TC-SCR-19A-01 the check constraint lists home_studio');
select ok(exists(select 1 from public.mova_locations where name='Home studio' and location_type='home_studio'),
  'TC-SCR-19A-01 existing location rows keep their values');

select * from finish();
rollback;
