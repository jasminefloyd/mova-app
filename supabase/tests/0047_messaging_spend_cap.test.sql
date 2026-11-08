begin;
select plan(9);

insert into public.mova_artist_businesses(id, name, status) values ('e4800000-0000-4000-8000-000000000001', 'Spend cap fixture', 'active');
-- Isolate from other rows: a cap of $50 (default) and this month's spend measured from zero.
delete from public.mova_messages where direction = 'outbound' and channel in ('sms', 'email');

select is(public.mova_messaging_spend_cap_micros(), 50000000::bigint, 'TC-CAP-01 the default cap is $50 a month');

insert into public.mova_messages(id, artist_business_id, direction, channel, purpose, origin, body, status, idempotency_key, cost_micros, created_at) values
  ('e4800000-0000-4000-8000-000000000101', 'e4800000-0000-4000-8000-000000000001', 'outbound', 'sms', 'offers', 'seat_filler', 'spent', 'sent', 'cap-spent', 49990000, timestamptz '2026-11-03 12:00:00+00'),
  ('e4800000-0000-4000-8000-000000000102', 'e4800000-0000-4000-8000-000000000001', 'outbound', 'email', 'booking_confirmation', 'transactional', 'failed', 'failed', 'cap-failed', 5000000, timestamptz '2026-11-03 12:00:00+00'),
  ('e4800000-0000-4000-8000-000000000103', 'e4800000-0000-4000-8000-000000000001', 'outbound', 'sms', 'offers', 'seat_filler', 'last month', 'sent', 'cap-october', 30000000, timestamptz '2026-10-31 23:59:00+00'),
  ('e4800000-0000-4000-8000-000000000201', 'e4800000-0000-4000-8000-000000000001', 'outbound', 'sms', 'offers', 'seat_filler', 'queued 1', 'queued', 'cap-q1', null, timestamptz '2026-11-08 12:00:00+00'),
  ('e4800000-0000-4000-8000-000000000202', 'e4800000-0000-4000-8000-000000000001', 'outbound', 'email', 'booking_confirmation', 'transactional', 'queued 2', 'queued', 'cap-q2', null, timestamptz '2026-11-08 12:00:00+00');

select is(public.mova_messaging_month_spend_micros(timestamptz '2026-11-08 12:00:00+00'), 49990000::bigint, 'TC-CAP-02 spend counts this UTC month only, without failed sends');
select is(public.mova_messaging_reserve_spend('e4800000-0000-4000-8000-000000000201', 8300, timestamptz '2026-11-08 12:00:00+00') ->> 'allowed', 'true', 'TC-CAP-03 a text that fits under the cap is reserved');
select is((select cost_micros from public.mova_messages where id = 'e4800000-0000-4000-8000-000000000201'), 8300::bigint, 'TC-CAP-03 its estimated cost is recorded');
select is(public.mova_messaging_reserve_spend('e4800000-0000-4000-8000-000000000202', 2000, timestamptz '2026-11-08 12:00:00+00') ->> 'reason', 'spend_cap_reached', 'TC-CAP-04 email and SMS share the cap: the next email would pass $50 and is paused');
select is((select status || ':' || error_code from public.mova_messages where id = 'e4800000-0000-4000-8000-000000000202'), 'suppressed:spend_cap_reached', 'TC-CAP-04 the paused message is recorded as suppressed');
select is(public.mova_messaging_month_spend_micros(timestamptz '2026-12-01 00:00:00+00'), 0::bigint, 'TC-CAP-05 the cap resets on the 1st (UTC)');
select set_config('mova.messaging_spend_cap_micros', '60000000', true);
select is(public.mova_messaging_spend_cap_micros(), 60000000::bigint, 'TC-CAP-06 the cap is one server setting');
select ok(not has_function_privilege('authenticated', 'public.mova_messaging_reserve_spend(uuid,bigint,timestamptz)', 'EXECUTE'), 'TC-CAP-07 only the service role reserves spend');

select * from finish();
rollback;
