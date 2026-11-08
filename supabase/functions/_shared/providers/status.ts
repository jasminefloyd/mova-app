import { twilioSignature } from './sms/twilio.ts';

// Delivery receipts from the O4 providers (Nov 8): Twilio status callbacks and the SendGrid Event Webhook.
// They update mova_messages (status, real cost) and add suppressions for bounces and complaints.

export type StatusUpdate = {
  provider: 'twilio' | 'sendgrid';
  providerMessageId: string | null;
  idempotencyKey: string | null;
  status: 'sent' | 'delivered' | 'failed' | null;
  costMicros: number | null;
  suppress: { address: string; reason: 'bounce' | 'complaint' | 'manual' } | null;
};

const timingSafeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

/** Twilio status callback (form-encoded, signed like inbound texts). */
export async function parseTwilioStatus(raw: string, signature: string, authToken: string, callbackUrl: string, accountSid: string): Promise<StatusUpdate | null> {
  const params = Object.fromEntries(new URLSearchParams(raw));
  if (!timingSafeEqual(signature, await twilioSignature(authToken, callbackUrl, params)) || params.AccountSid !== accountSid) return null;
  if (typeof params.MessageSid !== 'string') return null;
  const map: Record<string, StatusUpdate['status']> = { queued: null, accepted: null, sending: null, sent: 'sent', delivered: 'delivered', undelivered: 'failed', failed: 'failed' };
  const price = Number(params.Price);
  return {
    provider: 'twilio', providerMessageId: params.MessageSid, idempotencyKey: null, status: map[params.MessageStatus ?? ''] ?? null,
    costMicros: params.Price && Number.isFinite(price) && (params.PriceUnit ?? 'USD') === 'USD' ? Math.round(Math.abs(price) * 1_000_000) : null,
    // 21610: the recipient replied STOP to Twilio directly.
    suppress: params.ErrorCode === '21610' && typeof params.To === 'string' ? { address: params.To, reason: 'manual' } : null,
  };
}

/** DER-encoded ECDSA signature → raw r||s (64 bytes), as WebCrypto expects. */
export function derToRaw(der: Uint8Array): Uint8Array {
  if (der[0] !== 0x30) throw new Error('SIGNATURE_INVALID');
  let offset = 2;
  const read = () => {
    if (der[offset] !== 0x02) throw new Error('SIGNATURE_INVALID');
    const length = der[offset + 1]!;
    let value = der.slice(offset + 2, offset + 2 + length);
    offset += 2 + length;
    while (value.length > 32 && value[0] === 0) value = value.slice(1);
    const out = new Uint8Array(32); out.set(value, 32 - value.length); return out;
  };
  const r = read(), s = read();
  const raw = new Uint8Array(64); raw.set(r); raw.set(s, 32); return raw;
}

const fromBase64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

/** SendGrid signed Event Webhook: ECDSA P-256 / SHA-256 over timestamp + raw payload. */
export async function verifySendGridSignature(publicKeyBase64: string, raw: string, timestamp: string, signatureBase64: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  try {
    if (!/^\d{1,12}$/.test(timestamp) || Math.abs(nowSeconds - Number(timestamp)) > 600) return false;
    const key = await crypto.subtle.importKey('spki', fromBase64(publicKeyBase64), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRaw(fromBase64(signatureBase64)), new TextEncoder().encode(timestamp + raw));
  } catch { return false; }
}

export function parseSendGridEvents(raw: string): StatusUpdate[] {
  let events: unknown;
  try { events = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(events)) return [];
  return events.slice(0, 1000).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const e = item as Record<string, unknown>;
    const key = typeof e.mova_idempotency_key === 'string' ? e.mova_idempotency_key : null;
    const id = typeof e.sg_message_id === 'string' ? e.sg_message_id.split('.')[0]! : null;
    const email = typeof e.email === 'string' ? e.email.trim().toLowerCase() : null;
    const status: StatusUpdate['status'] = e.event === 'delivered' ? 'delivered' : ['bounce', 'dropped'].includes(String(e.event)) ? 'failed' : e.event === 'processed' ? 'sent' : null;
    const reason = e.event === 'bounce' ? 'bounce' : e.event === 'spamreport' ? 'complaint' : ['unsubscribe', 'group_unsubscribe'].includes(String(e.event)) ? 'manual' : null;
    if (!key && !id) return [];
    return [{ provider: 'sendgrid' as const, providerMessageId: id, idempotencyKey: key, status, costMicros: null, suppress: reason && email ? { address: email, reason } : null }];
  });
}
