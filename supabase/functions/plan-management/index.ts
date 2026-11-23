import { accountCanChangeBilling } from '../_shared/account-closure.ts';
import { withSystemRequestLogging, loggedProviderFetch } from '../_shared/system-log.ts';
import { artistClient, corsHeaders, respond, serviceClient } from '../_shared/booking.ts';
import { planPriceId, StripeBillingError, verifiedSubscription, type PlanKey } from '../_shared/providers/stripe/billing.ts';
import { billingClientFromEnv, operatorReturnUrl } from '../_shared/billing-env.ts';
import { enqueueBillingMessages, subscriptionApplyArgs, syncSubscription, type BillingDb } from '../_shared/billing-state.ts';
import { lockedFeatures } from '../_shared/plan-locks.ts';

// Plans and the free trial. 'get' returns the summary, the trial state and what the plan locks;
// 'confirm' and 'refresh' re-read Stripe; 'after_trial' sets what happens when the trial ends (T5);
// 'unlock' starts a paid plan on the card on file (T6, T7, T9). Plans never change from what the
// browser claims: every change goes to Stripe first, then mova_apply_billing_state records Stripe's answer.
Deno.serve(withSystemRequestLogging('plan-management', async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const actor = await artistClient(request);
  if (!actor) return respond({ code: 'UNAUTHENTICATED' }, 401);
  const body = await request.json().catch(() => ({}));
  const db = serviceClient();
  const env = (name: string) => Deno.env.get(name);
  const billingDb = db as unknown as BillingDb;
  const stripe = () => billingClientFromEnv(env, loggedProviderFetch(request, 'stripe'));
  const businessId = actor.businessId;
  if (['after_trial','unlock','confirm'].includes(body.action) && !await accountCanChangeBilling(db, businessId)) return respond({ code: 'ACCOUNT_CLOSURE_SCHEDULED' }, 409);

  const owner = async () => {
    const { data } = await db.from('mova_artist_memberships').select('role').eq('artist_business_id', businessId)
      .eq('user_id', actor.user.id).eq('status', 'active').maybeSingle();
    return data?.role === 'owner';
  };
  const trialStatus = async () => {
    const { data, error } = await db.rpc('mova_trial_status_internal', { p_artist_business_id: businessId, p_user: actor.user.id });
    if (error) throw new Error('TRIAL_STATUS_UNAVAILABLE');
    return data as Record<string, unknown>;
  };
  const summary = async () => {
    const [{ data, error }, { data: subscription }, { data: features, error: featureError }, { data: switches }] = await Promise.all([
      db.rpc('mova_plan_entitlement_summary', { p_artist_business_id: businessId }),
      db.from('mova_billing_subscriptions').select('plan_key,status,livemode,trial_end,cancel_at_period_end,current_period_end,pending_plan_key,past_due_since,payment_method_brand,payment_method_last4').eq('artist_business_id', businessId).maybeSingle(),
      db.rpc('mova_business_features', { p_artist_business_id: businessId }),
      db.from('mova_platform_switches').select('key,enabled'),
    ]);
    if (error || featureError) return respond({ code: error ? 'PLAN_SUMMARY_UNAVAILABLE' : 'PLAN_FEATURES_UNAVAILABLE' }, 500);
    const trial = await trialStatus();
    const billing = stripe();
    const plans = ((data as Record<string, unknown>)?.plans ?? []) as Array<{ plan_key: string; entitlements?: { features?: Record<string, boolean> } }>;
    const switchMap = Object.fromEntries(((switches ?? []) as Array<{ key: string; enabled: boolean }>).map((row) => [row.key, row.enabled]));
    return respond({
      ...(data as Record<string, unknown>), features: features ?? {}, subscription: subscription ?? null,
      billing_available: billing !== null, billing_mode: billing?.mode ?? null, trial,
      locked_features: lockedFeatures((features ?? {}) as Record<string, boolean>, plans, switchMap, env('MOVA_MESSAGING_LIVE_SMS') === 'true'),
    });
  };

  try {
    if (body.action === 'confirm') {
      const client = stripe();
      if (!client) return respond({ code: 'BILLING_NOT_CONFIGURED' }, 503);
      if (typeof body.session_id !== 'string') return respond({ code: 'INVALID_SESSION' }, 422);
      let session: Record<string, unknown>;
      try { session = await client.retrieveCheckout(body.session_id); } catch { return respond({ code: 'BILLING_VERIFY_FAILED' }, 502); }
      const verified = verifiedSubscription(session, businessId, client.mode);
      if (!verified) return respond({ code: 'CHECKOUT_NOT_COMPLETE' }, 409);
      // The webhook may already have applied this; applying again is a no-op.
      const synced = await syncSubscription(billingDb, client, verified.subscriptionId, env, undefined, actor.user.id);
      if (!synced) return respond({ code: 'SUBSCRIPTION_NOT_VERIFIED' }, 409);
      if (!synced.outcome.ignored) await enqueueBillingMessages(billingDb, synced.args, synced.outcome, synced.subscription);
      return summary();
    }
    if (body.action === 'refresh') {
      const client = stripe();
      if (!client) return respond({ code: 'BILLING_NOT_CONFIGURED' }, 503);
      const { data: current } = await db.from('mova_billing_subscriptions').select('stripe_subscription_id').eq('artist_business_id', businessId).maybeSingle();
      if (!current?.stripe_subscription_id) return respond({ code: 'NO_SUBSCRIPTION' }, 404);
      const synced = await syncSubscription(billingDb, client, current.stripe_subscription_id, env);
      if (!synced) return respond({ code: 'SUBSCRIPTION_NOT_VERIFIED' }, 409);
      if (!synced.outcome.ignored) await enqueueBillingMessages(billingDb, synced.args, synced.outcome, synced.subscription);
      return summary();
    }
    if (body.action === 'trial_status') return respond(await trialStatus());

    if (body.action === 'after_trial') {
      const plan = body.plan;
      if (plan !== 'ai_growth' && plan !== 'pro' && plan !== 'free') return respond({ code: 'PLAN_INVALID' }, 422);
      if (!await owner()) return respond({ code: 'OWNER_REQUIRED' }, 403);
      const client = stripe();
      if (!client) return respond({ code: 'BILLING_NOT_CONFIGURED' }, 503);
      const { data: current } = await db.from('mova_billing_subscriptions').select('stripe_subscription_id,status').eq('artist_business_id', businessId).maybeSingle();
      if (current?.status !== 'trialing' || !current.stripe_subscription_id) return respond({ code: 'NOT_TRIALING' }, 409);
      const live = await client.retrieveSubscriptionWithCard(current.stripe_subscription_id);
      const itemId = (((live.items ?? {}) as { data?: Array<{ id?: string }> }).data ?? [])[0]?.id;
      const form = new URLSearchParams();
      if (plan === 'free') {
        form.set('cancel_at_period_end', 'true');
      } else {
        const priceId = planPriceId(plan, env);
        if (!priceId || !itemId) return respond({ code: 'PLAN_PRICE_NOT_CONFIGURED' }, 503);
        form.set('cancel_at_period_end', 'false');
        form.set('items[0][id]', itemId);
        form.set('items[0][price]', priceId);
        form.set('proration_behavior', 'none');
        form.set('metadata[plan_key]', plan);
      }
      await client.updateSubscription(current.stripe_subscription_id, form);
      const synced = await syncSubscription(billingDb, client, current.stripe_subscription_id, env);
      if (!synced) return respond({ code: 'SUBSCRIPTION_NOT_VERIFIED' }, 409);
      await db.rpc('mova_set_after_trial_plan', { p_artist_business_id: businessId, p_plan: plan });
      return summary();
    }

    if (body.action === 'unlock') {
      const plan = body.plan as PlanKey;
      if (plan !== 'pro' && plan !== 'ai_growth') return respond({ code: 'PLAN_INVALID' }, 422);
      if (!await owner()) return respond({ code: 'OWNER_REQUIRED' }, 403);
      const client = stripe();
      if (!client) return respond({ code: 'BILLING_NOT_CONFIGURED' }, 503);
      const priceId = planPriceId(plan, env);
      if (!priceId) return respond({ code: 'PLAN_PRICE_NOT_CONFIGURED' }, 503);
      const trial = await trialStatus();
      if (trial.state === 'admin') return respond({ code: 'PLAN_ASSIGNED_BY_ADMIN' }, 409);
      if (trial.state === 'trialing') return respond({ code: 'USE_AFTER_TRIAL' }, 409);
      const { data: current } = await db.from('mova_billing_subscriptions').select('stripe_customer_id,stripe_subscription_id,status,plan_key,livemode')
        .eq('artist_business_id', businessId).maybeSingle();
      const sameMode = current?.livemode === (client.mode === 'live');
      const returnPath = typeof body.return_path === 'string' ? body.return_path : `/${businessId}/settings/plan`;
      const fallback = async () => {
        const success = operatorReturnUrl(env, `${returnPath}?checkout=success&session_id={CHECKOUT_SESSION_ID}`);
        const cancel = operatorReturnUrl(env, `${returnPath}?checkout=cancelled`);
        if (!success || !cancel) return respond({ code: 'RETURN_PATH_INVALID' }, 422);
        const session = await client.createSubscriptionCheckout({ priceId, businessId, plan, successUrl: success.replace('%7BCHECKOUT_SESSION_ID%7D', '{CHECKOUT_SESSION_ID}'),
          cancelUrl: cancel, customerId: sameMode ? current?.stripe_customer_id ?? null : null, email: actor.user.email ?? null });
        return respond({ code: 'PAYMENT_NEEDS_ACTION', checkout_url: session.url }, 402);
      };
      // Pro → AI + Growth: swap the price and charge the difference now.
      if (sameMode && current?.status === 'active' && current.stripe_subscription_id) {
        if (current.plan_key === plan) return summary();
        const live = await client.retrieveSubscriptionWithCard(current.stripe_subscription_id);
        const itemId = (((live.items ?? {}) as { data?: Array<{ id?: string }> }).data ?? [])[0]?.id;
        if (!itemId) return respond({ code: 'SUBSCRIPTION_NOT_VERIFIED' }, 409);
        const form = new URLSearchParams({ 'items[0][id]': itemId, 'items[0][price]': priceId, proration_behavior: 'always_invoice', 'metadata[plan_key]': plan, payment_behavior: 'error_if_incomplete' });
        try { await client.updateSubscription(current.stripe_subscription_id, form); } catch { return fallback(); }
        await syncSubscription(billingDb, client, current.stripe_subscription_id, env);
        return summary();
      }
      if (sameMode && current && ['trialing', 'past_due'].includes(current.status)) return respond({ code: 'MANAGE_IN_BILLING_PORTAL' }, 409);
      // No live subscription: charge the card on file right away (no second trial).
      let paymentMethod: string | null = null;
      if (sameMode && current?.stripe_customer_id) {
        try {
          const customer = await client.retrieveCustomer(current.stripe_customer_id);
          const settings = (customer.invoice_settings ?? {}) as Record<string, unknown>;
          const method = settings.default_payment_method;
          paymentMethod = typeof method === 'string' ? method : method && typeof method === 'object' ? String((method as Record<string, unknown>).id) : null;
          if (!paymentMethod && current.stripe_subscription_id) {
            const old = await client.retrieveSubscriptionWithCard(current.stripe_subscription_id);
            const oldMethod = old.default_payment_method;
            paymentMethod = typeof oldMethod === 'string' ? oldMethod : oldMethod && typeof oldMethod === 'object' ? String((oldMethod as Record<string, unknown>).id) : null;
          }
        } catch { paymentMethod = null; }
      }
      if (!paymentMethod || !current?.stripe_customer_id) return fallback();
      const form = new URLSearchParams({
        customer: current.stripe_customer_id, 'items[0][price]': priceId, default_payment_method: paymentMethod,
        payment_behavior: 'error_if_incomplete', 'metadata[artist_business_id]': businessId, 'metadata[plan_key]': plan,
        'expand[0]': 'default_payment_method', 'expand[1]': 'latest_invoice',
      });
      let created: Record<string, unknown>;
      try { created = await client.createSubscription(form); }
      catch (error) {
        if (error instanceof StripeBillingError) return fallback();
        throw error;
      }
      const args = subscriptionApplyArgs(created, env, client.mode, undefined, actor.user.id);
      if (!args) return respond({ code: 'SUBSCRIPTION_NOT_VERIFIED' }, 409);
      const { error } = await db.rpc('mova_apply_billing_state', args);
      if (error) return respond({ code: 'PLAN_SAVE_FAILED' }, 500);
      return summary();
    }

    if (body.action && body.action !== 'get') return respond({ code: 'ACTION_INVALID' }, 422);
    return summary();
  } catch (error) {
    const code = error instanceof Error ? error.message : 'PLAN_ACTION_FAILED';
    if (code.startsWith('STRIPE_')) return respond({ code: 'BILLING_REQUEST_FAILED' }, 502);
    return respond({ code: 'PLAN_ACTION_FAILED' }, 500);
  }
}));
