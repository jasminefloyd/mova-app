import { corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { parseResendEvent, parseTwilioStatus, verifyResendSignature, type StatusUpdate } from '../_shared/providers/status.ts';

// Delivery receipts from Twilio (?provider=twilio) and Resend (?provider=resend).
// Updates message status and the real cost, and suppresses bounced / complaining addresses.
const hash = async (value: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const normalizePhone = (value: string) => { const d = value.replace(/\D/g, ''); return d.length === 10 ? `1${d}` : d; };

async function apply(update: StatusUpdate) {
  const db = serviceClient();
  let query = db.from('mova_messages').select('id,artist_business_id,channel,status').eq('provider', update.provider).limit(1);
  query = update.idempotencyKey ? query.eq('idempotency_key', update.idempotencyKey) : query.eq('provider_message_id', update.providerMessageId ?? '');
  const { data: message } = await query.maybeSingle();
  if (!message) return false;
  const fields: Record<string, unknown> = {};
  if (update.status && !(message.status === 'delivered' && update.status === 'sent')) fields.status = update.status;
  if (update.status === 'delivered') fields.delivered_at = new Date().toISOString();
  if (update.costMicros !== null) fields.cost_micros = update.costMicros;
  if (Object.keys(fields).length) await db.from('mova_messages').update(fields).eq('id', message.id);
  if (update.suppress) {
    const address = message.channel === 'sms' ? normalizePhone(update.suppress.address) : update.suppress.address;
    await db.from('mova_suppressions').upsert({ artist_business_id: message.artist_business_id, channel: message.channel, address_hash: await hash(address), reason: update.suppress.reason },
      { onConflict: 'artist_business_id,channel,address_hash,reason', ignoreDuplicates: true });
  }
  return true;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const raw = await request.text();
  if (raw.length > 1_000_000) return respond({ code: 'REQUEST_TOO_LARGE' }, 413);
  const provider = new URL(request.url).searchParams.get('provider');
  if (provider === 'twilio') {
    const token = Deno.env.get('TWILIO_AUTH_TOKEN'), sid = Deno.env.get('TWILIO_ACCOUNT_SID'), url = Deno.env.get('MOVA_TWILIO_STATUS_CALLBACK_URL');
    if (!token || !sid || !url) return respond({ code: 'PROVIDER_NOT_CONFIGURED' }, 503);
    const update = await parseTwilioStatus(raw, request.headers.get('x-twilio-signature') ?? '', token, url, sid);
    if (!update) return respond({ code: 'INVALID_WEBHOOK_SIGNATURE' }, 401);
    return respond({ accepted: await apply(update) });
  }
  if (provider === 'resend') {
    const secret = Deno.env.get('RESEND_WEBHOOK_SECRET');
    if (!secret) return respond({ code: 'PROVIDER_NOT_CONFIGURED' }, 503);
    const ok = await verifyResendSignature(secret, raw, { id: request.headers.get('svix-id') ?? '', timestamp: request.headers.get('svix-timestamp') ?? '', signature: request.headers.get('svix-signature') ?? '' });
    if (!ok) return respond({ code: 'INVALID_WEBHOOK_SIGNATURE' }, 401);
    const update = parseResendEvent(raw);
    // Events we do not act on (opened, clicked, delayed) are acknowledged so Resend does not retry them.
    return respond({ accepted: true, applied: update && await apply(update) ? 1 : 0 });
  }
  return respond({ code: 'PROVIDER_UNKNOWN' }, 422);
});
