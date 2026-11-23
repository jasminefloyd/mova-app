import { withSystemRequestLogging, loggedProviderFetch } from '../_shared/system-log.ts';
import { artistClient, corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { planPriceId } from '../_shared/providers/stripe/billing.ts';
import { billingClientFromEnv, operatorReturnUrl } from '../_shared/billing-env.ts';
import { trialDaysFromEnv } from '../_shared/trial.ts';

// Free trial T1: "Add card and start free trial". Opens Stripe Checkout for AI + Growth with a 30-day
// trial and the card collected now (D1, D2). The trial starts when Stripe says so (plan-management
// 'confirm' or billing-webhook), never from this request. One trial per stylist (D6).
Deno.serve(withSystemRequestLogging('trial-start', async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const actor = await artistClient(request);
  if (!actor) return respond({ code: 'UNAUTHENTICATED' }, 401);
  const env = (name: string) => Deno.env.get(name);
  const db = serviceClient();
  const body = await request.json().catch(() => ({}));

  const { data: status, error: statusError } = await db.rpc('mova_trial_status_internal', { p_artist_business_id: actor.businessId, p_user: actor.user.id });
  if (statusError || !status) return respond({ code: 'TRIAL_STATUS_UNAVAILABLE' }, 500);
  if (!status.enabled) return respond({ code: 'TRIAL_NOT_AVAILABLE' }, 409);
  if (!status.is_owner) return respond({ code: 'OWNER_REQUIRED' }, 403);
  if (!status.eligible) return respond({ code: 'TRIAL_ALREADY_USED' }, 409);

  const stripe = billingClientFromEnv(env, loggedProviderFetch(request, 'stripe'));
  if (!stripe) return respond({ code: 'BILLING_NOT_CONFIGURED' }, 503);
  const priceId = planPriceId('ai_growth', env);
  if (!priceId) return respond({ code: 'PLAN_PRICE_NOT_CONFIGURED' }, 503);

  // Account texts are opt-in (unchecked by default on T1). Saved before Checkout so the
  // "trial started" text can go out as soon as Stripe confirms.
  if (body.sms && typeof body.sms === 'object' && body.sms.consent === true) {
    const { error } = await actor.client.rpc('mova_set_account_sms_consent', { p_phone: String(body.sms.phone ?? ''), p_consent: true, p_source: 'start_trial' });
    if (error) return respond({ code: error.message?.includes('PHONE_INVALID') ? 'PHONE_INVALID' : 'SMS_CONSENT_FAILED' }, 422);
  }
  const { error: offerError } = await actor.client.rpc('mova_record_trial_offer', { p_artist_business_id: actor.businessId, p_declined: false });
  if (offerError) return respond({ code: 'TRIAL_OFFER_NOT_SAVED' }, 500);

  const returnPath = typeof body.return_path === 'string' && /^\/[A-Za-z0-9/_-]*$/.test(body.return_path) ? body.return_path : `/${actor.businessId}/start-trial`;
  const success = operatorReturnUrl(env, `${returnPath}?checkout=success&session_id={CHECKOUT_SESSION_ID}`);
  const cancel = operatorReturnUrl(env, `${returnPath}?checkout=cancelled`);
  if (!success || !cancel) return respond({ code: 'RETURN_PATH_INVALID' }, 422);
  const { data: current } = await db.from('mova_billing_subscriptions').select('stripe_customer_id,livemode').eq('artist_business_id', actor.businessId).maybeSingle();
  try {
    const session = await stripe.createSubscriptionCheckout({
      priceId, businessId: actor.businessId, plan: 'ai_growth', trialDays: trialDaysFromEnv(env),
      successUrl: success.replace('%7BCHECKOUT_SESSION_ID%7D', '{CHECKOUT_SESSION_ID}'), cancelUrl: cancel,
      customerId: current?.livemode === (stripe.mode === 'live') ? current?.stripe_customer_id ?? null : null, email: actor.user.email ?? null,
    });
    if (typeof session.url !== 'string') throw new Error('NO_URL');
    return respond({ checkout_url: session.url, billing_mode: stripe.mode });
  } catch { return respond({ code: 'BILLING_CHECKOUT_FAILED' }, 502); }
}));
