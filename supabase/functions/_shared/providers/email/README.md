# Email provider adapter (task 4.3)

Import from `_shared/providers/email/index.ts`. Nothing here sends a real email: the only provider is
`FakeEmailProvider`. The vendor waits on owner decision O4.

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
`mova_messages` row (channel `email`, unique idempotency key, rendered subject and text in `body`), then calls
the provider and records the outcome. Outcomes: `sent | suppressed | duplicate | failed`.

Appointment emails are wired in `_shared/appointment-emails.ts`: outbox events `appointment.confirmed`
(confirmation, or "accepted" after a request), `appointment.pending_artist` (request received),
`appointment.declined`, and the reminder job (`appointment_reminder`, ~24 hours before). They run in
`job-worker` only when `MOVA_EMAIL_PROVIDER=fake`; otherwise nothing is sent.
