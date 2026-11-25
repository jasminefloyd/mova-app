begin;
set local time zone 'America/New_York';
select plan(22);

-- 0128: Stripe switches
select has_column('public','mova_payment_method_settings','deposits_enabled','CN3 deposits switch exists');
select has_column('public','mova_payment_method_settings','pay_links_enabled','CN3 pay links switch exists');
select ok(has_function_privilege('service_role','public.mova_deposits_enabled(uuid)','EXECUTE'),'deposit switch reader is service-role');
select ok(not has_function_privilege('authenticated','public.mova_deposits_enabled(uuid)','EXECUTE'),'clients cannot call the deposit switch reader');

insert into public.mova_artist_businesses(id,name,status) values('c1280000-0000-4000-8000-000000000001','CN deposits tenant','active');
insert into public.mova_locations(id,artist_business_id,name,location_type,booking_mode,calendar_ownership,payment_collector,time_zone)
values('c1280000-0000-4000-8000-000000000101','c1280000-0000-4000-8000-000000000001','CN studio','suite','instant','mova','artist','America/New_York');
insert into public.mova_location_policies(location_id,artist_business_id) values('c1280000-0000-4000-8000-000000000101','c1280000-0000-4000-8000-000000000001');
insert into public.mova_location_hours(artist_business_id,location_id,weekday,opens_at,closes_at)
select 'c1280000-0000-4000-8000-000000000001','c1280000-0000-4000-8000-000000000101',day,time '09:00',time '17:00' from generate_series(0,6) day;
insert into public.mova_services(id,artist_business_id,name,category,duration_minutes,buffer_minutes,base_price_minor,status,deposit_type,deposit_value)
values('c1280000-0000-4000-8000-000000000201','c1280000-0000-4000-8000-000000000001','Silk press','Styling',90,0,12000,'active','fixed',3000);

select ok(public.mova_deposits_enabled('c1280000-0000-4000-8000-000000000001'),'deposits are on when the stylist never changed the switch');

select set_config('mova.allow_deposit_bookings','on',true);
select is((public.mova_booking_create_multi('c1280000-0000-4000-8000-000000000101',array['c1280000-0000-4000-8000-000000000201'::uuid],
  ((date_trunc('day',now() at time zone 'America/New_York')+interval '14 days'+time '09:00') at time zone 'America/New_York'),
  'CN Client','cn-1@example.invalid','+12025550101','en-US','cn-deposit-on',decode(repeat('ab',32),'hex'))->>'deposit_due_minor')::int,3000,
  'with deposits on, the service deposit is asked for');

insert into public.mova_payment_method_settings(artist_business_id,deposits_enabled) values('c1280000-0000-4000-8000-000000000001',false);
select ok(not public.mova_deposits_enabled('c1280000-0000-4000-8000-000000000001'),'the switch reads off once turned off');
create temporary table cn_off as select public.mova_booking_create_multi('c1280000-0000-4000-8000-000000000101',array['c1280000-0000-4000-8000-000000000201'::uuid],
  ((date_trunc('day',now() at time zone 'America/New_York')+interval '15 days'+time '09:00') at time zone 'America/New_York'),
  'CN Client','cn-2@example.invalid','+12025550102','en-US','cn-deposit-off',decode(repeat('cd',32),'hex')) as result;
select is((select (result->>'deposit_due_minor')::int from cn_off),0,'with deposits off, no deposit is asked for');
select is((select result->>'status' from cn_off),'confirmed','an instant booking without a deposit is confirmed straight away');
select is((select deposit_type from public.mova_services where id='c1280000-0000-4000-8000-000000000201'),'fixed','the per-service deposit setting is kept');

-- 0128: Google review alerts and scheduled import
insert into public.mova_google_reviews(artist_business_id,provider_review_id,rating,body,display_name)
values('c1280000-0000-4000-8000-000000000001','first-import',5,'Old review','Old');
select is((select count(*)::int from public.mova_outbox_events where event_type='google_review.created' and artist_business_id='c1280000-0000-4000-8000-000000000001'),0,
  'the first import never alerts about old reviews');
insert into public.mova_review_settings(artist_business_id,google_synced_at) values('c1280000-0000-4000-8000-000000000001',now() - interval '7 hours')
on conflict (artist_business_id) do update set google_synced_at=excluded.google_synced_at;
insert into public.mova_google_reviews(artist_business_id,provider_review_id,rating,body,display_name)
values('c1280000-0000-4000-8000-000000000001','new-one',4,'Loved my silk press','Dana');
select is((select count(*)::int from public.mova_outbox_events where event_type='google_review.created' and artist_business_id='c1280000-0000-4000-8000-000000000001'),1,
  'a review found after the first import becomes an alert');
select is((public.mova_stylist_alert_context('google_review.created',(select id from public.mova_google_reviews where provider_review_id='new-one')))->'review'->>'name','Dana',
  'the alert context carries the Google reviewer');
select is((public.mova_stylist_alert_context('google_review.created',(select id from public.mova_google_reviews where provider_review_id='new-one')))->'review'->>'rating','4',
  'the alert context carries the rating');

insert into public.mova_google_connections(artist_business_id,google_account_email,refresh_token_encrypted,granted_scopes,status,business_profile_enabled,business_location_id)
values('c1280000-0000-4000-8000-000000000001','cn@example.invalid','\x00','{}','active',true,'locations/123');
select ok('c1280000-0000-4000-8000-000000000001'::uuid in (select public.mova_google_review_sync_due(now(),20)),'a stylist not checked for 6 hours is due');
update public.mova_review_settings set google_import_enabled=false where artist_business_id='c1280000-0000-4000-8000-000000000001';
select ok('c1280000-0000-4000-8000-000000000001'::uuid not in (select public.mova_google_review_sync_due(now(),20)),'turning Google reviews off stops the scheduled import');
select ok(not has_function_privilege('authenticated','public.mova_google_review_sync_due(timestamptz,integer)','EXECUTE'),'clients cannot list stylists due for import');

-- 0129: Meta connection
select has_table('public','mova_meta_connections','CN5 Meta connection table exists');
select ok((select relrowsecurity from pg_class where oid='public.mova_meta_connections'::regclass),'Meta connections have RLS');
select ok(not has_column_privilege('authenticated','public.mova_meta_connections','page_token_encrypted','SELECT'),'clients can never read the Page token');
select lives_ok($$insert into public.mova_conversations(artist_business_id,channel,external_thread_id) values('c1280000-0000-4000-8000-000000000001','messenger','psid-1')$$,
  'Facebook Page messages are a Concierge channel');
select throws_ok($$insert into public.mova_sending_identities(artist_business_id,channel,address,provider) values('c1280000-0000-4000-8000-000000000001','whatsapp','1','x')$$,
  '23514',null,'unknown channels are still refused');

select * from finish();
rollback;
