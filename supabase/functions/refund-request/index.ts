import { withSystemRequestLogging, loggedProviderFetch } from '../_shared/system-log.ts';
import { artistClient, corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { StripeTestClient } from '../_shared/providers/stripe/client.ts';

Deno.serve(withSystemRequestLogging('refund-request', async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  if (Deno.env.get('MOVA_STRIPE_TEST_MODE') !== 'true') return respond({ code: 'STRIPE_TEST_MODE_DISABLED' }, 503);
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key?.startsWith('sk_test_')) return respond({ code: 'STRIPE_TEST_CONFIGURATION_MISSING' }, 503);
  const actor = await artistClient(request);
  if (!actor) return respond({ code: 'UNAUTHENTICATED' }, 401);
  const body = await request.json().catch(() => ({}));
  const idempotencyKey = request.headers.get('Idempotency-Key') ?? body.idempotency_key;
  if (typeof body.payment_id !== 'string' || !Number.isSafeInteger(body.amount_minor) || body.amount_minor < 1
    || typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 200) return respond({ code: 'INVALID_REQUEST' }, 422);
  const db = serviceClient();
  const { data: refund, error } = await db.rpc('mova_stripe_refund_prepare', {
    p_artist_business_id: actor.businessId, p_payment_id: body.payment_id, p_amount_minor: body.amount_minor, p_idempotency_key: idempotencyKey,
  });
  if (error || !refund) return respond({ code: error?.message ?? 'REFUND_PREPARE_FAILED' }, error?.message === 'REFUND_AMOUNT_EXCEEDS_REMAINING' ? 409 : 422);
  if (refund.status === 'succeeded') return respond({ refund_id: refund.refund_id, status: 'succeeded', reused: true });
  try {
    const result = await new StripeTestClient(key, loggedProviderFetch(request, 'stripe')).createRefund({
      paymentIntentId: refund.payment_intent_id,
      amountMinor: Number(refund.amount_minor),
      accountId: refund.account_id,
      idempotencyKey: `mova-refund-${refund.refund_id}`,
      refundApplicationFee: true,
    });
    if (typeof result.id !== 'string' || !result.id.startsWith('re_') || !['succeeded', 'pending', 'failed'].includes(String(result.status))) {
      return respond({ code: 'STRIPE_REFUND_RESPONSE_INVALID' }, 502);
    }
    const { data: saved, error: saveError } = await db.rpc('mova_stripe_refund_finish', {
      p_refund_id: refund.refund_id, p_provider_refund_id: result.id, p_status: result.status,
    });
    if (saveError || saved !== true) return respond({ code: 'REFUND_STATUS_SAVE_FAILED' }, 503);
    return respond({ refund_id: refund.refund_id, status: result.status }, result.status === 'failed' ? 502 : 200);
  } catch {
    await db.rpc('mova_stripe_refund_finish', { p_refund_id: refund.refund_id, p_provider_refund_id: null, p_status: 'failed' });
    return respond({ code: 'STRIPE_REFUND_FAILED' }, 502);
  }
}));
