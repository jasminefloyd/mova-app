# Stripe test-clock trial QA

November 23, 2026 ET. Stripe objects and payments were confined to test mode. Mova ran against local Auth, PostgreSQL, PostgREST, Edge handlers and Chromium. The final hosted Checkout pass used three fresh `hello+qatest{N}@mova-beauty.co` accounts for the Free, paid, and payment-failure branches. The anonymous provisioning attempt hit Stripe’s rate limit. The test run used the sandbox key supplied in the ignored `.env.local`.

| Scenario | Result | Evidence |
| --- | --- | --- |
| 4242, T3 trial begins | PASS through hosted Stripe Checkout with 4242. The browser returned to Mova, the signed Checkout event was processed, and Home displayed 30 days left. | [T3](evidence/trial-stripe/free-t3.png) |
| Day 23, T4 and 7-day reminder | PASS. The Stripe clock advanced to day 23. With that time passed to Mova’s scheduler, one reminder queued and reached the local fake email transport. Home showed 7 days left with the corresponding date projected into the local database. | [T4](evidence/trial-stripe/t4-day23.png), [reminders](evidence/trial-stripe/reminders.json) |
| Day 29, T4 and 1-day reminder | PASS. The Stripe clock advanced to day 29, one reminder queued and reached the local fake email transport, and Home showed 1 day left with the local date projection. Repeated scheduling and delivery did not duplicate either reminder. | [T4](evidence/trial-stripe/t4-day29.png), [reminders](evidence/trial-stripe/reminders.json) |
| Ends on Free, T7 locks | PASS. Mova set cancel at period end in Stripe, processed `customer.subscription.deleted` and downgraded to Free. Home displayed the ended-trial banner, and Calendar Sync displayed its lock. | [Home](evidence/trial-stripe/t7-home.png), [Calendar Sync](evidence/trial-stripe/t7-lock.png) |
| Ends paid, AI + Growth | PASS. Stripe marked the invoice paid and the subscription active. Mova processed the signed `invoice.paid` event and showed AI + Growth. | [Plan](evidence/trial-stripe/paid-conversion/paid-conversion.png) |
| 0341, T11 payment failure | PASS. Stripe attempted the $39 sandbox invoice, recorded zero paid, put the subscription in `past_due`, and sent `invoice.payment_failed`. Mova displayed the failed-payment banner and Update card. | [T11](evidence/trial-stripe/payment-failed/payment-failed.png) |

[Free transaction references](evidence/trial-stripe/results.json) · [Paid transaction references](evidence/trial-stripe/paid-conversion/results.json) · [Failed transaction references](evidence/trial-stripe/payment-failed/results.json) · [Webhook delivery log](evidence/trial-stripe/webhooks.txt)

The Stripe clock advances Stripe’s test objects. The reminder scheduler ran with its returned frozen time. The countdown checks used a temporary local timestamp projection and restored the Stripe timestamp afterwards. Reminder emails reached a local fake delivery provider. External email, SMS, and push delivery were outside this run.

Earlier hosted Checkout attempts timed out because the browser needed to fill embedded Stripe fields including the billing postal code. The corrected automation completed Checkout in every branch. A separate [Stripe Subscriptions API pass](evidence/trial-stripe-api/results.json) also reproduced the lifecycle independently.

Production trial flags stayed off during this QA run.

## Reproduction

With the isolated QA services on ports 4177 and 55427 and the Stripe CLI test listener forwarding to the local billing function, run the [trial harness](run-stripe-trial-qa.mjs). Use the local Auth test keys, a file containing the two Stripe test price IDs, and the sandbox key in the ignored `.env.local`.

```sh
qa_native=$(cat /tmp/mova-qa-native-pointer)
source "$qa_native/settings.sh"
qa_stripe=$(cat /tmp/mova-trial-sandbox-pointer)
QA_STRIPE_PRICE_FILE="$qa_stripe/prices.json" node qa-artifacts/run-stripe-trial-qa.mjs
QA_STRIPE_FLOW=api QA_STRIPE_PRICE_FILE="$qa_stripe/prices.json" node qa-artifacts/run-stripe-trial-qa.mjs
```
