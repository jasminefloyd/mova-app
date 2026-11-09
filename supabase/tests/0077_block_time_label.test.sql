begin;
select plan(4);

insert into public.mova_artist_businesses(id,name,status)
values('e7700000-0000-4000-8000-000000000001','P6 block label fixture','active');
insert into public.mova_locations(id,artist_business_id,name,location_type,booking_mode,calendar_ownership,payment_collector,time_zone)
values('e7700000-0000-4000-8000-000000000101','e7700000-0000-4000-8000-000000000001','Block studio','suite','instant','mova','artist','UTC');

select has_column('public','mova_availability_blocks','label','TC-SCR-08E-01 blocks have a private label');
insert into public.mova_availability_blocks(artist_business_id,location_id,starts_at,ends_at,reason) values('e7700000-0000-4000-8000-000000000001','e7700000-0000-4000-8000-000000000101','2030-03-05 16:00+00','2030-03-05 17:00+00','holiday');
select is((select label from public.mova_availability_blocks where starts_at='2030-03-05 16:00+00'),'','TC-SCR-08E-01 the label is empty unless the stylist adds one');
select lives_ok($$insert into public.mova_availability_blocks(artist_business_id,location_id,starts_at,ends_at,reason,label)
  values('e7700000-0000-4000-8000-000000000001','e7700000-0000-4000-8000-000000000101','2030-03-05 12:00+00','2030-03-05 13:00+00','personal_break','Lunch')$$,
  'TC-SCR-08E-01 a block saves with a reason and a label');
select throws_ok($$insert into public.mova_availability_blocks(artist_business_id,location_id,starts_at,ends_at,reason,label)
  values('e7700000-0000-4000-8000-000000000001','e7700000-0000-4000-8000-000000000101','2030-03-05 14:00+00','2030-03-05 15:00+00','holiday',repeat('x',121))$$,
  '23514', null, 'TC-SCR-08E-01 a label longer than 120 characters is refused');

select * from finish();
rollback;
