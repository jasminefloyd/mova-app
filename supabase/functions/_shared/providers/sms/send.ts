import type { SmsProvider } from './types.ts';
import { FakeSmsProvider } from './fake.ts';
import { reserveSpend } from '../spend.ts';
import { TwilioSmsProvider } from './twilio.ts';

// Minimal shape of the Supabase client used here, so tests can pass a stub.
type Result<T> = Promise<{ data: T | null; error: { message: string } | null }>;
export type SmsDb = {
  rpc(name: string, args: Record<string, unknown>): Result<Record<string, unknown>>;
  from(table: string): {
    insert(row: Record<string, unknown>): { select(columns: string): { single(): Result<{ id: string }> } };
    update(fields: Record<string, unknown>): { eq(column: string, value: string): PromiseLike<{ error: { message: string } | null }> };
  };
};

export type SmsPurpose = 'appointment_updates' | 'rebooking_reminders' | 'offers' | 'review_requests' | 'transactional';
export type SmsOrigin = 'artist' | 'system' | 'transactional' | 'autopilot' | 'seat_filler' | 'concierge';

export type SendSmsInput = {
  artistBusinessId: string;
  clientId: string;
  purpose: SmsPurpose;
  origin: SmsOrigin;
  body: string;
  idempotencyKey: string;
  templateId?: string | null;
  conversationId?: string | null;
  now?: Date;
};

export type SendSmsOutcome =
  | { status: 'sent'; messageId: string; providerMessageId: string }
  | { status: 'suppressed'; reason: string; messageId: string | null }
  | { status: 'duplicate' }
  | { status: 'failed'; messageId: string | null; error: string };

/**
 * The one way to send a text (task 4.4). Order: policy gate (consent, STOP, quiet hours, daily cap,
 * sending identity) → durable row in mova_messages (unique idempotency key) → provider → status update.
 * A suppressed send is recorded with status 'suppressed' and the reason in error_code.
 */
export async function sendSms(db: SmsDb, provider: SmsProvider, input: SendSmsInput): Promise<SendSmsOutcome> {
  const body = input.body.trim();
  if (!body || body.length > 1600) return { status: 'failed', messageId: null, error: 'BODY_INVALID' };
  const now = input.now ?? new Date();
  const { data: gate, error: gateError } = await db.rpc('mova_sms_send_gate', {
    p_artist_business_id: input.artistBusinessId, p_client_id: input.clientId, p_purpose: input.purpose, p_now: now.toISOString(),
  });
  if (gateError || !gate) return { status: 'failed', messageId: null, error: 'SEND_POLICY_UNAVAILABLE' };
  const base = {
    artist_business_id: input.artistBusinessId, client_id: input.clientId, direction: 'outbound', channel: 'sms',
    purpose: input.purpose, origin: input.origin, body, provider: provider.name, idempotency_key: input.idempotencyKey,
    template_id: input.templateId ?? null, conversation_id: input.conversationId ?? null,
  };
  if (gate.allowed !== true) {
    const reason = typeof gate.reason === 'string' ? gate.reason : 'not_eligible';
    const { data: row, error } = await db.from('mova_messages').insert({ ...base, provider: null, status: 'suppressed', error_code: reason }).select('id').single();
    if (error && /duplicate|23505/i.test(error.message)) return { status: 'duplicate' };
    return { status: 'suppressed', reason, messageId: row?.id ?? null };
  }
  const { data: row, error: insertError } = await db.from('mova_messages').insert({ ...base, status: 'queued' }).select('id').single();
  if (insertError && /duplicate|23505/i.test(insertError.message)) return { status: 'duplicate' };
  if (insertError || !row) return { status: 'failed', messageId: null, error: 'MESSAGE_SAVE_FAILED' };
  const sendInput = { to: String(gate.to), from: String(gate.from), body, idempotencyKey: input.idempotencyKey };
  const spend = await reserveSpend(db, row.id, provider.estimateCostMicros?.(sendInput) ?? 0, now);
  if (!spend.allowed) {
    if (spend.reason === 'spend_cap_reached') return { status: 'suppressed', reason: 'spend_cap_reached', messageId: row.id };
    await db.from('mova_messages').update({ status: 'failed', error_code: 'SPEND_CHECK_UNAVAILABLE' }).eq('id', row.id);
    return { status: 'failed', messageId: row.id, error: 'SPEND_CHECK_UNAVAILABLE' };
  }
  try {
    const result = await provider.send(sendInput);
    await db.from('mova_messages').update({ status: 'sent', provider_message_id: result.providerMessageId, sent_at: now.toISOString() }).eq('id', row.id);
    return { status: 'sent', messageId: row.id, providerMessageId: result.providerMessageId };
  } catch (caught) {
    await db.from('mova_messages').update({ status: 'failed', error_code: 'PROVIDER_ERROR' }).eq('id', row.id);
    return { status: 'failed', messageId: row.id, error: caught instanceof Error ? caught.message : 'PROVIDER_ERROR' };
  }
}

/**
 * Picks the SMS provider from the environment: the fake, or Twilio only when explicitly switched live
 * with complete configuration. Anything else returns null and callers answer PROVIDER_NOT_CONFIGURED.
 */
export function smsProviderFromEnv(env: (name: string) => string | undefined, fetcher: typeof fetch = fetch): SmsProvider | null {
  const choice = env('MOVA_SMS_PROVIDER');
  if (choice === 'fake') return new FakeSmsProvider(env('MOVA_SMS_FAKE_WEBHOOK_SECRET') ?? null);
  // Twilio (O4) is wired only with an explicit live switch and complete configuration.
  if (choice === 'twilio' && env('MOVA_MESSAGING_LIVE_SMS') === 'true') {
    const accountSid = env('TWILIO_ACCOUNT_SID'), authToken = env('TWILIO_AUTH_TOKEN'), webhookUrl = env('MOVA_TWILIO_WEBHOOK_URL');
    if (!accountSid || !authToken || !webhookUrl) return null;
    const segment = Number(env('MOVA_SMS_SEGMENT_COST_MICROS'));
    try {
      return new TwilioSmsProvider({ accountSid, authToken, webhookUrl, statusCallbackUrl: env('MOVA_TWILIO_STATUS_CALLBACK_URL') ?? null,
        segmentCostMicros: Number.isSafeInteger(segment) && segment > 0 ? segment : undefined }, fetcher);
    } catch { return null; }
  }
  return null;
}
