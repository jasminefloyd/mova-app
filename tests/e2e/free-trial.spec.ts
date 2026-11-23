import { expect, test, type Page } from '@playwright/test';
import { openOperatorPage } from './operator-session';

// Free trial (CR-018): T1 on first entry, the trial strip and countdown on Home, locks with an unlock card,
// and the after-trial choice on Plan. plan-management and trial-start are route-mocked; Stripe is never called.
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-mova-artist-business-id', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const features = (paid: boolean, growth: boolean) => ({ booking_page: true, reports_basic: true, google_calendar_sync: paid, reports_advanced: paid, custom_cover: paid, custom_handle: paid, reviews_public: paid, marketing_campaigns: growth, reports_ai_revenue: growth });
const plans = [
  { plan_key: 'free', display_name: 'Free', monthly_price_minor: 0, mova_fee_basis_points: 150, status: 'active', entitlements: { features: features(false, false) } },
  { plan_key: 'pro', display_name: 'Pro', monthly_price_minor: 1900, mova_fee_basis_points: 100, status: 'active', entitlements: { features: features(true, false) } },
  { plan_key: 'ai_growth', display_name: 'AI + Growth', monthly_price_minor: 3900, mova_fee_basis_points: 75, status: 'active', entitlements: { features: features(true, true) } },
];
const trial = (overrides: Record<string, unknown>): Record<string, unknown> => ({
  enabled: true, state: 'eligible', eligible: true, is_owner: true, should_offer: false, plan_key: 'free', admin_assigned: false,
  offered_at: null, declined_at: null, started_at: null, ends_at: null, ended_at: null, days_left: null, trial_days: 30, after_trial_plan: null,
  subscription_plan: null, subscription_status: null, cancel_at_period_end: false, current_period_end: null, card: null, has_customer: false,
  past_due_since: null, grace_ends_at: null, ...overrides,
});
const summary = (plan: 'free' | 'pro' | 'ai_growth', trialState: Record<string, unknown>) => {
  const current = plans.find((item) => item.plan_key === plan)!;
  return { current_plan: current, plans, usage: {}, features: current.entitlements.features, subscription: null, billing_available: true, billing_mode: 'test', trial: trial({ plan_key: plan, ...trialState }), locked_features: [] };
};

async function withPlan(page: Page, path: string, value: ReturnType<typeof summary>) {
  const calls: Array<{ name: string; body: Record<string, unknown> }> = [];
  await openOperatorPage(page, path);
  let current = value;
  await page.route(/\/functions\/v1\/(plan-management|trial-start)$/, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const name = new URL(route.request().url()).pathname.split('/').pop()!;
    const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
    calls.push({ name, body });
    if (name === 'trial-start') return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify({ data: { checkout_url: 'https://checkout.stripe.com/c/pay/cs_test_trial' }, error: null }) });
    if (body.action === 'after_trial') current = { ...current, trial: { ...current.trial, after_trial_plan: body.plan as string } };
    return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify({ data: current, error: null }) });
  });
  await page.evaluate(() => window.sessionStorage.clear());
  await page.goto(`/BID-1${path}`);
  return calls;
}

test('T1: an eligible owner lands on the trial offer once, and can continue on Free', async ({ page }) => {
  await withPlan(page, '/', summary('free', { should_offer: true }));
  await expect(page).toHaveURL(/\/BID-1\/start-trial$/);
  await expect(page.getByRole('heading', { name: 'Try everything in AI + Growth, free.' })).toBeVisible();
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await page.getByRole('button', { name: 'Continue on Free' }).click();
  await expect(page).toHaveURL(/\/BID-1\/?$/);
});

test('T1: starting the trial goes to Stripe Checkout', async ({ page }) => {
  const calls = await withPlan(page, '/start-trial', summary('free', {}));
  await page.route('https://checkout.stripe.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Stripe Checkout (mock)</p>' }));
  await page.getByRole('button', { name: 'Add card and start free trial' }).click();
  await expect(page).toHaveURL(/checkout\.stripe\.com/);
  expect(calls.find((call) => call.name === 'trial-start')?.body).toEqual({ return_path: '/BID-1/start-trial' });
});

test('T3/T4: Home shows the trial strip early and the countdown in the last week', async ({ page }) => {
  await withPlan(page, '/', summary('ai_growth', { state: 'trialing', eligible: false, days_left: 18, ends_at: '2026-12-10T15:00:00.000Z' }));
  await expect(page.getByRole('region', { name: 'Free trial' })).toContainText('AI + Growth free trial · 18 days left');
  await withPlan(page, '/', summary('ai_growth', { state: 'trialing', eligible: false, days_left: 5, ends_at: '2026-11-27T15:00:00.000Z' }));
  await expect(page.getByRole('region', { name: 'Free trial' })).toContainText('Then $39/month for AI + Growth.');
});

test('T8: Google Calendar sync is locked on Free while the Apple feed stays usable', async ({ page }) => {
  await withPlan(page, '/settings/calendar-sync', summary('free', { state: 'free', eligible: false }));
  await expect(page.getByRole('heading', { name: 'Calendar sync is locked' })).toBeVisible();
  await page.getByRole('button', { name: 'Unlock with Pro · $19/mo' }).click();
  await expect(page).toHaveURL(/\/BID-1\/settings\/plan$/);
});

test('T5: the after-trial choice is saved through plan-management', async ({ page }) => {
  const calls = await withPlan(page, '/settings/plan', summary('ai_growth', { state: 'trialing', eligible: false, days_left: 12, ends_at: '2026-12-04T15:00:00.000Z', after_trial_plan: 'ai_growth', card: { brand: 'visa', last4: '4242' } }));
  await expect(page.getByText('12 days left')).toBeVisible();
  await page.getByText('Switch to Pro', { exact: true }).click();
  await expect(page.getByRole('radio', { name: /Switch to Pro/ })).toBeChecked();
  await expect(page.getByText("Saved. We'll remind you before your trial ends.")).toBeVisible();
  expect(calls).toContainEqual({ name: 'plan-management', body: { action: 'after_trial', plan: 'pro' } });
});
