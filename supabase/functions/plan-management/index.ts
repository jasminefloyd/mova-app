import { artistClient, corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { verifiedSubscription } from '../_shared/providers/stripe/billing.ts';
import { billingClientFromEnv } from '../_shared/billing-env.ts';

// Plans (O10 confirmed prices). 'get' returns the summary; 'confirm' applies a completed Stripe
// test-mode subscription checkout after verifying it with Stripe (task 5.8). Plans never change from
// what the browser claims.
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const actor = await artistClient(request);
  if (!actor) return respond({ code: 'UNAUTHENTICATED' }, 401);
  const body = await request.json().catch(() => ({}));
  const db = serviceClient();
  if (body.action === 'confirm') {
    const stripe = billingClientFromEnv((name) => Deno.env.get(name));
    if (!stripe) return respond({ code: 'BILLING_NOT_CONFIGURED' }, 503);
    if (typeof body.session_id !== 'string') return respond({ code: 'INVALID_SESSION' }, 422);
    let session: Record<string, unknown>;
    try { session = await stripe.retrieveCheckout(body.session_id); } catch { return respond({ code: 'BILLING_VERIFY_FAILED' }, 502); }
    const verified = verifiedSubscription(session, actor.businessId);
    if (!verified) return respond({ code: 'CHECKOUT_NOT_COMPLETE' }, 409);
    const { data, error } = await db.rpc('mova_apply_plan_subscription', { p_artist_business_id: actor.businessId, p_plan_key: verified.plan, p_customer: verified.customerId, p_subscription: verified.subscriptionId, p_status: verified.status });
    return error ? respond({ code: 'PLAN_SAVE_FAILED' }, 500) : respond(data);
  }
  if (body.action && body.action !== 'get') return respond({ code: 'ACTION_INVALID' }, 422);
  const [{ data, error }, { data: subscription }] = await Promise.all([
    db.rpc('mova_plan_entitlement_summary', { p_artist_business_id: actor.businessId }),
    db.from('mova_billing_subscriptions').select('plan_key,status').eq('artist_business_id', actor.businessId).maybeSingle(),
  ]);
  if (error) return respond({ code: 'PLAN_SUMMARY_UNAVAILABLE' }, 500);
  return respond({ ...data, subscription: subscription ?? null, billing_available: billingClientFromEnv((name) => Deno.env.get(name)) !== null });
});
