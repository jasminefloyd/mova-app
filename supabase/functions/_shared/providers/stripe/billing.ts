// Subscription billing uses the platform Stripe account, separate from stylist Connect accounts.
export type PlanKey = 'pro' | 'ai_growth';
export type BillingMode = 'test' | 'live';

export function planPriceId(plan: PlanKey, env: (name: string) => string | undefined): string | null {
  const value = env(plan === 'pro' ? 'MOVA_STRIPE_PRICE_PRO' : 'MOVA_STRIPE_PRICE_AI_GROWTH');
  return value && /^price_[A-Za-z0-9]+$/.test(value) ? value : null;
}

export class StripeBillingClient {
  readonly mode: BillingMode;
  constructor(private readonly secretKey: string, private readonly fetcher: typeof fetch = fetch, mode?: BillingMode) {
    const inferredMode: BillingMode | null = /^(sk|rk)_test_/.test(secretKey) ? 'test' : /^(sk|rk)_live_/.test(secretKey) ? 'live' : null;
    if (!inferredMode || (mode && mode !== inferredMode)) throw new Error('STRIPE_BILLING_KEY_MODE_INVALID');
    this.mode = mode ?? inferredMode;
  }
  private async call(method: 'GET' | 'POST', path: string, form?: URLSearchParams) {
    const response = await this.fetcher(`https://api.stripe.com/v1${path}`, {
      method, headers: { Authorization: `Bearer ${this.secretKey}`, ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, ...(form ? { body: form.toString() } : {}),
    });
    const json = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok || !json) throw new Error('STRIPE_BILLING_REQUEST_FAILED');
    if (typeof json.livemode === 'boolean' && json.livemode !== (this.mode === 'live')) throw new Error('STRIPE_OBJECT_MODE_MISMATCH');
    return json;
  }
  createSubscriptionCheckout(input: { priceId: string; businessId: string; plan: PlanKey; successUrl: string; cancelUrl: string; customerId?: string | null; email?: string | null }) {
    const form = new URLSearchParams({
      mode: 'subscription', 'line_items[0][price]': input.priceId, 'line_items[0][quantity]': '1',
      success_url: input.successUrl, cancel_url: input.cancelUrl, client_reference_id: input.businessId,
      'metadata[artist_business_id]': input.businessId, 'metadata[plan_key]': input.plan,
      'subscription_data[metadata][artist_business_id]': input.businessId, 'subscription_data[metadata][plan_key]': input.plan,
    });
    if (input.customerId) form.set('customer', input.customerId); else if (input.email) form.set('customer_email', input.email);
    return this.call('POST', '/checkout/sessions', form);
  }
  retrieveCheckout(sessionId: string) {
    const validPrefix = this.mode === 'live' ? /^cs_live_[A-Za-z0-9_]+$/ : /^cs_test_[A-Za-z0-9_]+$/;
    if (!validPrefix.test(sessionId)) throw new Error('STRIPE_SESSION_ID_INVALID');
    return this.call('GET', `/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=subscription`);
  }
  retrieveSubscription(subscriptionId: string) {
    if (!/^sub_[A-Za-z0-9]+$/.test(subscriptionId)) throw new Error('STRIPE_SUBSCRIPTION_ID_INVALID');
    return this.call('GET', `/subscriptions/${encodeURIComponent(subscriptionId)}`);
  }
  createPortalSession(customerId: string, returnUrl: string) {
    if (!/^cus_[A-Za-z0-9]+$/.test(customerId)) throw new Error('STRIPE_CUSTOMER_ID_INVALID');
    return this.call('POST', '/billing_portal/sessions', new URLSearchParams({ customer: customerId, return_url: returnUrl }));
  }
}

/** Reads a completed checkout into what mova_apply_plan_subscription needs, or null. */
export function verifiedSubscription(session: Record<string, unknown>, businessId: string, mode?: BillingMode) {
  const metadata = (session.metadata ?? {}) as Record<string, string>;
  const subscription = (session.subscription ?? {}) as Record<string, unknown>;
  const plan = metadata.plan_key;
  if (session.mode !== 'subscription' || session.status !== 'complete' || session.client_reference_id !== businessId || metadata.artist_business_id !== businessId) return null;
  if (mode && session.livemode !== (mode === 'live')) return null;
  if (plan !== 'pro' && plan !== 'ai_growth') return null;
  const subscriptionId = typeof subscription.id === 'string' ? subscription.id : typeof session.subscription === 'string' ? session.subscription : null;
  const status = typeof subscription.status === 'string' ? subscription.status : 'incomplete';
  if (!subscriptionId || typeof session.customer !== 'string') return null;
  return { plan: plan as PlanKey, customerId: session.customer, subscriptionId, status: ['active', 'trialing', 'past_due', 'canceled', 'incomplete'].includes(status) ? status : 'incomplete' };
}
