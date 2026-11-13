import { withSystemRequestLogging } from '../_shared/system-log.ts';
import { corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { planFeatureEnabled } from '../_shared/plan-feature.ts';
import { fakeSignature, smsProviderFromEnv } from '../_shared/providers/sms/index.ts';
import { missedCallText } from './copy.ts';
import { reserveSpend, type SpendDb } from '../_shared/providers/spend.ts';

// Task 4.4: missed-call text-back. Off unless MOVA_MISSED_CALL_TEXTBACK_ENABLED=true and the stylist
// turned on the concierge missed_call channel. mova_missed_call_gate (0042) applies STOP, quiet hours and
// one text-back per caller per day. Webhook payload {from,to,call_id}, signed like the fake SMS webhook.
Deno.serve(withSystemRequestLogging('missed-call-webhook', async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  if (Deno.env.get('MOVA_MISSED_CALL_TEXTBACK_ENABLED') !== 'true') return respond({ code: 'MISSED_CALL_TEXTBACK_DISABLED' }, 503);
  const provider = smsProviderFromEnv((name) => Deno.env.get(name));
  const secret = Deno.env.get('MOVA_SMS_FAKE_WEBHOOK_SECRET');
  if (!provider || !secret) return respond({ code: 'PROVIDER_NOT_CONFIGURED' }, 503);
  const raw = await request.text();
  if (raw.length > 4096) return respond({ code: 'REQUEST_TOO_LARGE' }, 413);
  const signature = request.headers.get('x-mova-fake-sms-signature') ?? '';
  if (signature.length !== 64 || signature !== await fakeSignature(raw, secret)) return respond({ code: 'INVALID_WEBHOOK_SIGNATURE' }, 401);
  const body = (() => { try { return JSON.parse(raw) as Record<string, unknown>; } catch { return null; } })();
  if (!body || typeof body.from !== 'string' || typeof body.to !== 'string' || typeof body.call_id !== 'string') return respond({ code: 'INVALID_REQUEST' }, 422);
  const db = serviceClient();
  const now = new Date();
  const { data, error } = await db.rpc('mova_missed_call_gate', { p_to: body.to, p_from: body.from, p_now: now.toISOString() });
  if (error || !data) return respond({ code: 'MISSED_CALL_GATE_FAILED' }, 500);
  const businesses = (data.businesses ?? []) as { artist_business_id: string; allowed: boolean; reason: string; conversation_id: string; client_id: string | null; locale: string; from: string; to: string; handle: string | null; business_name: string }[];
  const results: { artist_business_id: string; status: string }[] = [];
  for (const business of businesses) {
    if (!business.allowed) { results.push({ artist_business_id: business.artist_business_id, status: business.reason }); continue; }
    if (!await planFeatureEnabled(business.artist_business_id, 'missed_call_textback')) { results.push({ artist_business_id: business.artist_business_id, status: 'plan_feature_not_included' }); continue; }
    const text = missedCallText(business.locale === 'es-US' ? 'es-US' : 'en-US', business.business_name, business.handle);
    const key = `missed-call:${body.call_id}:${business.artist_business_id}`;
    const { data: row, error: insertError } = await db.from('mova_messages').insert({
      artist_business_id: business.artist_business_id, client_id: business.client_id, conversation_id: business.conversation_id,
      direction: 'outbound', channel: 'sms', purpose: 'missed_call_textback', origin: 'concierge', body: text, provider: provider.name, status: 'queued', idempotency_key: key,
    }).select('id').single();
    if (insertError || !row) { results.push({ artist_business_id: business.artist_business_id, status: 'duplicate' }); continue; }
    const sendInput = { to: business.to, from: business.from, body: text, idempotencyKey: key };
    const spend = await reserveSpend(db as unknown as SpendDb, row.id, provider.estimateCostMicros?.(sendInput) ?? 0, now);
    if (!spend.allowed) {
      if (spend.reason !== 'spend_cap_reached') await db.from('mova_messages').update({ status: 'failed', error_code: 'SPEND_CHECK_UNAVAILABLE' }).eq('id', row.id);
      results.push({ artist_business_id: business.artist_business_id, status: spend.reason ?? 'SPEND_CHECK_UNAVAILABLE' });
      continue;
    }
    try {
      const sent = await provider.send(sendInput);
      await db.from('mova_messages').update({ status: 'sent', provider_message_id: sent.providerMessageId, sent_at: now.toISOString() }).eq('id', row.id);
      results.push({ artist_business_id: business.artist_business_id, status: 'sent' });
    } catch {
      await db.from('mova_messages').update({ status: 'failed', error_code: 'PROVIDER_ERROR' }).eq('id', row.id);
      results.push({ artist_business_id: business.artist_business_id, status: 'failed' });
    }
  }
  return respond({ accepted: true, results });
}));
