import { withSystemRequestLogging } from '../_shared/system-log.ts';
import { artistClient, corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { sendSms, smsProviderFromEnv, type SmsDb, type SmsPurpose } from '../_shared/providers/sms/index.ts';
import { planFeatureEnabled } from '../_shared/plan-feature.ts';

// A stylist-composed message to one client. SMS goes through the shared adapter (task 4.4): the policy
// gate (consent, STOP, quiet hours, daily cap) runs in mova_sms_send_gate. Only the fake provider exists,
// so nothing reaches a real phone until O4/O5 are decided.
const purposes: SmsPurpose[] = ['appointment_updates', 'rebooking_reminders', 'offers', 'review_requests', 'transactional'];

Deno.serve(withSystemRequestLogging('messaging-dispatch', async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const actor = await artistClient(request);
  if (!actor) return respond({ code: 'UNAUTHENTICATED' }, 401);
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  if (typeof body.client_id !== 'string' || typeof body.purpose !== 'string' || typeof body.channel !== 'string' || typeof body.idempotency_key !== 'string'
    || body.idempotency_key.length < 8 || body.idempotency_key.length > 200) return respond({ code: 'INVALID_REQUEST' }, 422);
  if (!purposes.includes(body.purpose as SmsPurpose)) return respond({ code: 'INVALID_REQUEST' }, 422);
  if (['rebooking_reminders', 'offers'].includes(body.purpose as string) && !await planFeatureEnabled(actor.businessId, 'text_autopilot')) return respond({ code: 'PLAN_FEATURE_NOT_INCLUDED', feature: 'text_autopilot' }, 403);
  if (body.purpose === 'appointment_updates' && !await planFeatureEnabled(actor.businessId, 'text_reminders')) return respond({ code: 'PLAN_FEATURE_NOT_INCLUDED', feature: 'text_reminders' }, 403);
  if (body.channel !== 'sms') return respond({ code: 'CHANNEL_UNAVAILABLE' }, 422);
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!text || text.length > 1600) return respond({ code: 'INVALID_REQUEST' }, 422);
  const provider = smsProviderFromEnv((name) => Deno.env.get(name));
  if (!provider) return respond({ code: 'PROVIDER_NOT_CONFIGURED' }, 503);
  const outcome = await sendSms(serviceClient() as unknown as SmsDb, provider, {
    artistBusinessId: actor.businessId, clientId: body.client_id, purpose: body.purpose as SmsPurpose, origin: 'artist',
    body: text, idempotencyKey: `artist:${actor.user.id}:${body.idempotency_key}`,
  });
  if (outcome.status === 'suppressed') return respond({ code: 'MESSAGE_SUPPRESSED', reason: outcome.reason }, 409);
  if (outcome.status === 'duplicate') return respond({ duplicate: true });
  if (outcome.status === 'failed') return respond({ code: outcome.error === 'SEND_POLICY_UNAVAILABLE' ? 'SEND_POLICY_UNAVAILABLE' : 'SEND_FAILED' }, 503);
  return respond({ message_id: outcome.messageId, status: 'sent', provider: provider.name });
}));
