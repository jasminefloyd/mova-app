begin;
select plan(8);

-- These assertions use local rows and do not require the optional demo seed/Auth user.
insert into public.mova_artist_businesses (id, name, status)
values ('e2500000-0000-4000-8000-000000000001', 'Slot event test tenant', 'active');
insert into public.mova_locations (
  id, artist_business_id, name, location_type, booking_mode,
  calendar_ownership, payment_collector, time_zone
) values
  ('e2500000-0000-4000-8000-000000000101', 'e2500000-0000-4000-8000-000000000001', 'Slot studio', 'suite', 'instant', 'mova', 'artist', 'America/New_York'),
  ('e2500000-0000-4000-8000-000000000102', 'e2500000-0000-4000-8000-000000000001', 'External slot salon', 'commission_salon', 'request', 'mova', 'salon', 'America/New_York');
insert into public.mova_services (
  id, artist_business_id, name, category, duration_minutes, base_price_minor,
  status, deposit_type, deposit_value
) values (
  'e2500000-0000-4000-8000-000000000202',
  'e2500000-0000-4000-8000-000000000001',
  'Slot test service', 'Styling', 60, 8000, 'active', 'none', 0
);

insert into public.mova_appointments(
  artist_business_id,location_id,service_id,source,status,starts_at,ends_at,
  service_name_snapshot,service_price_minor,deposit_due_minor,balance_due_minor,
  client_name,manage_token_hash,idempotency_key
) values
  (
    'e2500000-0000-4000-8000-000000000001'::uuid,
    'e2500000-0000-4000-8000-000000000101'::uuid,
    'e2500000-0000-4000-8000-000000000202'::uuid,
    'showcase','confirmed',now()+interval '30 days',now()+interval '30 days 60 minutes',
    'Slot Cancelled',8000,0,8000,'Slot Cancelled',decode(repeat('b1',32),'hex'),'cr-f04-slot-cancel-20261107'
  ),
  (
    'e2500000-0000-4000-8000-000000000001'::uuid,
    'e2500000-0000-4000-8000-000000000101'::uuid,
    'e2500000-0000-4000-8000-000000000202'::uuid,
    'showcase','confirmed',now()+interval '32 days',now()+interval '32 days 60 minutes',
    'Slot No Show',8000,0,8000,'Slot No Show',decode(repeat('b2',32),'hex'),'cr-f04-slot-noshow-20261107'
  ),
  (
    'e2500000-0000-4000-8000-000000000001'::uuid,
    'e2500000-0000-4000-8000-000000000102'::uuid,
    'e2500000-0000-4000-8000-000000000202'::uuid,
    'showcase','confirmed',now()+interval '34 days',now()+interval '34 days 60 minutes',
    'External Slot',8000,0,8000,'External Slot',decode(repeat('b3',32),'hex'),'cr-f04-slot-external-20261107'
  );

update public.mova_locations set calendar_ownership='external'
where id='e2500000-0000-4000-8000-000000000102'::uuid;

select is((public.mova_booking_transition(
  (select id from public.mova_appointments where idempotency_key='cr-f04-slot-cancel-20261107'),
  decode(repeat('b1',32),'hex'),'cancelled','artist','test_cancel','cr-f04-slot-cancel-transition'
)->>'status'),'cancelled','cancellation transition succeeds');
select is((public.mova_booking_transition(
  (select id from public.mova_appointments where idempotency_key='cr-f04-slot-cancel-20261107'),
  decode(repeat('b1',32),'hex'),'cancelled','artist','test_cancel','cr-f04-slot-cancel-transition'
)->>'replayed'),'true','idempotent cancellation replay is recognized');
select is((public.mova_booking_transition(
  (select id from public.mova_appointments where idempotency_key='cr-f04-slot-noshow-20261107'),
  decode(repeat('b2',32),'hex'),'no_show','artist','test_no_show','cr-f04-slot-noshow-transition'
)->>'status'),'no_show','no-show transition succeeds');
select is((public.mova_booking_transition(
  (select id from public.mova_appointments where idempotency_key='cr-f04-slot-external-20261107'),
  decode(repeat('b3',32),'hex'),'cancelled','artist','test_external','cr-f04-slot-external-transition'
)->>'status'),'cancelled','external-calendar cancellation succeeds');

select is((select count(*)::int from public.mova_outbox_events where aggregate_id=(select id from public.mova_appointments where idempotency_key='cr-f04-slot-cancel-20261107') and event_type='slot.opened'),1,'cancellation emits one slot event despite replay');
select is((select count(*)::int from public.mova_outbox_events where aggregate_id=(select id from public.mova_appointments where idempotency_key='cr-f04-slot-noshow-20261107') and event_type='slot.opened'),1,'no-show emits one slot event');
select is((select count(*)::int from public.mova_outbox_events where aggregate_id=(select id from public.mova_appointments where idempotency_key='cr-f04-slot-external-20261107') and event_type='slot.opened'),0,'external-calendar cancellation emits no slot event');
select is((select count(*)::int from public.mova_outbox_events where aggregate_id in (select id from public.mova_appointments where idempotency_key in ('cr-f04-slot-cancel-20261107','cr-f04-slot-noshow-20261107','cr-f04-slot-external-20261107')) and event_type='slot.opened'),2,'exactly two qualifying slot events are written');

select * from finish();
rollback;
