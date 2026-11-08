import { StripeBillingClient } from './providers/stripe/billing.ts';

/** Stripe Billing is test-mode only (task 5.8): MOVA_STRIPE_TEST_MODE=true and an sk_test_ key. */
export function billingClientFromEnv(env: (name: string) => string | undefined): StripeBillingClient | null {
  const secret = env('STRIPE_SECRET_KEY');
  if (env('MOVA_STRIPE_TEST_MODE') !== 'true' || !secret?.startsWith('sk_test_')) return null;
  return new StripeBillingClient(secret);
}

export function operatorReturnUrl(env: (name: string) => string | undefined, path: string) {
  const base = (env('OPERATOR_BASE_URL') ?? 'https://ops.mova-beauty.co').replace(/\/$/, '');
  return path.startsWith('/') && !path.startsWith('//') ? `${base}${path}` : null;
}
