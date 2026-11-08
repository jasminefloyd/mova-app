begin;
select plan(9);

insert into public.mova_artist_businesses(id, name, status) values ('e4400000-0000-4000-8000-000000000001', 'Email fixture', 'active');
insert into public.mova_locations(id, artist_business_id, name, location_type, booking_mode, calendar_ownership, payment_collector, time_zone)
values ('e4400000-0000-4000-8000-000000000101', 'e4400000-0000-4000-8000-000000000001', 'Email studio', 'suite', 'instant', 'mova', 'artist', 'America/New_York');
insert into public.mova_services(id, artist_business_id, name, category, duration_minutes, base_price_minor, status)
values ('e4400000-0000-4000-8000-000000000201', 'e4400000-0000-4000-8000-000000000001', 'Email service', 'Styling', 60, 5000, 'active');
insert into public.mova_appointments(id, artist_business_id, location_id, service_id, source, status, starts_at, ends_at,
  service_name_snapshot, service_price_minor, client_name, client_email, client_locale, manage_token_hash, idempotency_key)
values
  ('e4400000-0000-4000-8000-000000000401', 'e4400000-0000-4000-8000-000000000001', 'e4400000-0000-4000-8000-000000000101', 'e4400000-0000-4000-8000-000000000201', 'showcase', 'confirmed',
   now() + interval '24 hours', now() + interval '25 hours', 'Email service', 5000, 'Instant Guest', 'instant@example.invalid', 'es-US', decode(md5('email-a'), 'hex'), 'email-a'),
  ('e4400000-0000-4000-8000-000000000402', 'e4400000-0000-4000-8000-000000000001', 'e4400000-0000-4000-8000-000000000101', 'e4400000-0000-4000-8000-000000000201', 'showcase', 'confirmed',
   now() + interval '72 hours', now() + interval '73 hours', 'Email service', 5000, 'Request Guest', 'request@example.invalid', 'en-US', decode(md5('email-b'), 'hex'), 'email-b');
insert into public.mova_appointment_events(artist_business_id, appointment_id, from_status, to_status, actor_type, reason, idempotency_key)
values ('e4400000-0000-4000-8000-000000000001', 'e4400000-0000-4000-8000-000000000402', null, 'pending_artist', 'guest', 'booking_created', 'email-b:created');

select is(public.mova_appointment_email_context('e4400000-0000-4000-8000-000000000401', 'appointment.confirmed') ->> 'template_id', 'booking_confirmation', 'TC-EMAIL-01 instant booking gets a confirmation');
select is(public.mova_appointment_email_context('e4400000-0000-4000-8000-000000000402', 'appointment.confirmed') ->> 'template_id', 'request_accepted', 'TC-EMAIL-01 an accepted request gets the accepted email');
select is(public.mova_appointment_email_context('e4400000-0000-4000-8000-000000000402', 'appointment.pending_artist') ->> 'template_id', 'request_received', 'TC-EMAIL-01 a new request gets request received');
select is(public.mova_appointment_email_context('e4400000-0000-4000-8000-000000000402', 'appointment.declined') ->> 'template_id', 'request_declined', 'TC-EMAIL-01 a declined request gets the declined email');
select is(public.mova_appointment_email_context('e4400000-0000-4000-8000-000000000401', 'appointment.no_show') ->> 'template_id', null, 'TC-EMAIL-01 other events send no email');
select is(public.mova_appointment_email_context('e4400000-0000-4000-8000-000000000401', 'appointment.confirmed') ->> 'locale', 'es-US', 'TC-EMAIL-01 the client language comes from the booking');

select public.mova_enqueue_appointment_reminders(now());
select is((select count(*)::int from public.mova_background_jobs where job_type = 'appointment_reminder' and artist_business_id = 'e4400000-0000-4000-8000-000000000001'), 1, 'TC-EMAIL-02 reminders are queued only for appointments about 24 hours away');
select public.mova_enqueue_appointment_reminders(now());
select is((select count(*)::int from public.mova_background_jobs where job_type = 'appointment_reminder' and artist_business_id = 'e4400000-0000-4000-8000-000000000001'), 1, 'TC-EMAIL-02 reminder queueing is idempotent');

insert into public.mova_suppressions(artist_business_id, channel, address_hash, reason)
values ('e4400000-0000-4000-8000-000000000001', 'email', encode(sha256(convert_to('instant@example.invalid', 'UTF8')), 'hex'), 'bounce');
select is(public.mova_email_send_gate('e4400000-0000-4000-8000-000000000001', ' Instant@Example.invalid ') ->> 'reason', 'suppressed', 'TC-EMAIL-03 bounced addresses are not emailed again');

select * from finish();
rollback;
