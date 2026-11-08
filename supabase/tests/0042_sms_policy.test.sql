begin;
select plan(16);

insert into public.mova_artist_businesses(id, name, status) values ('e4200000-0000-4000-8000-000000000001', 'SMS policy fixture', 'active');
insert into public.mova_locations(id, artist_business_id, name, location_type, booking_mode, calendar_ownership, payment_collector, time_zone)
values ('e4200000-0000-4000-8000-000000000101', 'e4200000-0000-4000-8000-000000000001', 'SMS studio', 'suite', 'instant', 'mova', 'artist', 'America/New_York');
insert into public.mova_services(id, artist_business_id, name, category, duration_minutes, base_price_minor, status)
values ('e4200000-0000-4000-8000-000000000201', 'e4200000-0000-4000-8000-000000000001', 'SMS service', 'Styling', 60, 5000, 'active');
insert into public.mova_clients(id, artist_business_id, display_name, phone, phone_normalized, preferred_locale) values
  ('e4200000-0000-4000-8000-000000000301', 'e4200000-0000-4000-8000-000000000001', 'Texting Client', '(202) 555-0101', '12025550101', 'es-US'),
  ('e4200000-0000-4000-8000-000000000302', 'e4200000-0000-4000-8000-000000000001', 'No Consent Client', '(202) 555-0102', '12025550102', 'en-US');
insert into public.mova_appointments(id, artist_business_id, location_id, service_id, client_id, source, status, starts_at, ends_at,
  service_name_snapshot, service_price_minor, client_name, manage_token_hash, idempotency_key)
select ('e4200000-0000-4000-8000-0000000004' || n)::uuid, 'e4200000-0000-4000-8000-000000000001', 'e4200000-0000-4000-8000-000000000101',
  'e4200000-0000-4000-8000-000000000201', ('e4200000-0000-4000-8000-0000000003' || n)::uuid, 'artist', 'completed',
  timestamptz '2026-10-01 15:00:00+00' + (n::int || ' days')::interval, timestamptz '2026-10-01 16:00:00+00' + (n::int || ' days')::interval,
  'SMS service', 5000, 'Client ' || n, decode(md5('sms-' || n), 'hex') || decode(md5('tok-' || n), 'hex'), 'sms-fixture-' || n
from (values ('01'), ('02')) v(n);
insert into public.mova_client_consents(artist_business_id, client_id, purpose, channel, granted, changed_at)
values ('e4200000-0000-4000-8000-000000000001', 'e4200000-0000-4000-8000-000000000301', 'offers', 'sms', true, now() - interval '30 days');
insert into public.mova_sending_identities(artist_business_id, channel, address, provider, registration_status, status)
values ('e4200000-0000-4000-8000-000000000001', 'sms', '+12025559999', 'fake', 'approved', 'active');

-- 14:00 UTC = 09:00 New York (inside sending hours); 12:00 UTC = 07:00 (quiet).
select is(public.mova_sms_send_gate('e4200000-0000-4000-8000-000000000001', 'e4200000-0000-4000-8000-000000000301', 'offers', timestamptz '2026-11-10 15:00:00+00') ->> 'reason', 'eligible', 'TC-SMS-01 consented client can get an offer text');
select is(public.mova_sms_send_gate('e4200000-0000-4000-8000-000000000001', 'e4200000-0000-4000-8000-000000000301', 'offers', timestamptz '2026-11-10 15:00:00+00') ->> 'to', '+12025550101', 'TC-SMS-01 gate returns the E.164 recipient');
select is(public.mova_sms_send_gate('e4200000-0000-4000-8000-000000000001', 'e4200000-0000-4000-8000-000000000302', 'offers', timestamptz '2026-11-10 15:00:00+00') ->> 'reason', 'consent_missing', 'TC-SMS-02 no consent, no offer text');
select is(public.mova_sms_send_gate('e4200000-0000-4000-8000-000000000001', 'e4200000-0000-4000-8000-000000000301', 'offers', timestamptz '2026-11-10 12:00:00+00') ->> 'reason', 'quiet_hours', 'TC-SMS-03 quiet hours block marketing texts');
select is(public.mova_sms_send_gate('e4200000-0000-4000-8000-000000000001', 'e4200000-0000-4000-8000-000000000302', 'transactional', timestamptz '2026-11-10 12:00:00+00') ->> 'reason', 'eligible', 'TC-SMS-03 transactional texts skip consent and quiet hours');

