begin;
select plan(6);

insert into public.mova_artist_businesses(id, name, status) values ('e4300000-0000-4000-8000-000000000001', 'Missed call fixture', 'active');
insert into public.mova_locations(id, artist_business_id, name, location_type, booking_mode, calendar_ownership, payment_collector, time_zone)
values ('e4300000-0000-4000-8000-000000000101', 'e4300000-0000-4000-8000-000000000001', 'Call studio', 'suite', 'instant', 'mova', 'artist', 'America/Chicago');
insert into public.mova_sending_identities(artist_business_id, channel, address, provider, registration_status, status)
values ('e4300000-0000-4000-8000-000000000001', 'sms', '+13125559999', 'fake', 'approved', 'active');

select is(public.mova_missed_call_gate('+13125559999', '+13125550111', timestamptz '2026-11-10 18:00:00+00') #>> '{businesses,0,reason}', 'disabled', 'TC-MISSED-01 text-back is off until the stylist turns it on');
insert into public.mova_concierge_settings(artist_business_id, channels) values ('e4300000-0000-4000-8000-000000000001', '{"missed_call":true}');
select is(public.mova_missed_call_gate('+13125559999', '+13125550111', timestamptz '2026-11-10 18:00:00+00') #>> '{businesses,0,reason}', 'eligible', 'TC-MISSED-02 a missed call during the day gets a text-back');
select is(public.mova_missed_call_gate('+13125559999', '+13125550111', timestamptz '2026-11-11 04:00:00+00') #>> '{businesses,0,reason}', 'quiet_hours', 'TC-MISSED-03 no text-back during quiet hours (22:00 Chicago)');
insert into public.mova_messages(artist_business_id, conversation_id, direction, channel, purpose, origin, body, status, idempotency_key, created_at)
select 'e4300000-0000-4000-8000-000000000001', id, 'outbound', 'sms', 'missed_call_textback', 'concierge', 'Sorry I missed your call', 'sent', 'mc-1', timestamptz '2026-11-10 18:00:00+00'
from public.mova_conversations where artist_business_id = 'e4300000-0000-4000-8000-000000000001' and channel = 'missed_call';
select is(public.mova_missed_call_gate('+13125559999', '+13125550111', timestamptz '2026-11-10 20:00:00+00') #>> '{businesses,0,reason}', 'already_texted', 'TC-MISSED-04 one text-back per caller per day');
select is((select count(*)::int from public.mova_conversations where artist_business_id = 'e4300000-0000-4000-8000-000000000001' and channel = 'missed_call' and status = 'needs_you'), 1, 'TC-MISSED-05 the missed call shows in Needs you once');
select public.mova_sms_handle_inbound('+13125559999', '+13125550111', 'STOP', 'stop', 'fake', 'mc-stop', timestamptz '2026-11-12 18:00:00+00');
select is(public.mova_missed_call_gate('+13125559999', '+13125550111', timestamptz '2026-11-13 18:00:00+00') #>> '{businesses,0,reason}', 'suppressed', 'TC-MISSED-06 a caller who sent STOP gets no text-back');

select * from finish();
rollback;
