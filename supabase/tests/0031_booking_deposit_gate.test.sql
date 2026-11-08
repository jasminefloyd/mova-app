begin;
set local time zone 'America/New_York';
select plan(7);

-- Keep this DB test independent of the optional Rooted Beauty demo seed/Auth user.
insert into public.mova_artist_businesses (id, name, status)
values ('e2500000-0000-4000-8000-000000000001', 'Booking deposit test tenant', 'active');
insert into public.mova_locations (
  id, artist_business_id, name, location_type, booking_mode,
  calendar_ownership, payment_collector, time_zone
) values (
  'e2500000-0000-4000-8000-000000000101',
  'e2500000-0000-4000-8000-000000000001',
  'Deposit test studio', 'suite', 'instant', 'mova', 'artist', 'America/New_York'
);
insert into public.mova_location_policies (location_id, artist_business_id)
values ('e2500000-0000-4000-8000-000000000101', 'e2500000-0000-4000-8000-000000000001');
insert into public.mova_location_hours (artist_business_id, location_id, weekday, opens_at, closes_at)
select 'e2500000-0000-4000-8000-000000000001', 'e2500000-0000-4000-8000-000000000101', day, time '09:00', time '17:00'
from generate_series(0, 6) as day;
insert into public.mova_services (
  id, artist_business_id, name, category, duration_minutes, base_price_minor,
  status, deposit_type, deposit_value
) values (
  'e2500000-0000-4000-8000-000000000202',
  'e2500000-0000-4000-8000-000000000001',
  'Deposit test service', 'Styling', 60, 8000, 'active', 'fixed', 2000
);

select has_function('public'::name, 'mova_booking_create'::name, array['uuid','uuid','timestamp with time zone','text','text','text','text','text','bytea']::name[]);

select throws_ok($$
  select public.mova_booking_create(
    'e2500000-0000-4000-8000-000000000101'::uuid,
    'e2500000-0000-4000-8000-000000000202'::uuid,
    date_trunc('day',now()+interval '30 days')+interval '12 hours',
    'Deposit Gate Test','deposit-gate@example.invalid','+12025550199','en-US',
    'deposit-gate-new',decode(repeat('ab',32),'hex')
  )
$$,'22023','DEPOSIT_PAYMENT_UNAVAILABLE','deposit booking is rejected before checkout exists');

select is((select count(*)::int from public.mova_appointments where idempotency_key='deposit-gate-new'),0,'blocked booking creates no appointment');
select is((select count(*)::int from public.mova_booking_holds h join public.mova_appointments a on a.id=h.appointment_id where a.idempotency_key='deposit-gate-new'),0,'blocked booking creates no expiring hold');
select is((select count(*)::int from public.mova_outbox_events where idempotency_key='deposit-gate-new:created-event'),0,'blocked booking emits no appointment event');

insert into public.mova_appointments(
  artist_business_id,location_id,service_id,source,status,starts_at,ends_at,
  service_name_snapshot,service_price_minor,deposit_due_minor,balance_due_minor,
  client_name,manage_token_hash,idempotency_key
) values(
  'e2500000-0000-4000-8000-000000000001'::uuid,
  'e2500000-0000-4000-8000-000000000101'::uuid,
  'e2500000-0000-4000-8000-000000000202'::uuid,
  'showcase','pending_payment',date_trunc('day',now()+interval '30 days')+interval '12 hours',
  date_trunc('day',now()+interval '30 days')+interval '13 hours',
  'Hydration Treatment',8000,2000,6000,'Existing Pending Booking',
  decode(repeat('cd',32),'hex'),'deposit-gate-replay'
);

select throws_ok($$
  select public.mova_booking_create(
    'e2500000-0000-4000-8000-000000000101'::uuid,
    'e2500000-0000-4000-8000-000000000202'::uuid,
    date_trunc('day',now()+interval '30 days')+interval '12 hours',
    'Deposit Gate Test','deposit-gate@example.invalid','+12025550199','en-US',
    'deposit-gate-replay',decode(repeat('ef',32),'hex')
  )
$$,'22023','DEPOSIT_PAYMENT_UNAVAILABLE','idempotent replay cannot return a pending-payment booking without checkout');
select is((select status from public.mova_appointments where idempotency_key='deposit-gate-replay'),'pending_payment','blocked replay does not mutate the existing booking');

select * from finish();
rollback;
