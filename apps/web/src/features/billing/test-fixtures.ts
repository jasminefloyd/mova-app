// Test-only builders for plan summaries (free trial WP6). Never imported by app code.
import type { PlanSummary, TrialStatus } from './plan-api';

const featureSet = (paid: boolean, growth: boolean) => ({
  booking_page: true, reports_basic: true, reviews_private: true,
  reviews_public: paid, reports_advanced: paid, google_calendar_sync: paid, custom_cover: paid, custom_handle: paid,
  seat_filler: paid, rebooking_assist: paid, text_reminders: paid,
  marketing_campaigns: growth, reports_ai_revenue: growth, rebooking_autopilot: growth, concierge: growth,
});

export const testPlans = [
  { plan_key: 'free' as const, display_name: 'Free', monthly_price_minor: 0, mova_fee_basis_points: 150, status: 'active', entitlements: { features: featureSet(false, false) } },
  { plan_key: 'pro' as const, display_name: 'Pro', monthly_price_minor: 1900, mova_fee_basis_points: 100, status: 'active', entitlements: { features: featureSet(true, false) } },
  { plan_key: 'ai_growth' as const, display_name: 'AI + Growth', monthly_price_minor: 3900, mova_fee_basis_points: 75, status: 'active', entitlements: { features: featureSet(true, true) } },
];

export function testTrial(overrides: Partial<TrialStatus> = {}): TrialStatus {
  return {
    enabled: true, state: 'eligible', eligible: true, is_owner: true, should_offer: false, plan_key: 'free', admin_assigned: false,
    offered_at: null, declined_at: null, started_at: null, ends_at: null, ended_at: null,
    days_left: null, trial_days: 30, after_trial_plan: null,
    subscription_plan: null, subscription_status: null, cancel_at_period_end: false, current_period_end: null,
    card: null, has_customer: false, past_due_since: null, grace_ends_at: null,
    ...overrides,
  } as TrialStatus;
}

export function testSummary(plan: 'free' | 'pro' | 'ai_growth' = 'free', trial: Partial<TrialStatus> | null = {}, extra: Partial<PlanSummary> = {}): PlanSummary {
  const current = testPlans.find((item) => item.plan_key === plan)!;
  return {
    current_plan: current, plans: testPlans, usage: {}, features: { ...current.entitlements.features },
    subscription: null, billing_available: true, billing_mode: 'test',
    trial: trial === null ? null : testTrial({ plan_key: plan, ...trial }), locked_features: [],
    ...extra,
  };
}
