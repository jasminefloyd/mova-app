begin;
select plan(9);

insert into public.mova_artist_businesses(id, name, status) values ('e4500000-0000-4000-8000-000000000001', 'Fee rate fixture', 'active');
insert into public.mova_locations(id, artist_business_id, name, location_type, booking_mode, calendar_ownership, payment_collector, time_zone)
values ('e4500000-0000-4000-8000-000000000101', 'e4500000-0000-4000-8000-000000000001', 'Fee studio', 'suite', 'instant', 'mova', 'artist', 'UTC');
insert into public.mova_services(id, artist_business_id, name, category, duration_minutes, base_price_minor, status)
values ('e4500000-0000-4000-8000-000000000201', 'e4500000-0000-4000-8000-000000000001', 'Fee service', 'Styling', 60, 10000, 'active');
insert into public.mova_appointments(id, artist_business_id, location_id, service_id, source, status, starts_at, ends_at, service_name_snapshot, service_price_minor, client_name, manage_token_hash, idempotency_key)
values ('e4500000-0000-4000-8000-000000000401', 'e4500000-0000-4000-8000-000000000001', 'e4500000-0000-4000-8000-000000000101', 'e4500000-0000-4000-8000-000000000201', 'artist', 'confirmed',
  date_trunc('month', now()) + interval '2 days', date_trunc('month', now()) + interval '2 days 1 hour', 'Fee service', 10000, 'Fee Client', decode(md5('fee-a'), 'hex'), 'fee-a');

insert into public.mova_payments(id, artist_business_id, appointment_id, method, collector, status, amount_minor, provider, provider_payment_id, idempotency_key)
values ('e4500000-0000-4000-8000-000000000501', 'e4500000-0000-4000-8000-000000000001', 'e4500000-0000-4000-8000-000000000401', 'card_checkout', 'mova_processed', 'succeeded', 10000, 'stripe', 'pi_fee_rate_1', 'fee-rate-pay-1');

select is((select platform_fee_bps from public.mova_payments where id = 'e4500000-0000-4000-8000-000000000501'), 150, 'TC-FEE-01 a card payment stores the 1.5% rate');
select is((select platform_fee_minor from public.mova_payments where id = 'e4500000-0000-4000-8000-000000000501'), 150::bigint, 'TC-FEE-01 and its fee amount');
select is((select platform_fee_version from public.mova_payments where id = 'e4500000-0000-4000-8000-000000000501'), 1, 'TC-FEE-01 and the fee version it used');

-- The setting changes to 2% from now on.
insert into public.mova_platform_fee_versions(version, fee_bps, effective_at) values (2, 200, now());
insert into public.mova_payments(id, artist_business_id, appointment_id, method, collector, status, amount_minor, provider, provider_payment_id, idempotency_key)
values ('e4500000-0000-4000-8000-000000000502', 'e4500000-0000-4000-8000-000000000001', 'e4500000-0000-4000-8000-000000000401', 'card_paylink_sms', 'mova_processed', 'succeeded', 10000, 'stripe', 'pi_fee_rate_2', 'fee-rate-pay-2');

select is((select platform_fee_bps from public.mova_payments where id = 'e4500000-0000-4000-8000-000000000501'), 150, 'TC-FEE-02 the earlier payment keeps its rate after the setting changes');
select is((select platform_fee_bps from public.mova_payments where id = 'e4500000-0000-4000-8000-000000000502'), 200, 'TC-FEE-02 a new payment uses the new rate');
select is((select fee_bps from public.mova_current_platform_fee(now())), 200, 'TC-FEE-02 one accessor reads the current setting');
select throws_ok($$update public.mova_payments set platform_fee_bps = 200 where id = 'e4500000-0000-4000-8000-000000000501'$$, '42501', 'PAYMENT_FEE_LOCKED', 'TC-FEE-03 a stored rate cannot be rewritten');
select lives_ok($$update public.mova_payments set status = 'partially_refunded' where id = 'e4500000-0000-4000-8000-000000000501'$$, 'TC-FEE-03 status changes still work');
select is((public.mova_money_month_summary('e4500000-0000-4000-8000-000000000001', date_trunc('month', now())::date) #>> '{totals,mova_platform_fee_minor}')::bigint, -350::bigint,
  'TC-FEE-04 Money fee total is the sum of each payment''s stored fee (150 + 200)');

select * from finish();
rollback;
