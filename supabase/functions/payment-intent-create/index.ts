import { corsHeaders, respond, serviceClient, tokenHash } from '../_shared/booking.ts';
import { StripeTestClient } from '../_shared/providers/stripe/client.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  if (Deno.env.get('MOVA_STRIPE_TEST_MODE') !== 'true') return respond({ code: 'STRIPE_TEST_MODE_DISABLED' }, 503);
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key?.startsWith('sk_test_')) return respond({ code: 'STRIPE_TEST_CONFIGURATION_MISSING' }, 503);
  const body = await request.json().catch(() => ({}));
  const idempotencyKey = request.headers.get('Idempotency-Key') ?? body.idempotency_key;
  if (typeof body.appointment_id !== 'string' || typeof body.manage_token !== 'string' || body.manage_token.length < 40
    || typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 200) return respond({ code: 'INVALID_REQUEST' }, 422);
  const db = serviceClient();
  const { data: checkout, error } = await db.rpc('mova_stripe_checkout_prepare', {
    p_appointment_id: body.appointment_id, p_manage_token_hash: await tokenHash(body.manage_token), p_idempotency_key: idempotencyKey,
  });
  if (error || !checkout) return respond({ code: error?.message ?? 'CHECKOUT_PREPARE_FAILED' }, error?.message === 'PAYMENT_HOLD_EXPIRED' ? 410 : 422);

  const { data: payment, error: paymentError } = await db.from('mova_payments').select('checkout_session_id,checkout_session_url')
    .eq('id', checkout.payment_id).maybeSingle();
  if (paymentError) return respond({ code: 'CHECKOUT_PAYMENT_READ_FAILED' }, 500);
  if (payment?.checkout_session_id && payment.checkout_session_url) return respond({ checkout_url: payment.checkout_session_url, session_id: payment.checkout_session_id, reused: true });

  const origin = (Deno.env.get('PUBLIC_BASE_URL') ?? 'https://mova-beauty.co').replace(/\/$/, '');
  const now = Math.floor(Date.now() / 1000);
  const sessionExpiry = Math.max(now + 1800, Math.min(now + 86400, Math.floor(Date.parse(checkout.hold_expires_at) / 1000) + 1800));
  try {
    const session = await new StripeTestClient(key).createCheckoutSession({
      accountId: checkout.stripe_account_id,
      amountMinor: Number(checkout.amount_minor), applicationFeeMinor: Number(checkout.fee_minor), currency: 'usd', expiresAt: sessionExpiry,
      successUrl: `${origin}/b/${encodeURIComponent(body.manage_token)}?checkout=return`,
      cancelUrl: `${origin}/b/${encodeURIComponent(body.manage_token)}?checkout=cancelled`,
      clientReferenceId: checkout.appointment_id,
      metadata: { appointment_id: checkout.appointment_id, payment_id: checkout.payment_id },
      productName: String(checkout.service_name ?? 'Service deposit'),
      ...(typeof checkout.client_email === 'string' && checkout.client_email ? { customerEmail: checkout.client_email } : {}),
      locale: checkout.client_locale === 'es-US' ? 'es' : 'en', idempotencyKey: `mova-checkout-${checkout.payment_id}`,
    });
    if (typeof session.id !== 'string' || !session.id.startsWith('cs_test_') || typeof session.url !== 'string' || !session.url.startsWith('https://checkout.stripe.com/')) {
      return respond({ code: 'STRIPE_CHECKOUT_RESPONSE_INVALID' }, 502);
    }
    const { data: attached, error: attachError } = await db.rpc('mova_stripe_checkout_attach', {
      p_payment_id: checkout.payment_id, p_session_id: session.id, p_session_url: session.url,
    });
    if (attachError || attached !== true) {
      try {
        const expired = await new StripeTestClient(key).expireCheckoutSession(session.id, checkout.stripe_account_id);
        if (expired.status === 'expired') await db.rpc('mova_stripe_checkout_fail', { p_payment_id: checkout.payment_id });
      } catch { /* Do not release the hold unless Stripe confirms expiration; the signed webhook remains authoritative. */ }
      return respond({ code: 'CHECKOUT_ATTACH_FAILED' }, 503);
    }
    const { error: jobError } = await db.from('mova_background_jobs').upsert({
      job_type: 'stripe_checkout_expire', artist_business_id: checkout.artist_business_id,
      payload: { payment_id: checkout.payment_id, session_id: session.id, account_id: checkout.stripe_account_id },
      run_at: checkout.hold_expires_at, idempotency_key: `stripe-checkout-expire:${checkout.payment_id}`,
    }, { onConflict: 'idempotency_key', ignoreDuplicates: true });
    if (jobError) return respond({ code: 'CHECKOUT_EXPIRY_SCHEDULE_FAILED' }, 503);
    return respond({ checkout_url: session.url, session_id: session.id, reused: false }, 201);
  } catch {
    // Provider timeouts are ambiguous. Keep the booking hold so an idempotent retry
    // can recover the same Stripe Session; the expiry job/late-payment refund is authoritative.
    return respond({ code: 'STRIPE_CHECKOUT_CREATE_FAILED' }, 502);
  }
});
