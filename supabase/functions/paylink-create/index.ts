import { artistClient, corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { StripeTestClient } from '../_shared/providers/stripe/client.ts';

const randomCode = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  if (Deno.env.get('MOVA_STRIPE_TEST_MODE') !== 'true') return respond({ code: 'STRIPE_TEST_MODE_DISABLED' }, 503);
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key?.startsWith('sk_test_')) return respond({ code: 'STRIPE_TEST_CONFIGURATION_MISSING' }, 503);
  const actor = await artistClient(request);
  if (!actor) return respond({ code: 'UNAUTHENTICATED' }, 401);
  const body = await request.json().catch(() => ({}));
  const idempotencyKey = request.headers.get('Idempotency-Key') ?? body.idempotency_key;
  if (typeof body.appointment_id !== 'string' || !['sms', 'qr'].includes(body.channel)
    || typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 200) return respond({ code: 'INVALID_REQUEST' }, 422);
  const db = serviceClient();
  const { data: link, error } = await db.rpc('mova_stripe_paylink_prepare', {
    p_artist_business_id: actor.businessId, p_appointment_id: body.appointment_id, p_channel: body.channel, p_short_code: randomCode(), p_idempotency_key: idempotencyKey,
  });
  if (error || !link) return respond({ code: error?.message ?? 'PAYLINK_PREPARE_FAILED' }, 422);
  const base = (Deno.env.get('PUBLIC_BASE_URL') ?? 'https://mova-beauty.co').replace(/\/$/, '');
  const payUrl = `${base}/pay/${encodeURIComponent(link.short_code)}`;
  if (link.checkout_url) return respond({ pay_url: payUrl, checkout_url: link.checkout_url, expires_at: link.expires_at, reused: true });
  try {
    const session = await new StripeTestClient(key).createCheckoutSession({
      accountId: link.stripe_account_id,
      amountMinor: Number(link.amount_minor), applicationFeeMinor: Number(link.fee_minor), currency: 'usd',
      expiresAt: Math.floor(Date.parse(link.expires_at) / 1000),
      successUrl: `${payUrl}?result=complete`, cancelUrl: `${payUrl}?result=cancelled`,
      clientReferenceId: link.payment_id,
      metadata: { payment_id: link.payment_id, paylink_id: link.link_id, appointment_id: body.appointment_id, checkout_kind: 'paylink' },
      productName: String(link.service_name ?? 'Service balance'),
      ...(typeof link.client_email === 'string' && link.client_email ? { customerEmail: link.client_email } : {}),
      locale: link.client_locale === 'es-US' ? 'es' : 'en', idempotencyKey: `mova-paylink-${link.link_id}`,
    });
    if (typeof session.id !== 'string' || !session.id.startsWith('cs_test_') || typeof session.url !== 'string' || !session.url.startsWith('https://checkout.stripe.com/')) {
      return respond({ code: 'STRIPE_CHECKOUT_RESPONSE_INVALID' }, 502);
    }
    const { data: attached, error: attachError } = await db.rpc('mova_stripe_paylink_attach', {
      p_link_id: link.link_id, p_session_id: session.id, p_session_url: session.url,
    });
    if (attachError || attached !== true) return respond({ code: 'PAYLINK_CHECKOUT_ATTACH_FAILED' }, 503);
    return respond({ pay_url: payUrl, checkout_url: session.url, expires_at: link.expires_at, reused: false }, 201);
  } catch {
    return respond({ code: 'STRIPE_PAYLINK_CREATE_FAILED' }, 502);
  }
});
