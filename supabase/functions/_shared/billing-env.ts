import { StripeBillingClient } from './providers/stripe/billing.ts';

/** Plan billing has its own explicit mode/key so turning on live subscriptions cannot switch
 * appointment deposits, pay links or Stripe Connect away from their separate test-mode gate. */
export function billingClientFromEnv(env: (name: string) => string | undefined, fetcher?: typeof fetch): StripeBillingClient | null {
  const mode = env('MOVA_STRIPE_BILLING_MODE');
  if (mode === 'live') {
    const key = env('STRIPE_API_KEY');
    if (!key || !/^(sk|rk)_live_/.test(key)) return null;
    return new StripeBillingClient(key, fetcher, 'live');
  }
  if (mode === 'test' || (!mode && env('MOVA_STRIPE_TEST_MODE') === 'true')) {
    const key = env('STRIPE_SECRET_KEY');
    if (!key || !/^(sk|rk)_test_/.test(key)) return null;
    return new StripeBillingClient(key, fetcher, 'test');
  }
  return null;
}

export function operatorReturnUrl(env: (name: string) => string | undefined, path: string) {
  // Keep the post-checkout return on the authenticated app's origin: session storage is
  // origin-scoped, so using the old ops subdomain drops the signed-in session.
  const base = (env('OPERATOR_BASE_URL') ?? 'https://mova-beauty.co').replace(/\/$/, '');
  return path.startsWith('/') && !path.startsWith('//') ? `${base}${path}` : null;
}
