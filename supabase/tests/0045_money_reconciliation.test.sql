begin;
select plan(17);

-- Task 4.1: the Stripe sandbox journey from providers/stripe/fixtures, replayed through the SQL the
-- Edge Functions call: deposit Checkout, Stripe fee, balance pay link, partial refund. Money must match.
insert into public.mova_artist_businesses(id, name, status) values ('e4600000-0000-4000-8000-000000000001', 'Reconciliation fixture', 'active');
insert into public.mova_locations(id, artist_business_id, name, location_type, booking_mode, calendar_ownership, payment_collector, time_zone)
values ('e4600000-0000-4000-8000-000000000101', 'e4600000-0000-4000-8000-000000000001', 'Recon studio', 'suite', 'instant', 'mova', 'artist', 'UTC');
insert into public.mova_services(id, artist_business_id, name, category, duration_minutes, base_price_minor, status, deposit_type, deposit_value)
values ('e4600000-0000-4000-8000-000000000201', 'e4600000-0000-4000-8000-000000000001', 'Recon service', 'Styling', 60, 8000, 'active', 'fixed', 2000);
insert into public.mova_stripe_connections(artist_business_id, stripe_account_id, account_type, status, charges_enabled, payouts_enabled, details_submitted)
values ('e4600000-0000-4000-8000-000000000001', 'acct_e4600000fixture', 'standard', 'active', true, true, true);
insert into public.mova_appointments(id, artist_business_id, location_id, service_id, source, status, starts_at, ends_at, service_name_snapshot, service_price_minor,
  deposit_due_minor, balance_due_minor, client_name, client_email, manage_token_hash, idempotency_key)
values ('e4600000-0000-4000-8000-000000000401', 'e4600000-0000-4000-8000-000000000001', 'e4600000-0000-4000-8000-000000000101', 'e4600000-0000-4000-8000-000000000201', 'showcase', 'pending_payment',
  date_trunc('day', now()) + interval '3 days 15 hours', date_trunc('day', now()) + interval '3 days 16 hours', 'Recon service', 8000, 2000, 6000, 'Recon Client', 'recon@example.invalid',
  decode(md5('recon-token'), 'hex') || decode(md5('recon-token-2'), 'hex'), 'recon-booking');
insert into public.mova_booking_holds(artist_business_id, appointment_id, location_id, starts_at, ends_at, expires_at)
select artist_business_id, id, location_id, starts_at, ends_at, now() + interval '10 minutes' from public.mova_appointments where id = 'e4600000-0000-4000-8000-000000000401';

-- 1. Deposit Checkout.
create temp table recon(k text primary key, v text);
insert into recon select 'deposit_payment', public.mova_stripe_checkout_prepare('e4600000-0000-4000-8000-000000000401', decode(md5('recon-token'), 'hex') || decode(md5('recon-token-2'), 'hex'), 'recon-deposit-checkout') ->> 'payment_id';
select ok(public.mova_stripe_checkout_attach((select v::uuid from recon where k = 'deposit_payment'), 'cs_test_e4600000_deposit', 'https://checkout.stripe.com/c/pay/cs_test_e4600000_deposit'), 'TC-RECON-01 Checkout session attaches to the deposit payment');
select is(public.mova_stripe_webhook_apply('evt_test_deposit_completed', 'checkout.session.completed', 'acct_e4600000fixture', 'cs_test_e4600000_deposit', 'pi_test_e4600000_deposit', 'paid', 2000, false) ->> 'status', 'confirmed', 'TC-RECON-01 the paid webhook confirms the booking');
select is(public.mova_stripe_webhook_apply('evt_test_deposit_completed', 'checkout.session.completed', 'acct_e4600000fixture', 'cs_test_e4600000_deposit', 'pi_test_e4600000_deposit', 'paid', 2000, false) ->> 'duplicate', 'true', 'TC-RECON-01 a redelivered event is a no-op');
select ok(public.mova_stripe_enqueue_processor_fee((select v::uuid from recon where k = 'deposit_payment'), 'pi_test_e4600000_deposit', 'acct_e4600000fixture'), 'TC-RECON-02 the Stripe fee job is queued');
select is(public.mova_stripe_record_processor_fee((select v::uuid from recon where k = 'deposit_payment'), 88), 'posted', 'TC-RECON-02 Stripe processing is posted');
select is(public.mova_stripe_record_processor_fee((select v::uuid from recon where k = 'deposit_payment'), 88), 'already_posted', 'TC-RECON-02 and only once');
select throws_ok($$select public.mova_stripe_record_processor_fee((select v::uuid from recon where k = 'deposit_payment'), 90)$$, '22023', 'STRIPE_FEE_MISMATCH', 'TC-RECON-02 a different fee for the same payment is refused');

