begin;
select plan(10);

insert into public.mova_artist_businesses(id,name,status)
values('e3300000-0000-4000-8000-000000000001','Booking consent test tenant','active');
insert into public.mova_locations(id,artist_business_id,name,location_type,booking_mode,calendar_ownership,payment_collector,time_zone)
values('e3300000-0000-4000-8000-000000000101','e3300000-0000-4000-8000-000000000001','Consent test studio','suite','instant','mova','artist','America/New_York');
insert into public.mova_location_policies(location_id,artist_business_id)
values('e3300000-0000-4000-8000-000000000101','e3300000-0000-4000-8000-000000000001');
insert into public.mova_location_hours(artist_business_id,location_id,weekday,opens_at,closes_at)
select 'e3300000-0000-4000-8000-000000000001','e3300000-0000-4000-8000-000000000101',day,time '09:00',time '17:00'
from generate_series(0,6) as day;
insert into public.mova_services(id,artist_business_id,name,category,duration_minutes,base_price_minor,status,deposit_type,deposit_value)
values('e3300000-0000-4000-8000-000000000202','e3300000-0000-4000-8000-000000000001','Consent test service','Styling',60,8000,'active','none',0);

select has_function('public'::name,'mova_booking_create_with_consent'::name,array['uuid','uuid','timestamp with time zone','text','text','text','text','text','bytea','timestamp with time zone','text','uuid','jsonb']::name[],'TC-F04-AC01-02 booking RPC accepts per-purpose channel choices');

create temporary table mova_booking_consent_result as
select public.mova_booking_create_with_consent(
  'e3300000-0000-4000-8000-000000000101',
  'e3300000-0000-4000-8000-000000000202',
  (date_trunc('day',(now() at time zone 'America/New_York')+interval '30 days')+interval '12 hours') at time zone 'America/New_York',
  'Consent Test Guest','consent-test@example.invalid','+12025550299','en-US',
  'consent-test-booking',decode(repeat('31',32),'hex'),null,null,null,
  '{"rebooking_reminders":{"email":true,"sms":true},"offers":{"email":false,"sms":false},"review_requests":{"email":false}}'::jsonb
) as result;

select is((select result->>'status' from mova_booking_consent_result),'confirmed','TC-F04-AC01-02 no-deposit instant booking completes with consent choices');
select is((select count(*)::int from public.mova_appointments where idempotency_key='consent-test-booking'),1,'TC-F04-AC01-02 booking and consent writes share one transaction');
select is((select granted from public.mova_client_consents c join public.mova_appointments a on a.client_id=c.client_id and a.artist_business_id=c.artist_business_id where a.idempotency_key='consent-test-booking' and c.purpose='rebooking_reminders' and c.channel='email' order by c.changed_at desc,c.id desc limit 1),true,'TC-F04-AC01-02 email rebooking opt-in is persisted');
select is((select granted from public.mova_client_consents c join public.mova_appointments a on a.client_id=c.client_id and a.artist_business_id=c.artist_business_id where a.idempotency_key='consent-test-booking' and c.purpose='rebooking_reminders' and c.channel='sms' order by c.changed_at desc,c.id desc limit 1),true,'TC-F04-AC01-02 SMS rebooking opt-in is persisted independently');
select is((select granted from public.mova_client_consents c join public.mova_appointments a on a.client_id=c.client_id and a.artist_business_id=c.artist_business_id where a.idempotency_key='consent-test-booking' and c.purpose='offers' and c.channel='email' order by c.changed_at desc,c.id desc limit 1),false,'TC-F04-AC01-02 email offers remain opted out');
select is((select granted from public.mova_client_consents c join public.mova_appointments a on a.client_id=c.client_id and a.artist_business_id=c.artist_business_id where a.idempotency_key='consent-test-booking' and c.purpose='review_requests' and c.channel='email' order by c.changed_at desc,c.id desc limit 1),false,'TC-F04-AC01-02 review request opt-out overrides the booking default');
select is((select evidence->>'source' from public.mova_client_consents c join public.mova_appointments a on a.client_id=c.client_id and a.artist_business_id=c.artist_business_id where a.idempotency_key='consent-test-booking' and c.purpose='rebooking_reminders' and c.channel='email' order by c.changed_at desc,c.id desc limit 1),'booking_checkout','TC-F04-AC01-02 consent row records checkout evidence');
select is((select (public.mova_booking_create_with_consent(
  'e3300000-0000-4000-8000-000000000101','e3300000-0000-4000-8000-000000000202',
  (date_trunc('day',(now() at time zone 'America/New_York')+interval '30 days')+interval '12 hours') at time zone 'America/New_York',
  'Consent Test Guest','consent-test@example.invalid','+12025550299','en-US',
  'consent-test-booking',decode(repeat('31',32),'hex'),null,null,null,
  '{"rebooking_reminders":{"email":false,"sms":false},"offers":{"email":false,"sms":false},"review_requests":{"email":false}}'::jsonb
)->>'replayed')::boolean),true,'TC-F04-AC01-02 replay does not reapply changed consent choices');
select is((select count(*)::int from public.mova_client_consents c join public.mova_appointments a on a.client_id=c.client_id and a.artist_business_id=c.artist_business_id where a.idempotency_key='consent-test-booking' and c.evidence->>'source'='booking_checkout'),5,'TC-F04-AC01-02 replay creates no duplicate consent evidence');

select * from finish();
rollback;
