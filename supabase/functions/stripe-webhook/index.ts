import { corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { verifyStripeTestWebhook } from '../_shared/providers/stripe/client.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  if (Deno.env.get('MOVA_STRIPE_TEST_MODE') !== 'true') return respond({ code: 'STRIPE_TEST_MODE_DISABLED' }, 503);
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!secret?.startsWith('whsec_')) return respond({ code: 'STRIPE_WEBHOOK_NOT_CONFIGURED' }, 503);
  const raw = await request.text();
  if (!await verifyStripeTestWebhook(raw, request.headers.get('stripe-signature') ?? '', secret)) return respond({ code: 'INVALID_WEBHOOK_SIGNATURE' }, 400);
  let event: Record<string, unknown>;
  try { event = JSON.parse(raw) as Record<string, unknown>; } catch { return respond({ code: 'STRIPE_EVENT_INVALID' }, 400); }
  const data = event.data && typeof event.data === 'object' ? (event.data as Record<string, unknown>).object as Record<string, unknown> : {};
  const eventType = String(event.type ?? '');
  const sessionId = typeof data.id === 'string' && data.id.startsWith('cs_test_') ? data.id : null;
  const paymentIntentId = typeof data.payment_intent === 'string' ? data.payment_intent : null;
  const accountId = typeof event.account === 'string' ? event.account : '';
  if (event.livemode !== false) return respond({ code: 'STRIPE_LIVE_EVENT_REJECTED' }, 400);
  const db = serviceClient();
  if (eventType.startsWith('refund.') && typeof data.id === 'string' && /^re_[A-Za-z0-9_]+$/.test(data.id)) {
    const refundStatus = data.status === 'succeeded' ? 'succeeded' : data.status === 'failed' ? 'failed' : 'pending';
    const { data: refundResult, error: refundError } = await db.rpc('mova_stripe_refund_webhook_apply', {
      p_event_id: event.id, p_refund_id: data.id, p_status: refundStatus, p_account_id: accountId, p_livemode: false,
    });
    if (refundError) return respond({ code: 'STRIPE_REFUND_WEBHOOK_PROCESSING_FAILED' }, 503);
    return respond({ received: true, ...(refundResult ?? {}) });
  }
  const { data: result, error } = await db.rpc('mova_stripe_webhook_apply', {
    p_event_id: event.id,
    p_event_type: eventType,
    p_account_id: accountId,
    p_session_id: sessionId,
    p_payment_intent_id: paymentIntentId,
    p_payment_status: String(data.payment_status ?? ''),
    p_amount_total: Number.isSafeInteger(data.amount_total) ? data.amount_total : null,
    p_livemode: false,
  });
  if (error) return respond({ code: 'STRIPE_WEBHOOK_PROCESSING_FAILED' }, 503);
  return respond({ received: true, ...(result ?? {}) });
});
