# Email provider adapter (task 4.3)

Import from `_shared/providers/email/index.ts`. Providers: `FakeEmailProvider` (never sends) and
`ResendEmailProvider` (owner decision, Nov 13; approval A-03). Resend stays unwired unless explicitly switched live:

| Setting (Supabase function secret) | Value |
| --- | --- |
| `MOVA_EMAIL_PROVIDER` | `resend` |
| `MOVA_MESSAGING_LIVE_EMAIL` | `true` |
| `RESEND_API_KEY` | the `re_…` key. Function secrets only; never in Git, chat or the browser |
| `MOVA_EMAIL_FROM` | a bare address on a domain verified in Resend, e.g. `bookings@mova-beauty.co` |
| `RESEND_WEBHOOK_SECRET` | the `whsec_…` signing secret of the Resend webhook (below) |
| `MOVA_EMAIL_COST_MICROS` (optional) | estimate for the shared monthly cap, default 1000 |

Each send carries an `Idempotency-Key` header (our idempotency key), so a retried job cannot send twice within
Resend's 24-hour window. Turn click and open tracking off on the domain in the Resend dashboard.

Delivery receipts: in Resend, add a webhook to `<SUPABASE_URL>/functions/v1/messaging-status?provider=resend` for
`email.sent`, `email.delivered`, `email.bounced`, `email.complained` and `email.failed`. The function checks the Svix
signature (`svix-id`, `svix-timestamp`, `svix-signature`; five-minute window), matches the row on the email id Resend
returned at send time, and adds a suppression for bounces and complaints.

Supabase Auth emails (sign-up verification, password reset) do not use this adapter. Point Auth's custom SMTP at
Resend separately: host `smtp.resend.com`, port 465, username `resend`, password = the API key.

## Interface (`types.ts`)

```ts
interface EmailProvider {
  readonly name: string;   // stored in mova_messages.provider ('fake')
  readonly live: boolean;  // false for the fake
  send(input: { to; from; subject; text; html; templateId; locale; idempotencyKey }): Promise<{ providerMessageId; status }>;
}
```

## Templates (`templates.ts`)

`renderEmail(templateId, locale, vars)` returns `{ subject, text, html }` in `en-US` or `es-US`.
Templates: `booking_confirmation`, `request_received`, `request_accepted`, `request_declined`,
`appointment_reminder`. `vars`: `clientName, businessName, serviceName, startsAt (ISO), timeZone (IANA, the
location's), locationName, manageUrl?` (https only; without it the footer says to contact the stylist).
All variables are HTML-escaped.

## Sending: always through `sendEmail(db, provider, input)`

Checks `mova_email_send_gate` (migration 0043: bounce, complaint and manual suppressions), writes a
`mova_messages` row, reserves the estimated cost against the shared monthly cap (0047; at the cap the result is
`suppressed` / `spend_cap_reached`), (channel `email`, unique idempotency key, rendered subject and text in `body`), then calls
the provider and records the outcome. Outcomes: `sent | suppressed | duplicate | failed`.

Appointment emails are wired in `_shared/appointment-emails.ts`: outbox events `appointment.confirmed`
(confirmation, or "accepted" after a request), `appointment.pending_artist` (request received),
`appointment.declined`, and the reminder job (`appointment_reminder`, ~24 hours before). They run in
`job-worker` when `emailProviderFromEnv` returns a provider (`fake`, or `resend` with the live switch);
otherwise nothing is sent.
