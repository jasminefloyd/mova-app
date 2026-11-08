begin;
set local time zone 'America/New_York';
select plan(9);

-- These assertions use local rows and do not require the optional demo seed/Auth user.
insert into public.mova_artist_businesses (id, name, status)
values ('e2500000-0000-4000-8000-000000000001', 'Booking expiry test tenant', 'active');
insert into public.mova_locations (
  id, artist_business_id, name, location_type, booking_mode,
  calendar_ownership, payment_collector, time_zone
) values (
  'e2500000-0000-4000-8000-000000000101',
  'e2500000-0000-4000-8000-000000000001',
  'Expiry test studio', 'suite', 'instant', 'mova', 'artist', 'America/New_York'
);
insert into public.mova_services (
  id, artist_business_id, name, category, duration_minutes, base_price_minor,
  status, deposit_type, deposit_value
) values (
  'e2500000-0000-4000-8000-000000000202',
  'e2500000-0000-4000-8000-000000000001',
  'Expiry test service', 'Styling', 60, 8000, 'active', 'fixed', 2000
);

insert into public.mova_appointments(
  artist_business_id,location_id,service_id,source,status,starts_at,ends_at,
  service_name_snapshot,service_price_minor,deposit_due_minor,balance_due_minor,
  client_name,client_locale,request_expires_at,manage_token_hash,idempotency_key
) values
  (
    'e2500000-0000-4000-8000-000000000001'::uuid,
    'e2500000-0000-4000-8000-000000000101'::uuid,
    'e2500000-0000-4000-8000-000000000202'::uuid,
    'showcase','pending_artist',now()+interval '30 days',now()+interval '30 days 60 minutes',
    'Hydration Treatment',8000,0,8000,'Expiry Spanish Request','es-US',now()-interval '1 minute',
    decode(repeat('a1',32),'hex'),'cr-f04-expiry-spanish-20261107'
  ),
  (
    'e2500000-0000-4000-8000-000000000001'::uuid,
    'e2500000-0000-4000-8000-000000000101'::uuid,
    'e2500000-0000-4000-8000-000000000202'::uuid,
    'showcase','pending_payment',now()+interval '32 days',now()+interval '32 days 60 minutes',
    'Hydration Treatment',8000,2000,6000,'Expiry Payment Hold','en-US',null,
    decode(repeat('a2',32),'hex'),'cr-f04-expiry-payment-20261107'
  );

insert into public.mova_booking_holds(
  artist_business_id,appointment_id,location_id,starts_at,ends_at,status,expires_at
)
select a.artist_business_id,a.id,a.location_id,a.starts_at,a.ends_at,'active',now()-interval '1 minute'
from public.mova_appointments a
where a.idempotency_key='cr-f04-expiry-payment-20261107';

select is(public.mova_expire_booking_requests(now()),2,'expires both due request and payment-hold bookings');
select is((select status from public.mova_appointments where idempotency_key='cr-f04-expiry-spanish-20261107'),'expired','expires the artist request');
select is((select status from public.mova_appointments where idempotency_key='cr-f04-expiry-payment-20261107'),'expired','expires the payment hold booking');
select is((select status from public.mova_booking_holds h join public.mova_appointments a on a.id=h.appointment_id where a.idempotency_key='cr-f04-expiry-payment-20261107'),'expired','releases the expired booking hold');
select is((select count(*)::int from public.mova_appointment_events e join public.mova_appointments a on a.id=e.appointment_id where a.idempotency_key in ('cr-f04-expiry-spanish-20261107','cr-f04-expiry-payment-20261107') and e.to_status='expired'),2,'writes one expiry state event for each booking');
select is((select count(*)::int from public.mova_outbox_events where idempotency_key in ((select id::text||':request-expired' from public.mova_appointments where idempotency_key='cr-f04-expiry-spanish-20261107'),(select id::text||':request-expired' from public.mova_appointments where idempotency_key='cr-f04-expiry-payment-20261107'))),2,'writes one outbox event per expired booking');
select is((select payload->>'client_locale' from public.mova_outbox_events where idempotency_key=(select id::text||':request-expired' from public.mova_appointments where idempotency_key='cr-f04-expiry-spanish-20261107')),'es-US','preserves Spanish locale in the request event');
select is((select payload->>'client_locale' from public.mova_outbox_events where idempotency_key=(select id::text||':request-expired' from public.mova_appointments where idempotency_key='cr-f04-expiry-payment-20261107')),'en-US','preserves English locale in the payment-hold event');
select is(public.mova_expire_booking_requests(now()),0,'rerun is idempotent');

select * from finish();
rollback;
