# Local payment test log

November 22, 2026 ET. The Plans screen showed Free, Pro and AI + Growth. The local environment excluded the production Stripe configuration and had no Stripe sandbox credentials. No Stripe Checkout session, payment, billing customer, subscription, refund, or signed webhook was created. Stripe transaction and webhook references are therefore unavailable for this run.

## Recorded payments

These browser actions wrote real entries to the disposable PostgreSQL ledger. All amounts below are in USD. Provider transaction and webhook references are inapplicable to recorded payments. [Ledger rows](evidence/manual-payment-records.txt)

| Case | Local reference | Scenario | Final application state |
| --- | --- | --- | --- |
| CAL-08 | AID-65 | Stylist recorded $120 cash | The ledger shows succeeded, $0 platform fee and $0 appointment balance. Money showed Recorded by you. [UI](evidence/cal-08.txt) |
| CAL-13 | AID-66 | Stylist recorded $120 under Other, labeled QA Transfer | The ledger preserved the exact label and shows succeeded, $0 platform fee and $0 appointment balance. [UI](evidence/cal-13.txt) |
| CAL-14 | AID-67 | Salon collected $120 cash | The checkout hid Card. The ledger shows succeeded, $0 platform fee and $0 appointment balance. Money showed Collected by salons. [UI](evidence/cal-14.txt) |

## Provider scenarios still blocked

| Cases | Scenario | Observed application state and blocker |
| --- | --- | --- |
| SET-20 | Free to Pro or AI + Growth, sandbox subscription Checkout | Plans rendered. No sandbox subscription was created. The local Free/Pro/AI + Growth entitlement check used seeded test plan state only. [Plans](evidence/set-20.txt), [Entitlement check](evidence/native-growth.json) |
| SET-16 | Stripe Connect onboarding | Opened payment setup. No test connected account was linked or verified. [UI](evidence/set-16.txt) |
| BKG-07, BKG-08 | Paid deposit, declined card, 3DS and retry | No sandbox deposit was processed. The paid appointment and retry behavior remain unverified. [Success attempt](evidence/bkg-07.txt), [Decline attempt](evidence/bkg-08.txt) |
| BKG-12, CAL-04 | Deposit handling on cancellation | Exercised cancellation on local fixtures. The paid-deposit outcome and outbound delivery remain unverified. [Guest cancellation](evidence/native-isolated.json), [Stylist cancellation](evidence/native-operations.json) |
| CAL-09, CAL-10 | Chair-side QR and text payment link | No sandbox link completed. The phone and text delivery paths need an isolated delivery setup. [Browser run](evidence/native-operations.json) |
| CAL-11, CAL-12 | Decline recovery and 3DS approval or failure | No provider decline, retry or authentication event was received. [Browser run](evidence/native-operations.json) |
| CAL-15, CAL-16, CAL-17 | Balance after deposit, fee reconciliation, refund | Verified zero fees for recorded payments. The successful card, 1.5% fee, remaining balance, and refund paths still need sandbox transactions and signed events. [Local ledger](evidence/manual-payment-records.txt), [Browser run](evidence/native-operations.json) |

## Subscription purchase retest

Use a disposable **stylist business** on Free. Its clients use the guest and client booking flows. Test each first purchase with an independent Free fixture so an existing subscription cannot affect the result.

1. Supply a Stripe sandbox key as `STRIPE_SECRET_KEY`, set `MOVA_STRIPE_BILLING_MODE=test`, set `MOVA_STRIPE_PRICE_PRO` and `MOVA_STRIPE_PRICE_AI_GROWTH` to the sandbox’s recurring $19 and $39 USD prices, and set `OPERATOR_BASE_URL=http://127.0.0.1:4175`. Configure the sandbox Customer Portal for any tier change or cancellation cases.
2. From Settings → Plans, purchase Pro on one fixture and AI + Growth on another, using Stripe test card `4242 4242 4242 4242`. Repeat with a sandbox decline and with a cancelled Checkout. Confirm that interrupted or declined checkouts leave the operator on Free and preserve Free feature gates.
3. After each successful browser return, verify that Mova’s `plan-management` confirmation independently fetches and verifies the Checkout session. Check the visible plan and entitlements and the matching `mova_billing_subscriptions` row, with `livemode=false`. Verify the returned customer and subscription references in the same sandbox. For a subsequent paid-tier change, use the sandbox portal and verify Mova’s refresh path after return.
4. For appointment payments, also supply `MOVA_STRIPE_TEST_MODE=true`, a sandbox Connect account and matching `STRIPE_CONNECT_CLIENT_ID` for OAuth, and the test listener’s `STRIPE_WEBHOOK_SECRET` for the local `stripe-webhook` handler. Replay a delivered event once and inspect the resulting payment, appointment, and ledger states for duplicate records. Subscription Checkout currently applies the plan through the verified return and refresh handlers. The local appointment webhook is a separate path.
