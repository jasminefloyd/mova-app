import { describe, expect, it, vi } from 'vitest';
import { planPriceId, StripeBillingClient, verifiedSubscription } from './billing';

// Task 5.8. No live calls: the fetcher is injected.
const biz = 'e2500000-0000-4000-8000-000000000001';
describe('Stripe Billing test mode (task 5.8)', () => {
  it('reads plan price ids from config only when they look like Stripe prices', () => {
    const env = (values: Record<string, string>) => (name: string) => values[name];
    expect(planPriceId('pro', env({ MOVA_STRIPE_PRICE_PRO: 'price_123' }))).toBe('price_123');
    expect(planPriceId('ai_growth', env({ MOVA_STRIPE_PRICE_AI_GROWTH: '19.00' }))).toBeNull();
    expect(planPriceId('pro', env({}))).toBeNull();
  });
  it('refuses live keys and live objects', async () => {
    expect(() => new StripeBillingClient('sk_live_x')).toThrow('STRIPE_TEST_KEY_REQUIRED');
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ id: 'cs_test_1', livemode: true }));
    await expect(new StripeBillingClient('sk_test_x', fetcher).retrieveCheckout('cs_test_1')).rejects.toThrow('STRIPE_LIVE_OBJECT_REJECTED');
  });
  it('creates a subscription checkout tagged with the business and plan', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ id: 'cs_test_1', url: 'https://checkout.stripe.invalid/x', livemode: false }));
    await new StripeBillingClient('sk_test_x', fetcher).createSubscriptionCheckout({ priceId: 'price_pro', businessId: biz, plan: 'pro', successUrl: 'https://a/s', cancelUrl: 'https://a/c', email: 'n@example.invalid' });
    const body = new URLSearchParams(String(fetcher.mock.calls[0]![1]!.body));
    expect(Object.fromEntries(body)).toMatchObject({ mode: 'subscription', 'line_items[0][price]': 'price_pro', client_reference_id: biz, 'metadata[plan_key]': 'pro', customer_email: 'n@example.invalid' });
  });
  it('only accepts a complete checkout for the same business', () => {
    const session = { mode: 'subscription', status: 'complete', client_reference_id: biz, customer: 'cus_1', metadata: { artist_business_id: biz, plan_key: 'ai_growth' }, subscription: { id: 'sub_1', status: 'active' } };
    expect(verifiedSubscription(session, biz)).toEqual({ plan: 'ai_growth', customerId: 'cus_1', subscriptionId: 'sub_1', status: 'active' });
    expect(verifiedSubscription({ ...session, status: 'open' }, biz)).toBeNull();
    expect(verifiedSubscription(session, 'someone-else')).toBeNull();
    expect(verifiedSubscription({ ...session, metadata: { artist_business_id: biz, plan_key: 'free' } }, biz)).toBeNull();
  });
});
