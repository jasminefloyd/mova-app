# Service-role function tenant boundary review

**Scope:** `supabase/functions/*/index.ts` files that construct or call `serviceClient()` (35 handlers as of 2026-11-07).

The service role bypasses RLS. This is a source-level boundary inventory, not a passing cross-tenant test report. A10 remains open until each handler with an artist-facing tenant input has a runtime test using stylist B against stylist A identifiers, and each token, webhook, or worker endpoint has its appropriate negative authorization test. PostgreSQL, Docker and Deno are unavailable in the current local environment.

| Function | Intended authority boundary from source | Cross-tenant runtime test |
|---|---|---|
| `artist-data-export` | Requires `artistClient`; export query helper filters tenant rows by `actor.businessId`. | Missing |
| `booking-create` | Public booking RPC receives location/service IDs; database RPC validates tenant ownership and bookability. | Missing |
| `booking-reschedule` | Public manage-token hash identifies the appointment; RPC receives that appointment and token hash. | Missing |
| `booking-status` | Public manage-token hash selects one appointment; profile/location projections derive from that appointment's business. | Missing |
| `booking-transition` | Artist actions filter appointment by `actor.businessId`; guest actions require manage-token hash. | Missing |
| `calendar-google-callback` | One-time OAuth state hash selects the connection's business; state has expiry/consumption fields. | Missing |
| `calendar-google-connect` | Requires `artistClient`; reads/writes filter by `actor.businessId`, and location IDs are checked within that business. | Missing |
| `calendar-ics-feed` | Unrevoked opaque feed-token hash identifies one business; appointment/event reads use that business. | Missing |
| `calendar-sync-run` | CRON bearer secret gates a deliberate all-business worker; each connection supplies the business scope for sync. | Missing |
| `client-card-landing` | Opaque card-token hash selects card scope; linked profile/account/appointment reads use its business/client/account IDs. | Missing |
| `client-card-token` | Authenticated account and verified active client link derive the scope; token writes include business/client/account IDs. | Missing |
| `concierge-artist` | Requires `artistClient`; tenant reads/writes filter by `actor.businessId`. | Missing |
| `customer-profile` | Authenticated customer account is resolved by `auth.uid()`; stylist data is derived from active account links. | Missing |
| `forecast-summary` | Requires `artistClient`; forecast query filters by `actor.businessId`. | Missing |
| `manual-payment-record` | Requires `artistClient`; RPC receives `actor.businessId` and authenticated actor ID. | Missing |
| `messaging-dispatch` | Requires `artistClient`; consent decision receives `actor.businessId` and client ID. | Missing |
| `messaging-inbound-sms` | Provider-signature webhook (fake HMAC until O4/O5); business resolved from the stylist's active SMS sending identity in `mova_sms_handle_inbound`; keyword changes apply only to that business. | Missing |
| `messaging-events` | Provider-signature webhook resolves active sending identities; status events are correlated to provider/message identity. | Missing |
| `messaging-settings` | Requires `artistClient`; preference/template reads and writes include actor business and user IDs. | Missing |
| `messaging-status` | Provider delivery receipts: Twilio (`X-Twilio-Signature`, account SID checked) and SendGrid (ECDSA-signed Event Webhook, 10-minute window). Rows matched by provider + message ID or our idempotency key; suppressions written for the message's own business. | Missing |
| `missed-call-webhook` | Off unless `MOVA_MISSED_CALL_TEXTBACK_ENABLED`; signed webhook; business resolved from the called sending identity in `mova_missed_call_gate`, which applies STOP, quiet hours and a daily limit. | Missing |
| `money-summary` | Requires `artistClient`; summary RPC receives `actor.businessId`. | Missing |
| `notification-dispatch` | CRON/worker processes undelivered outbox events across businesses by design; event business IDs scope downstream work. | Missing |
| `notification-inbox` | Requires `artistClient`; inbox query/update includes `actor.businessId` and `actor.user.id`. | Missing |
| `payment-settings` | Requires `artistClient`; settings query/upsert use `actor.businessId`. | Missing |
| `support-feedback` | Requires `artistClient`; inserts run through the stylist's own client so RLS (0041) checks business and user; the service role only issues signed upload URLs under `<business>/<user>/`. | Missing |
| `plan-management` | Requires `artistClient`; entitlement RPC receives `actor.businessId`. | Missing |
| `privacy-management` | Requires `artistClient`; privacy request RPC receives authenticated actor ID and actor business. | Missing |
| `reports-refresh` | CRON bearer secret gates an all-business scheduled worker; each business is processed independently. | Missing |
| `reports-summary` | Requires `artistClient`; location and report RPC queries receive `actor.businessId`. | Missing |
| `reports-track` | Public profile handle is resolved by a database RPC; no client-supplied business UUID is trusted. | Missing |
| `revenue-center` | Requires `artistClient`; appointment/opportunity/settings/decision/client queries and upserts use `actor.businessId`. | Missing |
| `review-management` | Requires `artistClient`; reads and RPC calls include `actor.businessId`. | Missing |
| `review-public-context` | Public opaque review-token hash is passed to the token-scoped RPC. | Missing |
| `review-submit` | Public opaque review-token hash is passed to the token-scoped RPC. | Missing |
| `running-late-send` | Requires `artistClient`; target and next appointments plus outbox writes are scoped to `actor.businessId`. | Missing |
| `scan-landing` | Public handle resolves a published profile; scan RPC derives business scope from that profile. | Missing |
| `slot-campaign` | Requires `artistClient`; slot-event reads/updates filter by `actor.businessId`. | Missing |
| `waitlist-signup` | Public acquisition endpoint has no tenant identifier; global abuse/privacy controls apply. | Missing |

## Acceptance still required

- Add the A10 QA case IDs and negative tests to each tenant-facing handler (or explicitly classify endpoints that cannot accept a stylist identity and test their token/signature boundary).
- Run Deno function tests against a local Supabase project; do not point tests at production.
- Inspect the RPC definitions invoked by booking, payment, reports, review and token routes as part of runtime authorization coverage.

The shared `artistClient` boundary has a mocked Deno test (`TC-SEC-FUZZ-01`) verifying that both user ID and requested business ID are applied to membership lookup. This does not exercise any handler body. No handler is marked runtime-verified by this inventory; all 35 function-level cross-tenant tests remain required.
