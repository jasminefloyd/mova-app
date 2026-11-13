import { withSystemRequestLogging, loggedProviderFetch } from '../_shared/system-log.ts';
import { artistClient, corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { billingClientFromEnv, operatorReturnUrl } from '../_shared/billing-env.ts';

// Task 5.8: Stripe's billing portal (test mode) to change card, switch or cancel a plan.
Deno.serve(withSystemRequestLogging('subscription-portal', async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const actor = await artistClient(request);
  if (!actor) return respond({ code: 'UNAUTHENTICATED' }, 401);
  const env = (name: string) => Deno.env.get(name);
  const stripe = billingClientFromEnv(env, loggedProviderFetch(request, 'stripe'));
  if (!stripe) return respond({ code: 'BILLING_NOT_CONFIGURED' }, 503);
  const body = await request.json().catch(() => ({}));
  const returnUrl = operatorReturnUrl(env, typeof body.return_path === 'string' ? body.return_path : '');
  if (!returnUrl) return respond({ code: 'RETURN_PATH_INVALID' }, 422);
  const { data: current } = await serviceClient().from('mova_billing_subscriptions').select('stripe_customer_id').eq('artist_business_id', actor.businessId).maybeSingle();
  if (!current?.stripe_customer_id) return respond({ code: 'NO_SUBSCRIPTION' }, 404);
  try {
    const session = await stripe.createPortalSession(current.stripe_customer_id, returnUrl);
    return respond({ portal_url: session.url, test_mode: true });
  } catch { return respond({ code: 'BILLING_PORTAL_FAILED' }, 502); }
}));
