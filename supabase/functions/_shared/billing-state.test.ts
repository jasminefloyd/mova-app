import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { handleBillingWebhook, subscriptionApplyArgs, type BillingDb, type BillingStripe } from './billing-state';
import { lockedFeatures } from './plan-locks';
import { StripeBillingClient } from './providers/stripe/billing';

// Free trial WP2: event → state mapping, signature, idempotency and the messages each transition queues.
const biz = 'e1060000-0000-4000-8000-00000000000a';
const env = (name: string) => ({ MOVA_STRIPE_PRICE_PRO: 'price_pro', MOVA_STRIPE_PRICE_AI_GROWTH: 'price_aig' } as Record<string, string>)[name];
const secret = 'whsec_test_secret';
const now = 1_795_000_000;

function sign(raw: string, t = now) {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;
}
function subscription(over: Record<string, unknown> = {}) {
  return {
    id: 'sub_1', object: 'subscription', customer: 'cus_1', livemode: false, status: 'trialing', metadata: { artist_business_id: biz, plan_key: 'ai_growth' },
    items: { data: [{ id: 'si_1', price: { id: 'price_aig' }, current_period_end: now + 30 * 86400 }] },
    trial_end: now + 30 * 86400, cancel_at_period_end: false,
    default_payment_method: { id: 'pm_1', card: { brand: 'visa', last4: '4242', fingerprint: 'fp_abc' } },
    latest_invoice: { id: 'in_0', amount_paid: 0 },
    ...over,
  };
}
function harness(outcome: Record<string, unknown>, sub = subscription(), begin: boolean = true) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const db: BillingDb = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push([name, args]);
      if (name === 'mova_billing_event_begin') return { data: begin, error: null };
      if (name === 'mova_apply_billing_state') return { data: outcome, error: null };
      if (name === 'mova_billing_business_for_customer') return { data: [{ artist_business_id: biz, stripe_subscription_id: 'sub_1' }], error: null };
      return { data: true, error: null };
    }) as BillingDb['rpc'],
  };
  const stripe: BillingStripe = { mode: 'test', retrieveSubscriptionWithCard: vi.fn(async () => sub) };
  return { db, stripe, calls, queued: () => calls.filter(([name]) => name === 'mova_enqueue_account_event').map(([, a]) => a.p_event_type) };
}
const event = (type: string, object: Record<string, unknown>, id = 'evt_1') => JSON.stringify({ id, type, livemode: false, created: now, data: { object } });

describe('billing webhook', () => {
  it('refuses a bad signature', async () => {
    const h = harness({});
    const raw = event('customer.subscription.updated', subscription());
    const result = await handleBillingWebhook(raw, 't=1,v1=00', secret, h.db, h.stripe, env, now);
    expect(result.status).toBe(400);
    expect(h.calls).toHaveLength(0);
  });

  it('refuses an event from the other Stripe mode', async () => {
    const h = harness({});
    const raw = JSON.stringify({ id: 'evt_live', type: 'invoice.paid', livemode: true, created: now, data: { object: {} } });
    expect((await handleBillingWebhook(raw, sign(raw), secret, h.db, h.stripe, env, now)).body.code).toBe('STRIPE_EVENT_MODE_MISMATCH');
  });

  it('answers a duplicate event without applying it again', async () => {
    const h = harness({}, subscription(), false);
    const raw = event('customer.subscription.updated', subscription());
    const result = await handleBillingWebhook(raw, sign(raw), secret, h.db, h.stripe, env, now);
    expect(result.body.duplicate).toBe(true);
    expect(h.calls.map(([name]) => name)).toEqual(['mova_billing_event_begin']);
  });

  it('re-reads the subscription and starts the trial on checkout completion', async () => {
    const h = harness({ trial_started: true, plan_key: 'ai_growth' });
    const raw = event('checkout.session.completed', { id: 'cs_test_1', mode: 'subscription', subscription: 'sub_1' });
    const result = await handleBillingWebhook(raw, sign(raw), secret, h.db, h.stripe, env, now);
    expect(result.status).toBe(200);
    const applied = h.calls.find(([name]) => name === 'mova_apply_billing_state')![1];
    expect(applied).toMatchObject({ p_artist_business_id: biz, p_status: 'trialing', p_price_plan: 'ai_growth', p_card_brand: 'visa', p_card_last4: '4242', p_card_fingerprint: 'fp_abc' });
    expect(h.queued()).toEqual(['trial.started']);
  });

  it('queues the converted message with the amount charged when the trial ends on a paid plan', async () => {
    const h = harness({ trial_converted: true, plan_key: 'ai_growth' }, subscription({ status: 'active', trial_end: now - 60 }));
    const invoice = { id: 'in_1', subscription: 'sub_1', amount_paid: 3900, billing_reason: 'subscription_cycle' };
    const raw = event('invoice.paid', invoice);
    await handleBillingWebhook(raw, sign(raw), secret, h.db, h.stripe, env, now);
    const queued = h.calls.find(([name]) => name === 'mova_enqueue_account_event')![1];
    expect(queued).toMatchObject({ p_event_type: 'trial.converted', p_idempotency_key: 'trial-converted:sub_1', p_payload: { plan_key: 'ai_growth', amount_minor: 3900 } });
  });

  it('queues one payment-failed message per invoice', async () => {
    const h = harness({ plan_key: 'ai_growth' }, subscription({ status: 'past_due' }));
    const invoice = { id: 'in_2', parent: { subscription_details: { subscription: 'sub_1' } }, amount_due: 3900 };
    const raw = event('invoice.payment_failed', invoice);
    await handleBillingWebhook(raw, sign(raw), secret, h.db, h.stripe, env, now);
    const queued = h.calls.find(([name]) => name === 'mova_enqueue_account_event')![1];
    expect(queued).toMatchObject({ p_event_type: 'billing.payment_failed', p_idempotency_key: 'payment-failed:in_2' });
  });

  it('queues the trial-ended message when the trial ends on Free', async () => {
    const h = harness({ trial_ended_free: true, plan_key: 'free' }, subscription({ status: 'canceled', cancel_at_period_end: true }));
    const raw = event('customer.subscription.deleted', subscription({ status: 'canceled' }));
    await handleBillingWebhook(raw, sign(raw), secret, h.db, h.stripe, env, now);
    expect(h.queued()).toEqual(['trial.ended_free']);
  });

  it('finds the subscription for a card change from the customer', async () => {
    const h = harness({ plan_key: 'ai_growth' });
    const raw = event('payment_method.attached', { id: 'pm_2', customer: 'cus_1' });
    await handleBillingWebhook(raw, sign(raw), secret, h.db, h.stripe, env, now);
    expect(h.stripe.retrieveSubscriptionWithCard).toHaveBeenCalledWith('sub_1');
  });

  it('ignores subscriptions that are not Mova plans', async () => {
    const h = harness({}, subscription({ metadata: {} }));
    const raw = event('customer.subscription.updated', subscription({ metadata: {} }));
    const result = await handleBillingWebhook(raw, sign(raw), secret, h.db, h.stripe, env, now);
    expect(result.body.ignored).toBe(true);
    expect(h.calls.some(([name]) => name === 'mova_apply_billing_state')).toBe(false);
  });

  it('records the failure so Stripe retries the event', async () => {
    const h = harness({});
    (h.stripe.retrieveSubscriptionWithCard as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('STRIPE_BILLING_REQUEST_FAILED'));
    const raw = event('customer.subscription.updated', subscription());
    const result = await handleBillingWebhook(raw, sign(raw), secret, h.db, h.stripe, env, now);
    expect(result.status).toBe(503);
    expect(h.calls.at(-1)).toEqual(['mova_billing_event_finish', { p_event_id: 'evt_1', p_error: 'STRIPE_BILLING_REQUEST_FAILED' }]);
  });
});