-- 2. Balance by SMS pay link.
insert into recon select 'paylink', public.mova_stripe_paylink_prepare('e4600000-0000-4000-8000-000000000001', 'e4600000-0000-4000-8000-000000000401', 'sms', repeat('e46paylinkcode', 4), 'recon-paylink-1')::text;
select is(((select v::jsonb from recon where k = 'paylink') ->> 'amount_minor')::bigint, 6000::bigint, 'TC-RECON-03 the pay link is for the remaining balance');
select ok(public.mova_stripe_paylink_attach(((select v::jsonb from recon where k = 'paylink') ->> 'link_id')::uuid, 'cs_test_e4600000_paylink', 'https://checkout.stripe.com/c/pay/cs_test_e4600000_paylink'), 'TC-RECON-03 the pay link session attaches');
select is(public.mova_stripe_webhook_apply('evt_test_paylink_completed', 'checkout.session.completed', 'acct_e4600000fixture', 'cs_test_e4600000_paylink', 'pi_test_e4600000_paylink', 'paid', 6000, false) ->> 'checkout_kind', 'paylink', 'TC-RECON-03 the paid pay link is recorded');
select is(public.mova_stripe_record_processor_fee(((select v::jsonb from recon where k = 'paylink') ->> 'payment_id')::uuid, 204), 'posted', 'TC-RECON-03 its Stripe fee is posted');
select is((select balance_due_minor from public.mova_appointments where id = 'e4600000-0000-4000-8000-000000000401'), 0::bigint, 'TC-RECON-03 nothing is left to pay');

-- 3. Partial refund of the pay-link payment.
insert into recon select 'refund', public.mova_stripe_refund_prepare('e4600000-0000-4000-8000-000000000001', ((select v::jsonb from recon where k = 'paylink') ->> 'payment_id')::uuid, 1500, 'recon-refund-1') ->> 'refund_id';
select ok(public.mova_stripe_refund_finish((select v::uuid from recon where k = 'refund'), 're_test_e4600000_refund', 'pending'), 'TC-RECON-04 the refund is recorded as pending');
select is(public.mova_stripe_refund_webhook_apply('evt_test_refund_succeeded', 're_test_e4600000_refund', 'succeeded', 'acct_e4600000fixture', false) ->> 'status', 'succeeded', 'TC-RECON-04 the refund webhook completes it');

-- 4. Money (17) equals the ledger: processed 80.00, Mova fee -(0.30 + 0.90) + 0.23 returned on the refund,
--    Stripe processing -(0.88 + 2.04), refunds -15.00.
create temp table money as select public.mova_money_month_summary('e4600000-0000-4000-8000-000000000001', date_trunc('month', now() at time zone 'UTC')::date) -> 'totals' as t;
select is((select t from money), jsonb_build_object(
  'service_value_minor', 8000, 'mova_processed_minor', 8000, 'recorded_by_artist_minor', 0, 'collected_by_salon_minor', 0,
  'mova_platform_fee_minor', -97, 'processor_fee_minor', -292, 'refunds_minor', -1500, 'estimated_to_artist_minor', 6111), 'TC-RECON-05 Money totals match the sandbox journey');
select is(((select t from money) ->> 'mova_platform_fee_minor')::bigint,
  (select -sum(platform_fee_minor) from public.mova_payments where artist_business_id = 'e4600000-0000-4000-8000-000000000001' and status in ('succeeded', 'partially_refunded', 'refunded'))::bigint + 23,
  'TC-RECON-05 the Mova fee is the stored per-payment fees less the share returned with the refund');
select is(((select t from money) ->> 'processor_fee_minor')::bigint,
  (select -sum(processor_fee_minor) from public.mova_payments where artist_business_id = 'e4600000-0000-4000-8000-000000000001')::bigint,
  'TC-RECON-05 Stripe processing equals the fees stored on the payments');

select * from finish();
rollback;
