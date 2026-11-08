# SMS provider adapter (task 4.4)

Import from `_shared/providers/sms/index.ts`. Nothing here reaches a real phone: the only
provider is `FakeSmsProvider`. The real vendor waits on owner decisions O4 and O5.

## Interface (`types.ts`)

```ts
interface SmsProvider {
  readonly name: string;            // stored in mova_messages.provider ('fake')
  readonly live: boolean;           // false for the fake
  send(input: { to; from; body; idempotencyKey }): Promise<{ providerMessageId; status: 'queued' | 'sent' }>;
  parseInbound(request: Request): Promise<{ from; to; text; providerMessageId } | null>; // null = bad signature/payload
}
```

## Sending: always through `sendSms(db, provider, input)`

`input`: `artistBusinessId, clientId, purpose ('appointment_updates' | 'rebooking_reminders' | 'offers' |
'review_requests' | 'transactional'), origin ('artist' | 'system' | 'transactional' | 'autopilot' |
'seat_filler' | 'concierge'), body, idempotencyKey, templateId?, conversationId?, now?`.

It calls `mova_sms_send_gate` (migration 0042), which applies, in order: client exists, consent for the
purpose (not for transactional), STOP suppression, quiet hours 09:00–20:00 in the client's time zone (not for
transactional), an active SMS sending identity, and the per-client daily cap for non-transactional texts
(`mova_sms_daily_cap()`, server setting `mova.sms_daily_cap`, default 1 per rolling 24 hours). Every attempt is a
row in `mova_messages`; suppressed attempts keep the reason in `error_code`. The idempotency key is unique per
business, so retries return `{ status: 'duplicate' }` instead of sending twice.

Outcomes: `sent | suppressed (reason) | duplicate | failed (error)`.

## Inbound and keywords

`handleInboundSms(db, provider, inbound)` logs the text and applies carrier keywords via
`mova_sms_handle_inbound`: STOP (and STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, PARAR, ALTO, BAJA…) adds a
suppression and a revoked SMS consent row per purpose; START removes the suppression but does not re-grant
consent; HELP/AYUDA only replies. Confirmation replies (`keywordReply`) are the only texts sent without
consent. Their wording is a draft: the final STOP/HELP copy is part of sender registration (O4/O5).

## Choosing a provider

`smsProviderFromEnv(Deno.env.get)` returns the fake when `MOVA_SMS_PROVIDER=fake`, otherwise `null`
(callers answer `PROVIDER_NOT_CONFIGURED`). The fake's inbound webhook expects JSON `{from,to,text,id}`
signed with HMAC-SHA256 (hex) in `x-mova-fake-sms-signature` using `MOVA_SMS_FAKE_WEBHOOK_SECRET`.