describe('subscription → billing state', () => {
  it('maps the after-trial choice: Free is cancel at period end', () => {
    const args = subscriptionApplyArgs(subscription({ cancel_at_period_end: true }), env, 'test', now)!;
    expect(args).toMatchObject({ p_cancel_at_period_end: true, p_price_plan: 'ai_growth', p_event_at: new Date(now * 1000).toISOString() });
  });
  it('maps a switch to Pro from the price', () => {
    const sub = subscription({ items: { data: [{ id: 'si_1', price: { id: 'price_pro' } }] } });
    expect(subscriptionApplyArgs(sub, env, 'test')!.p_price_plan).toBe('pro');
  });
  it('refuses an unknown price or the wrong mode', () => {
    expect(subscriptionApplyArgs(subscription({ items: { data: [{ price: { id: 'price_other' } }] } }), env, 'test')).toBeNull();
    expect(subscriptionApplyArgs(subscription(), env, 'live')).toBeNull();
  });
});

describe('trial checkout', () => {
  it('adds the 30-day trial and always collects the card', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ id: 'cs_test_1', url: 'https://checkout.stripe.invalid/x', livemode: false }));
    await new StripeBillingClient('sk_test_x', fetcher).createSubscriptionCheckout({ priceId: 'price_aig', businessId: biz, plan: 'ai_growth', successUrl: 'https://a/s', cancelUrl: 'https://a/c', trialDays: 30 });
    const body = new URLSearchParams(String(fetcher.mock.calls[0]![1]!.body));
    expect(body.get('subscription_data[trial_period_days]')).toBe('30');
    expect(body.get('payment_method_collection')).toBe('always');
    expect(body.get('subscription_data[trial_settings][end_behavior][missing_payment_method]')).toBe('cancel');
    expect(body.get('subscription_data[metadata][trial]')).toBe('true');
  });
  it('reports the decline code when charging the card on file fails (SCA fallback)', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ error: { code: 'card_declined', decline_code: 'authentication_required' } }, { status: 402 }));
    await expect(new StripeBillingClient('sk_test_x', fetcher).createSubscription(new URLSearchParams())).rejects.toMatchObject({ code: 'authentication_required' });
  });
});

describe('plan locks', () => {
  const plans = [
    { plan_key: 'free', entitlements: { features: { marketing_email: false, reports_ai_revenue: false, concierge: false, google_calendar_sync: false } } },
    { plan_key: 'pro', entitlements: { features: { marketing_email: true, reports_ai_revenue: false, concierge: false, google_calendar_sync: true } } },
    { plan_key: 'ai_growth', entitlements: { features: { marketing_email: true, reports_ai_revenue: true, concierge: true, google_calendar_sync: true } } },
  ];
  it('lists what the plan locks and the plan that unlocks it, skipping switched-off features', () => {
    const locked = lockedFeatures({ marketing_email: false }, plans, { marketing_email: true, concierge: false }, false);
    expect(locked).toEqual([
      { feature: 'google_calendar_sync', required_plan: 'pro' },
      { feature: 'marketing_email', required_plan: 'pro' },
      { feature: 'reports_ai_revenue', required_plan: 'ai_growth' },
    ]);
  });
  it('locks nothing on AI + Growth', () => {
    expect(lockedFeatures({ marketing_email: true, reports_ai_revenue: true, concierge: true, google_calendar_sync: true }, plans, {}, true)).toEqual([]);
  });
});
