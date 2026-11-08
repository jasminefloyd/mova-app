# Stripe sandbox journey (task 4.1)

Live Stripe waits on owner decision O7. Everything below is **test mode only** (`sk_test_…`, `whsec_…`,
`livemode: false`); the code refuses live keys and live events.

## What is tested without keys

- `supabase/functions/_shared/stripe-webhook.test.ts` drives the webhook handler with recorded-shape events in
  `supabase/functions/_shared/providers/stripe/fixtures/` (deposit Checkout, balance pay link, refund, expired
  Checkout), including signature, replay-window and live-mode refusals, and Stripe-fee retrieval with a fake fetcher.
- `supabase/tests/0045_money_reconciliation.test.sql` replays the same journey through the SQL the Edge Functions
  call and asserts Money (17) totals: processed $80.00, Mova fee $0.30 + $0.90 less $0.23 returned with the refund,
  Stripe processing $0.88 + $2.04, refund $15.00, estimated to stylist $61.11.
- `supabase/tests/0044_payment_fee_rate.test.sql`: each payment keeps the fee rate it was charged at.

## Running it against a real Stripe test account (when keys exist)

On a local or development project only, never production:

1. Set `MOVA_STRIPE_TEST_MODE=true`, `STRIPE_SECRET_KEY=sk_test_…`, `STRIPE_CONNECT_CLIENT_ID=ca_…`,
   `STRIPE_CONNECT_REDIRECT_URI`, `STRIPE_WEBHOOK_SECRET` (from `stripe listen`), and `VITE_STRIPE_TEST_MODE=true`.
2. `stripe listen --forward-to http://127.0.0.1:54321/functions/v1/stripe-webhook --events checkout.session.completed,checkout.session.expired,refund.updated`
3. Connect a test account from How you get paid (16a); confirm the card shows Active (16b).
4. Book a deposit service and pay with `4242 4242 4242 4242`; the booking confirms.
5. From the appointment, send a pay link for the balance and pay it.
6. Refund part of the pay-link payment.
7. Run the job worker once (`/api/job-dispatch` with the cron secret) so Stripe-fee jobs post processing fees.
8. Open Money (17): totals must equal the Stripe dashboard (gross, application fee, Stripe fee, refund) and
   `select category, sum(amount_minor) from mova_payment_ledger where artist_business_id = … group by 1`.
