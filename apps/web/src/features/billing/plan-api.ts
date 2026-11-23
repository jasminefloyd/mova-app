import type { createMovaSupabaseClient } from '../../lib/supabase';

// Plan and free-trial state, read through plan-management (never table selects; see check-direct-reads).
export type Client = ReturnType<typeof createMovaSupabaseClient>;
export type PlanKey = 'free' | 'pro' | 'ai_growth';
export type TrialState = 'eligible' | 'declined' | 'trialing' | 'active' | 'past_due' | 'ended_free' | 'free' | 'admin';

export type TrialStatus = {
  enabled: boolean; state: TrialState; eligible: boolean; is_owner: boolean; should_offer: boolean; plan_key: PlanKey;
  admin_assigned: boolean; offered_at: string | null; declined_at: string | null; started_at: string | null; ends_at: string | null;
  ended_at: string | null; days_left: number | null; trial_days: number; after_trial_plan: PlanKey | null;
  subscription_plan: PlanKey | null; subscription_status: string | null; cancel_at_period_end: boolean; current_period_end: string | null;
  card: { brand: string | null; last4: string } | null; has_customer: boolean; past_due_since: string | null; grace_ends_at: string | null;
};
export type Plan = { plan_key: PlanKey; display_name: string; monthly_price_minor: number; mova_fee_basis_points: number; status: string; entitlements: { features?: Record<string, boolean>; coming_soon?: string[] } & Record<string, unknown> };
export type LockedFeature = { feature: string; required_plan: 'pro' | 'ai_growth' };
export type PlanSummary = {
  current_plan: Plan; plans: Plan[]; usage: Record<string, number>; features: Record<string, boolean>;
  subscription: { plan_key: string; status: string; livemode?: boolean } | null; billing_available: boolean; billing_mode: 'test' | 'live' | null;
  trial: TrialStatus | null; locked_features: LockedFeature[];
};

export class PlanCallError extends Error {
  constructor(readonly code: string, readonly body: Record<string, unknown> = {}) { super(code); }
}

/** Calls a billing function for the active business. Throws PlanCallError with the function's code. */
export async function planCall(client: Client | null, businessId: string | null, name: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!client || !businessId) throw new PlanCallError('NO_CLIENT');
  const { data, error } = await client.functions.invoke<{ data?: Record<string, unknown> }>(name, { body, headers: { 'x-mova-artist-business-id': businessId } });
  if (error) {
    const context = (error as { context?: Response }).context;
    let parsed: Record<string, unknown>;
    try { parsed = context && typeof context.json === 'function' ? await context.json() as Record<string, unknown> : {}; } catch { parsed = {}; }
    const inner = (parsed.data ?? parsed.error ?? parsed) as Record<string, unknown>;
    throw new PlanCallError(typeof inner?.code === 'string' ? inner.code : 'FAILED', inner ?? {});
  }
  if (!data?.data) throw new PlanCallError('FAILED');
  return data.data;
}

export const planPrice = (summary: PlanSummary | null, key: PlanKey) => summary?.plans.find((plan) => plan.plan_key === key)?.monthly_price_minor ?? (key === 'pro' ? 1900 : key === 'ai_growth' ? 3900 : 0);
export const formatMoney = (minor: number, locale?: string) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: minor % 100 === 0 ? 0 : 2 }).format(minor / 100);
export const formatDay = (iso: string | null | undefined, locale?: string) => {
  if (!iso) return '';
  try { return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(new Date(iso)).replace('.', ''); } catch { return iso.slice(0, 10); }
};
export const formatLongDay = (iso: string | null | undefined, locale?: string) => {
  if (!iso) return '';
  try { return new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(iso)).replace(/\./g, ''); } catch { return iso.slice(0, 10); }
};
export const cardLabel = (card: TrialStatus['card']) => {
  if (!card) return null;
  const names: Record<string, string> = { visa: 'Visa', mastercard: 'Mastercard', amex: 'Amex', discover: 'Discover' };
  const brand = card.brand ? names[card.brand] ?? card.brand.charAt(0).toUpperCase() + card.brand.slice(1) : '';
  return `${brand} •• ${card.last4}`.trim();
};
export const isLocked = (summary: PlanSummary | null, feature: string) => Boolean(summary && summary.features && summary.features[feature] !== true);
export const requiredPlanFor = (summary: PlanSummary | null, feature: string): 'pro' | 'ai_growth' => {
  const pro = summary?.plans.find((plan) => plan.plan_key === 'pro')?.entitlements?.features ?? {};
  return pro[feature] === true ? 'pro' : 'ai_growth';
};
