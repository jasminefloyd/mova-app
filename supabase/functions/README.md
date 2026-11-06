# Edge Functions (spec §6)

Conventions: `/functions/v1/<name>`, envelope `{ data, error, request_id }`, `Idempotency-Key` on every mutation, caller class `artist | client | guest | worker | provider`, Zod schema in `packages/contracts/src/functions/<name>.ts`. Each function has the contract test suite `TC-CT-<name>` (docs/qa).

## Retained from v1 (§6.2)
- `publish-showcase`
- `public-artist`
- `availability-search`
- `booking-create`
- `booking-status`
- `booking-transition`
- `booking-reschedule`
- `stripe-connect-onboard`
- `payment-intent-create`
- `stripe-webhook`
- `refund-request`
- `manual-payment-record`
- `calendar-google-connect`
- `calendar-google-callback`
- `calendar-sync-settings`
- `calendar-sync-run`
- `calendar-ics-feed`
- `calendar-ics-rotate`
- `client-import-preview`
- `client-import-commit`
- `growth-opportunities-list`
- `growth-opportunity-generate`
- `wallet-card-create`
- `subscription-checkout`
- `subscription-portal`
- `account-export`
- `account-delete-request`
- `waitlist-signup`
- `job-dispatch`
- `job-worker`

`waitlist-signup` is the public acquisition form endpoint. It stores only the supplied email, selected work arrangement, and explicit optional marketing opt-in; its response does not claim an email was sent. The handler uses the service-role-only `mova_waitlist_register` function. Keep production submissions disabled until A-14 is verified.

## New in v2 (§6.3)
- `photo-upload-url`
- `photo-process`
- `otp-start`
- `otp-verify`
- `customer-profile`
- `customer-appointments`
- `customer-consents`
- `customer-claim-bookings`
- `customer-delete`
- `client-card-token`
- `wallet-pass-create`
- `wallet-apple-webservice`
- `wallet-pass-refresh`
- `scan-landing`
- `client-notes`
- `visit-notes`
- `before-you-start`
- `paylink-create`
- `paylink-redirect`
- `running-late-send`
- `templates`
- `autopilot-settings`
- `autopilot-plan`
- `autopilot-activity`
- `rebooking-pipeline`
- `winback-list`
- `winback-send`
- `slot-scan`
- `slot-draft`
- `slot-approve`
- `slot-stop`
- `slot-send-next-wave`
- `slot-dispatch`
- `slot-claim`
- `social-share-image`
- `social-share-record`
- `forecast-get`
- `reports-summary`
- `track`
- `review-request-send`
- `review-submit`
- `review-reply`
- `review-report`
- `google-reviews-sync`
- `messaging-inbound-sms`
- `messaging-status`
- `missed-call-webhook`
- `instagram-webhook`
- `web-chat`
- `concierge-turn`
- `concierge-settings`
- `concierge-knowledge`
- `conversations`
- `quote-respond`
- `handoff-resolve`
- `sending-identity-provision`

`_shared/` holds auth, tenant, customer, money, idempotency, ratelimit, i18n, policy, outbox, jobs, log and the provider adapters (stripe, gcal, sms, email, meta, gbp, wallet, ai), each with a sandbox implementation used in CI (§7).
