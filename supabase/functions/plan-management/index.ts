import { withSystemRequestLogging, loggedProviderFetch } from '../_shared/system-log.ts';
import { artistClient, corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { planPriceId, verifiedSubscription } from '../_shared/providers/stripe/billing.ts';
import { billingClientFromEnv } from '../_shared/billing-env.ts';

// Plans (O10 confirmed prices). 'get' returns the summary; 'confirm' applies a completed Stripe
// subscription checkout after verifying it with Stripe. Plans never change from
// what the browser claims.
Deno.serve(withSystemRequestLogging('plan-management', async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const actor = await artistClient(request);
  if (!actor) return respond({ code: 'UNAUTHENTICATED' }, 401);
  const body = await request.json().catch(() => ({}));
  const db = serviceClient();
  if (body.action === 'confirm') {
    const stripe = billingClientFromEnv((name) => Deno.env.get(name), loggedProviderFetch(request, 'stripe'));
    if (!stripe) return respond({ code: 'BILLING_NOT_CONFIGURED' }, 503);
    if (typeof body.session_id !== 'string') return respond({ code: 'INVALID_SESSION' }, 422);
    let session: Record<string, unknown>;
    try { session = await stripe.retrieveCheckout(body.session_id); } catch { return respond({ code: 'BILLING_VERIFY_FAILED' }, 502); }
    const verified = verifiedSubscription(session, actor.businessId, stripe.mode);
    if (!verified) return respond({ code: 'CHECKOUT_NOT_COMPLETE' }, 409);
    const { data, error } = await db.rpc('mova_apply_plan_subscription', { p_artist_business_id: actor.businessId, p_plan_key: verified.plan, p_customer: verified.customerId, p_subscription: verified.subscriptionId, p_status: verified.status, p_livemode: stripe.mode === 'live' });
    return error ? respond({ code: 'PLAN_SAVE_FAILED' }, 500) : respond(data);
  }
  if (body.action === 'refresh') {
    const stripe = billingClientFromEnv((name) => Deno.env.get(name), loggedProviderFetch(request, 'stripe'));
    if (!stripe) return respond({ code: 'BILLING_NOT_CONFIGURED' }, 503);
    const { data: current, error: currentError } = await db.from('mova_billing_subscriptions')
      .select('stripe_customer_id,stripe_subscription_id').eq('artist_business_id', actor.businessId).maybeSingle();
    if (currentError) return respond({ code: 'PLAN_SUMMARY_UNAVAILABLE' }, 500);
    if (!current?.stripe_customer_id || !current?.stripe_subscription_id) return respond({ code: 'NO_SUBSCRIPTION' }, 404);
    let subscription: Record<string, unknown>;
    try { subscription = await stripe.retrieveSubscription(current.stripe_subscription_id); }
    catch { return respond({ code: 'BILLING_VERIFY_FAILED' }, 502); }
    const metadata = (subscription.metadata ?? {}) as Record<string, string>;
    const items = (subscription.items ?? {}) as { data?: Array<{ price?: { id?: string } }> };
    const priceId = items.data?.[0]?.price?.id;
    const plan = priceId === planPriceId('pro', (name) => Deno.env.get(name)) ? 'pro'
      : priceId === planPriceId('ai_growth', (name) => Deno.env.get(name)) ? 'ai_growth' : null;
    const allowedStatuses = ['active', 'trialing', 'past_due', 'canceled', 'incomplete'];
    if (subscription.id !== current.stripe_subscription_id || subscription.customer !== current.stripe_customer_id
      || subscription.livemode !== (stripe.mode === 'live') || metadata.artist_business_id !== actor.businessId
      || !plan || typeof subscription.status !== 'string' || !allowedStatuses.includes(subscription.status)) {
      return respond({ code: 'SUBSCRIPTION_NOT_VERIFIED' }, 409);
    }
    const { data, error } = await db.rpc('mova_apply_plan_subscription', {
      p_artist_business_id: actor.businessId, p_plan_key: plan, p_customer: current.stripe_customer_id,
      p_subscription: current.stripe_subscription_id, p_status: subscription.status,
      p_livemode: stripe.mode === 'live',
    });
    return error ? respond({ code: 'PLAN_SAVE_FAILED' }, 500) : respond(data);
  }
  if (body.action && body.action !== 'get') return respond({ code: 'ACTION_INVALID' }, 422);
  const [{ data, error }, { data: subscription }] = await Promise.all([
    db.rpc('mova_plan_entitlement_summary', { p_artist_business_id: actor.businessId }),
    db.from('mova_billing_subscriptions').select('plan_key,status,livemode').eq('artist_business_id', actor.businessId).maybeSingle(),
  ]);
  if (error) return respond({ code: 'PLAN_SUMMARY_UNAVAILABLE' }, 500);
  const { data: features, error: featureError } = await db.rpc('mova_business_features', { p_artist_business_id: actor.businessId });
  if (featureError) return respond({ code: 'PLAN_FEATURES_UNAVAILABLE' }, 500);
  const billing = billingClientFromEnv((name) => Deno.env.get(name), loggedProviderFetch(request, 'stripe'));
  return respond({ ...data, features: features ?? {}, subscription: subscription ?? null, billing_available: billing !== null, billing_mode: billing?.mode ?? null });
}));
