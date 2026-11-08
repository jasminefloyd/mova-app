Recorded-shape Stripe test-mode fixtures (task 4.1). Synthetic: built from Stripe's documented event and
object shapes with test-mode IDs; no real account, key or network was used. The pgTAP test
`supabase/tests/0045_money_reconciliation.test.sql` replays the same journey with matching IDs, amounts
and fees, so the Vitest and SQL halves describe one sandbox run:

1. Deposit $20.00 via Checkout (`checkout.session.completed.deposit.json`), Stripe fee $0.88.
2. Balance $60.00 via an SMS pay link (`checkout.session.completed.paylink.json`).
3. Partial refund $15.00 of the pay-link payment (`refund.updated.succeeded.json`).
4. An abandoned Checkout (`checkout.session.expired.json`).