insert into public.mova_messages(artist_business_id, client_id, direction, channel, purpose, origin, body, status, idempotency_key, created_at)
values ('e4200000-0000-4000-8000-000000000001', 'e4200000-0000-4000-8000-000000000301', 'outbound', 'sms', 'offers', 'seat_filler', 'Slot open', 'sent', 'cap-1', timestamptz '2026-11-10 14:30:00+00');
select is(public.mova_sms_send_gate('e4200000-0000-4000-8000-000000000001', 'e4200000-0000-4000-8000-000000000301', 'offers', timestamptz '2026-11-10 15:00:00+00') ->> 'reason', 'daily_cap', 'TC-SMS-04 one marketing text per client per day by default');
select is(public.mova_sms_send_gate('e4200000-0000-4000-8000-000000000001', 'e4200000-0000-4000-8000-000000000301', 'offers', timestamptz '2026-11-11 15:00:00+00') ->> 'reason', 'eligible', 'TC-SMS-04 the cap is a rolling 24 hours');
select set_config('mova.sms_daily_cap', '2', true);
select is(public.mova_sms_send_gate('e4200000-0000-4000-8000-000000000001', 'e4200000-0000-4000-8000-000000000301', 'offers', timestamptz '2026-11-10 15:00:00+00') ->> 'reason', 'eligible', 'TC-SMS-04 the cap follows the server setting');
select set_config('mova.sms_daily_cap', '', true);

select is(jsonb_array_length(public.mova_sms_handle_inbound('(202) 555-9999', '+1 202 555 0101', 'STOP', 'stop', 'fake', 'in-1', timestamptz '2026-11-10 16:00:00+00') -> 'businesses'), 1, 'TC-SMS-05 STOP is matched to the stylist number');
select ok(exists(select 1 from public.mova_suppressions where artist_business_id = 'e4200000-0000-4000-8000-000000000001' and channel = 'sms' and reason = 'stop'), 'TC-SMS-05 STOP adds a suppression');
select is((select count(*)::int from public.mova_client_consents where client_id = 'e4200000-0000-4000-8000-000000000301' and granted = false and evidence ->> 'keyword' = 'stop'), 4, 'TC-SMS-05 STOP revokes SMS consent for every purpose');
select is(public.mova_sms_send_gate('e4200000-0000-4000-8000-000000000001', 'e4200000-0000-4000-8000-000000000301', 'transactional', timestamptz '2026-11-12 15:00:00+00') ->> 'reason', 'suppressed', 'TC-SMS-05 after STOP even transactional texts stop');
select is((select count(*)::int from public.mova_messages where direction = 'inbound' and provider_message_id = 'in-1'), 1, 'TC-SMS-05 the inbound text is logged');

select public.mova_sms_handle_inbound('+12025559999', '2025550101', 'start', 'start', 'fake', 'in-2', timestamptz '2026-11-10 17:00:00+00');
select ok(not exists(select 1 from public.mova_suppressions where artist_business_id = 'e4200000-0000-4000-8000-000000000001' and channel = 'sms' and reason = 'stop'), 'TC-SMS-06 START removes the suppression');
select is(public.mova_sms_send_gate('e4200000-0000-4000-8000-000000000001', 'e4200000-0000-4000-8000-000000000301', 'offers', timestamptz '2026-11-12 15:00:00+00') ->> 'reason', 'consent_missing', 'TC-SMS-06 START does not re-grant marketing consent');

select ok(not has_function_privilege('authenticated', 'public.mova_sms_send_gate(uuid,uuid,text,timestamptz)', 'EXECUTE') and not has_function_privilege('anon', 'public.mova_sms_handle_inbound(text,text,text,text,text,text,timestamptz)', 'EXECUTE'), 'TC-SMS-07 only the service role can call the SMS policy functions');

select * from finish();
rollback;
