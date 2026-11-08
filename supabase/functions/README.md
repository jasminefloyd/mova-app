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

`job-dispatch` and `job-worker` are server-only. Both reject requests without their separate `x-mova-job-secret`; the Vercel `/api/job-dispatch` cron route verifies `CRON_SECRET`, dispatches pending outbox rows, then invokes the worker. The queue uses database leases and idempotent notification upserts. Dead letters are recorded in `mova_background_job_alerts`; an operator must inspect/acknowledge these records until an external alert destination is configured. All job/provider flags remain OFF by default.

`waitlist-signup` is the public acquisition form endpoint. It stores only the supplied email, selected work arrangement, and explicit optional marketing opt-in; its response does not claim an email was sent. The handler uses the service-role-only `mova_waitlist_register` function. It returns `WAITLIST_NOT_OPEN` unless server secret `MOVA_WAITLIST_ENABLED=true`; the public form separately requires `VITE_WAITLIST_ENABLED=true`. Keep both flags false until A-14 privacy, anti-bot, and production-domain checks are verified and accepted.

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
- `reports-track`
- `reports-refresh`
- `artist-data-export`
- `privacy-management`
- `plan-management`
- `review-management`
- `review-public-context`
- `review-submit`
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
