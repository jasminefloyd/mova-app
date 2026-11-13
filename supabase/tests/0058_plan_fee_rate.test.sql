begin;
select plan(9);

insert into public.mova_artist_businesses(id, name, status) values
  ('e5800000-0000-4000-8000-000000000001', 'Plan fee Pro fixture', 'active'),
  ('e5800000-0000-4000-8000-000000000002', 'Plan fee no-plan fixture', 'active');
insert into public.mova_locations(id, artist_business_id, name, location_type, booking_mode, calendar_ownership, payment_collector, time_zone) values
  ('e5800000-0000-4000-8000-000000000101', 'e5800000-0000-4000-8000-000000000001', 'Pro studio', 'suite', 'instant', 'mova', 'artist', 'UTC'),
  ('e5800000-0000-4000-8000-000000000102', 'e5800000-0000-4000-8000-000000000002', 'Plain studio', 'suite', 'instant', 'mova', 'artist', 'UTC');
insert into public.mova_services(id, artist_business_id, name, category, duration_minutes, base_price_minor, status) values
  ('e5800000-0000-4000-8000-000000000201', 'e5800000-0000-4000-8000-000000000001', 'Pro service', 'Styling', 60, 10000, 'active'),
  ('e5800000-0000-4000-8000-000000000202', 'e5800000-0000-4000-8000-000000000002', 'Plain service', 'Styling', 60, 10000, 'active');
insert into public.mova_appointments(id, artist_business_id, location_id, service_id, source, status, starts_at, ends_at, service_name_snapshot, service_price_minor, client_name, manage_token_hash, idempotency_key) values
  ('e5800000-0000-4000-8000-000000000401', 'e5800000-0000-4000-8000-000000000001', 'e5800000-0000-4000-8000-000000000101', 'e5800000-0000-4000-8000-000000000201', 'artist', 'confirmed',
   now() + interval '2 days', now() + interval '2 days 1 hour', 'Pro service', 10000, 'Plan Client', decode(md5('plan-fee-a'), 'hex'), 'plan-fee-a'),
  ('e5800000-0000-4000-8000-000000000402', 'e5800000-0000-4000-8000-000000000002', 'e5800000-0000-4000-8000-000000000102', 'e5800000-0000-4000-8000-000000000202', 'artist', 'confirmed',
   now() + interval '2 days', now() + interval '2 days 1 hour', 'Plain service', 10000, 'Plain Client', decode(md5('plan-fee-b'), 'hex'), 'plan-fee-b');

delete from public.mova_business_plan_assignments where artist_business_id in ('e5800000-0000-4000-8000-000000000001', 'e5800000-0000-4000-8000-000000000002');
insert into public.mova_business_plan_assignments(artist_business_id, plan_key, assignment_status) values ('e5800000-0000-4000-8000-000000000001', 'pro', 'current');

insert into public.mova_payments(id, artist_business_id, appointment_id, method, collector, status, amount_minor, provider, provider_payment_id, idempotency_key) values
  ('e5800000-0000-4000-8000-000000000501', 'e5800000-0000-4000-8000-000000000001', 'e5800000-0000-4000-8000-000000000401', 'card_checkout', 'mova_processed', 'succeeded', 10000, 'stripe', 'pi_plan_fee_1', 'plan-fee-pay-1'),
  ('e5800000-0000-4000-8000-000000000502', 'e5800000-0000-4000-8000-000000000002', 'e5800000-0000-4000-8000-000000000402', 'card_checkout', 'mova_processed', 'succeeded', 10000, 'stripe', 'pi_plan_fee_2', 'plan-fee-pay-2');

select is((select platform_fee_bps from public.mova_payments where id = 'e5800000-0000-4000-8000-000000000501'), 100, 'TC-PLANFEE-01 a Pro stylist''s card payment takes 1.0%');
select is((select platform_fee_minor from public.mova_payments where id = 'e5800000-0000-4000-8000-000000000501'), 100::bigint, 'TC-PLANFEE-01 and $1.00 on $100');
select is((select platform_fee_plan_key from public.mova_payments where id = 'e5800000-0000-4000-8000-000000000501'), 'pro', 'TC-PLANFEE-01 and records the plan it came from');
select is((select platform_fee_bps from public.mova_payments where id = 'e5800000-0000-4000-8000-000000000502'), 150, 'TC-PLANFEE-02 a stylist with no plan pays the platform rate');
select ok((select platform_fee_version is not null and platform_fee_plan_key is null from public.mova_payments where id = 'e5800000-0000-4000-8000-000000000502'), 'TC-PLANFEE-02 and records the platform fee version');

-- The stylist moves to AI + Growth: new payments take 0.75%, the earlier one keeps 1.0%.
update public.mova_business_plan_assignments set plan_key = 'ai_growth' where artist_business_id = 'e5800000-0000-4000-8000-000000000001';
insert into public.mova_payments(id, artist_business_id, appointment_id, method, collector, status, amount_minor, provider, provider_payment_id, idempotency_key)
values ('e5800000-0000-4000-8000-000000000503', 'e5800000-0000-4000-8000-000000000001', 'e5800000-0000-4000-8000-000000000401', 'card_paylink_sms', 'mova_processed', 'succeeded', 10000, 'stripe', 'pi_plan_fee_3', 'plan-fee-pay-3');
select is((select platform_fee_bps from public.mova_payments where id = 'e5800000-0000-4000-8000-000000000503'), 75, 'TC-PLANFEE-03 after upgrading to AI + Growth, new payments take 0.75%');
select is((select platform_fee_bps from public.mova_payments where id = 'e5800000-0000-4000-8000-000000000501'), 100, 'TC-PLANFEE-03 the earlier payment keeps 1.0%');
select throws_ok($$update public.mova_payments set platform_fee_plan_key = 'free' where id = 'e5800000-0000-4000-8000-000000000501'$$, '42501', 'PAYMENT_FEE_LOCKED', 'TC-PLANFEE-04 the plan on a payment cannot be rewritten');
select ok(not has_function_privilege('authenticated', 'public.mova_business_fee(uuid, timestamptz)', 'EXECUTE'), 'TC-PLANFEE-05 stylists cannot call the fee lookup directly');

select * from finish();
rollback;
