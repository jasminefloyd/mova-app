begin;
select plan(6);

-- Fixtures: one business, a stylist-collected location with a street address, a service with a deposit,
-- two clients with completed visits last week; one has a later booking.
insert into public.mova_artist_businesses(id, name, status) values ('e7100000-0000-4000-8000-000000000001', 'Details fixture', 'active');
insert into public.mova_locations(id, artist_business_id, name, location_type, booking_mode, calendar_ownership, payment_collector, time_zone, address)
values ('e7100000-0000-4000-8000-000000000101', 'e7100000-0000-4000-8000-000000000001', 'Details studio', 'suite', 'instant', 'mova', 'artist', 'America/Chicago', '{"street":"1200 N Milwaukee Ave, Chicago, IL"}');
insert into public.mova_services(id, artist_business_id, name, category, duration_minutes, base_price_minor, status)
values ('e7100000-0000-4000-8000-000000000201', 'e7100000-0000-4000-8000-000000000001', 'Silk press', 'Styling', 90, 9500, 'active');
insert into public.mova_clients(id, artist_business_id, display_name) values
  ('e7100000-0000-4000-8000-000000000301', 'e7100000-0000-4000-8000-000000000001', 'Rebooked Client'),
  ('e7100000-0000-4000-8000-000000000302', 'e7100000-0000-4000-8000-000000000001', 'Not Yet Client');
insert into public.mova_appointments(id, artist_business_id, location_id, service_id, client_id, source, status, starts_at, ends_at,
  service_name_snapshot, service_price_minor, deposit_due_minor, balance_due_minor, client_name, client_email, client_locale, manage_token_hash, idempotency_key)
values
  ('e7100000-0000-4000-8000-000000000401', 'e7100000-0000-4000-8000-000000000001', 'e7100000-0000-4000-8000-000000000101', 'e7100000-0000-4000-8000-000000000201', 'e7100000-0000-4000-8000-000000000301', 'showcase', 'completed',
   now() - interval '6 days', now() - interval '6 days' + interval '90 minutes', 'Silk press', 9500, 0, 9500, 'Rebooked Client', 'a@example.invalid', 'en-US', decode(md5('d-a'), 'hex'), 'd-a'),
  ('e7100000-0000-4000-8000-000000000402', 'e7100000-0000-4000-8000-000000000001', 'e7100000-0000-4000-8000-000000000101', 'e7100000-0000-4000-8000-000000000201', 'e7100000-0000-4000-8000-000000000302', 'showcase', 'completed',
   now() - interval '5 days', now() - interval '5 days' + interval '90 minutes', 'Silk press', 9500, 0, 9500, 'Not Yet Client', 'b@example.invalid', 'en-US', decode(md5('d-b'), 'hex'), 'd-b'),
  ('e7100000-0000-4000-8000-000000000403', 'e7100000-0000-4000-8000-000000000001', 'e7100000-0000-4000-8000-000000000101', 'e7100000-0000-4000-8000-000000000201', 'e7100000-0000-4000-8000-000000000301', 'showcase', 'confirmed',
   now() + interval '20 days', now() + interval '20 days' + interval '90 minutes', 'Silk press', 9500, 2500, 7000, 'Rebooked Client', 'a@example.invalid', 'en-US', decode(md5('d-c'), 'hex'), 'd-c');

-- 0107: the client email context carries the address, deposit, balance and collector.
select is(public.mova_appointment_email_context('e7100000-0000-4000-8000-000000000403', 'appointment.confirmed') ->> 'location_address', '1200 N Milwaukee Ave, Chicago, IL', 'EM details: street address');
select is((public.mova_appointment_email_context('e7100000-0000-4000-8000-000000000403', 'appointment.confirmed') ->> 'deposit_minor')::int, 2500, 'EM details: deposit');
select is(public.mova_appointment_email_context('e7100000-0000-4000-8000-000000000403', 'appointment.confirmed') ->> 'payment_collector', 'artist', 'EM details: who collects');
-- 0107: the stylist context links the request itself.
select ok((public.mova_appointment_stylist_email_context('e7100000-0000-4000-8000-000000000403') ->> 'appointment_number') is not null, 'EM12: appointment number for the request link');

-- 0108: of the two clients seen in the last week, one has a later booking.
select is(public.mova_reports_rebook_rate('e7100000-0000-4000-8000-000000000001', (now() - interval '7 days')::date, now()::date, 'America/Chicago'),
  '{"clients": 2, "rebooked": 1}'::jsonb, 'Reports 37: rebook rate counts clients with a later appointment');
select ok(not has_function_privilege('authenticated', 'public.mova_reports_rebook_rate(uuid, date, date, text)', 'execute'), 'Reports 37: service role only');

select * from finish();
rollback;
