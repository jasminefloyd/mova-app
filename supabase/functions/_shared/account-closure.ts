import type { serviceClient } from './booking.ts';
import { billingClientFromEnv } from './billing-env.ts';

export type ClosureDb = ReturnType<typeof serviceClient>;
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const liveStatuses = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused']);
const paidStatuses = new Set(['active', 'past_due', 'unpaid']);
const unixDate = (value: unknown) => typeof value === 'number' && value > 0 ? new Date(value * 1000).toISOString() : null;

export async function closureBilling(db: ClosureDb, business: string, change: 'none' | 'stop_renewal' | 'cancel', env = (name: string) => Deno.env.get(name), fetcher?: typeof fetch) {
  const { data, error } = await db.from('mova_billing_subscriptions')
    .select('stripe_subscription_id, status, livemode').eq('artist_business_id', business).maybeSingle();
  if (error) throw new Error('BILLING_LOOKUP_FAILED');
  if (!data?.stripe_subscription_id || !liveStatuses.has(data.status)) return { endsAt: null };
  const stripe = billingClientFromEnv(env, fetcher);
  if (!stripe || (stripe.mode === 'live') !== data.livemode) throw new Error('BILLING_NOT_CONFIGURED');

  const id = data.stripe_subscription_id;
  let subscription = await stripe.retrieveSubscription(id);
  const status = String(subscription.status);
  if (!liveStatuses.has(status)) return { endsAt: null };
  if (change === 'cancel' || (change === 'stop_renewal' && !paidStatuses.has(status))) {
    await stripe.cancelSubscription(id);
    return { endsAt: null };
  }
  if (!paidStatuses.has(status)) return { endsAt: null };
  const endsAt = () => {
    const items = subscription.items as { data?: { current_period_end?: number }[] } | undefined;
    const expiration = unixDate(subscription.current_period_end ?? items?.data?.[0]?.current_period_end);
    if (!expiration) throw new Error('BILLING_END_UNAVAILABLE');
    return expiration;
  };
  endsAt();
  if (change === 'stop_renewal' && subscription.cancel_at_period_end !== true) {
    subscription = await stripe.updateSubscription(id, new URLSearchParams({ cancel_at_period_end: 'true', proration_behavior: 'none' }));
    if (subscription.cancel_at_period_end !== true) throw new Error('STRIPE_UPDATE_FAILED');
  }
  return { endsAt: endsAt() };
}

export async function closureSignature(id: string, business: string, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`account-closure:v1:${id}:${business}`)));
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}


export async function accountAvailable(db: ClosureDb, business: string): Promise<boolean> {
  const { data, error } = await db.rpc('mova_account_available', { p_business: business });
  if (error) throw new Error('ACCOUNT_ACCESS_CHECK_FAILED');
  return data === true;
}

export async function accountCanChangeBilling(db: ClosureDb, business: string): Promise<boolean> {
  const { data, error } = await db.from('mova_account_closures')
    .select('id').eq('artist_business_id', business).maybeSingle();
  return !error && !data;
}
