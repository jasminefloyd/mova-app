import { withSystemRequestLogging, loggedProviderFetch } from '../_shared/system-log.ts';
import { artistClient, corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { planPriceId, type PlanKey } from '../_shared/providers/stripe/billing.ts';
import { billingClientFromEnv, operatorReturnUrl } from '../_shared/billing-env.ts';

// Start a Pro or AI + Growth subscription on the platform Stripe account. The plan changes only
// after plan-management 'confirm' verifies the completed checkout against this business and mode.
Deno.serve(withSystemRequestLogging('subscription-checkout', async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const actor = await artistClient(request);
  if (!actor) return respond({ code: 'UNAUTHENTICATED' }, 401);
  const env = (name: string) => Deno.env.get(name);
  const stripe = billingClientFromEnv(env, loggedProviderFetch(request, 'stripe'));
  if (!stripe) return respond({ code: 'BILLING_NOT_CONFIGURED' }, 503);
  const body = await request.json().catch(() => ({}));
  const plan = body.plan_key as PlanKey;
  if (plan !== 'pro' && plan !== 'ai_growth') return respond({ code: 'PLAN_INVALID' }, 422);
  const priceId = planPriceId(plan, env);
  if (!priceId) return respond({ code: 'PLAN_PRICE_NOT_CONFIGURED' }, 503);
  const returnPath = typeof body.return_path === 'string' ? body.return_path : '';
  const success = operatorReturnUrl(env, `${returnPath}?checkout=success&session_id={CHECKOUT_SESSION_ID}`);
  const cancel = operatorReturnUrl(env, `${returnPath}?checkout=cancelled`);
  if (!success || !cancel) return respond({ code: 'RETURN_PATH_INVALID' }, 422);
  const { data: current } = await serviceClient().from('mova_billing_subscriptions').select('stripe_customer_id,status,livemode').eq('artist_business_id', actor.businessId).maybeSingle();
  if (current?.livemode === (stripe.mode === 'live') && ['active', 'trialing', 'past_due'].includes(current.status)) return respond({ code: 'MANAGE_IN_BILLING_PORTAL' }, 409);
  try {
    const customerId = current?.livemode === (stripe.mode === 'live') ? current.stripe_customer_id : null;
    const session = await stripe.createSubscriptionCheckout({ priceId, businessId: actor.businessId, plan, successUrl: success.replace('%7BCHECKOUT_SESSION_ID%7D', '{CHECKOUT_SESSION_ID}'), cancelUrl: cancel, customerId, email: actor.user.email ?? null });
    if (typeof session.url !== 'string') throw new Error('NO_URL');
    return respond({ checkout_url: session.url, billing_mode: stripe.mode });
  } catch { return respond({ code: 'BILLING_CHECKOUT_FAILED' }, 502); }
}));
