import { twilioSignature } from './sms/twilio.ts';

// Delivery receipts from the providers: Twilio status callbacks and Resend webhooks (email; owner decision Nov 13).
// They update mova_messages (status, real cost) and add suppressions for bounces and complaints.

export type StatusUpdate = {
  provider: 'twilio' | 'resend';
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

const fromBase64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/**
 * Resend webhooks are signed by Svix: HMAC-SHA256 over "<svix-id>.<svix-timestamp>.<raw body>" with the
 * endpoint's signing secret (whsec_…, base64). The svix-signature header holds one or more "v1,<base64>" values.
 */
export async function verifyResendSignature(secret: string, raw: string, headers: { id: string; timestamp: string; signature: string }, nowSeconds = Math.floor(Date.now() / 1000)) {
  try {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(headers.id) || !/^\d{1,12}$/.test(headers.timestamp) || Math.abs(nowSeconds - Number(headers.timestamp)) > 300) return false;
    if (!secret.startsWith('whsec_')) return false;
    const key = await crypto.subtle.importKey('raw', fromBase64(secret.slice('whsec_'.length)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const expected = toBase64(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${headers.id}.${headers.timestamp}.${raw}`))));
    return headers.signature.split(' ').some((part) => { const [version, value] = part.split(','); return version === 'v1' && typeof value === 'string' && timingSafeEqual(value, expected); });
  } catch { return false; }
}

/** One Resend event per request. Rows are matched on the email id Resend returned when we sent it. */
export function parseResendEvent(raw: string): StatusUpdate | null {
  let event: unknown;
  try { event = JSON.parse(raw); } catch { return null; }
  if (!event || typeof event !== 'object') return null;
  const { type, data } = event as { type?: unknown; data?: unknown };
  if (typeof type !== 'string' || !data || typeof data !== 'object') return null;
  const { email_id: emailId, to } = data as { email_id?: unknown; to?: unknown };
  if (typeof emailId !== 'string' || !/^[A-Za-z0-9-]{8,100}$/.test(emailId)) return null;
  const first = Array.isArray(to) ? to[0] : to;
  const address = typeof first === 'string' ? first.trim().toLowerCase() : null;
  const status: StatusUpdate['status'] = type === 'email.delivered' ? 'delivered' : type === 'email.sent' ? 'sent' : ['email.bounced', 'email.failed', 'email.suppressed'].includes(type) ? 'failed' : null;
  const reason = type === 'email.bounced' ? 'bounce' as const : type === 'email.complained' ? 'complaint' as const : null;
  if (!status && !reason) return null;
  return { provider: 'resend', providerMessageId: emailId, idempotencyKey: null, status, costMicros: null, suppress: reason && address ? { address, reason } : null };
}
