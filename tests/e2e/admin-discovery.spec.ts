import { expect, test } from '@playwright/test';
import { fulfillJson, mockAdminApi } from './admin-session';

test('Overview reports corrected rates, activation, subscriptions, and Discovery', async ({ page }) => {
  const current = { active_stylists: 4, new_signups: 3, bookings_made: 25, appointments_due: 10, completed: 8, no_shows: 2,
    processed_minor: 20000, fees_minor: 300, recorded_minor: 0, salon_minor: 0,
    seat_filler_filled: 0, seat_filler_offered: 0, autopilot_rebooked: 0, autopilot_sent: 0, concierge_conversations: 0, concierge_handed: 0 };
  const campaign = { kind: 'landing', landing_path: '/calculator', visits: 10, signup_clicks: 3, signups: 2, converted: 2 };
  await mockAdminApi(page, {
    isAdmin: true, signedIn: true,
    rpc: {
      mova_admin_overview: () => ({ current, prior: current, weekly_active: [], top_stylists: [], needs_nudge: { quiet: 0, items: [] }, language: { en_us: 0, es_us: 0 } }),
      mova_admin_activation: () => [{ cohort: '2026-11-01', verified: 4, published: 3, published_hours: 12, booked: 2, booked_hours: 30, completed: 1, completed_hours: 72 }],
      mova_admin_subscription_summary: () => ({
        plans: { free: 3, pro: 1 }, mrr_minor: 1900, paid_subscriptions: 1, active_trials: 0, expiring_trials: 0, trials_converted: 1,
        trials_resolved: 2, past_due: 0, pending_cancellations: 0, billing_events: { payment_failures: 1, cancellations: 0 },
        deletion_requests: 0, open_deletion_requests: 0,
      }),
      mova_admin_discovery: () => ({ through: '2026-11-22', current: campaign, prior: null, breakdown: [campaign],
        pages: [{ path: '/calculator', views: 13, visits: 10 }], calculator: { used: 8, signup_clicks: 3, signups: 2 } }),
    },
  });
  await page.route('**/api/admin-search-discovery', route => fulfillJson(route, {
    state: 'ready', start: '2026-10-24', through: '2026-11-20',
    current: { clicks: 5, impressions: 25, ctr: 0.2, position: 12 },
    terms: [{ keys: ['booth rent calculator', 'https://mova-beauty.co/calculator'], clicks: 5, impressions: 25, ctr: 0.2, position: 12 }],
    pages: [],
  }));
  await page.goto('/admin');
  await expect(page.locator('.kpi').filter({ hasText: 'No-show rate' })).toContainText('20.0%');
  await expect(page.getByText('Stylists with a booking created that week')).toBeVisible();
  await expect(page.getByText('12 hr median')).toBeVisible();
  await expect(page.locator('.kpi').filter({ hasText: 'Monthly recurring revenue' })).toContainText('$19');
  await expect(page.getByRole('heading', { name: 'Growth funnel' })).toHaveCount(0);
  await page.getByRole('link', { name: 'View discovery report' }).click();
  await expect(page.getByRole('heading', { name: 'Discovery', exact: true })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'booth rent calculator' })).toContainText('/calculator');
  await expect(page.getByRole('row').filter({ hasText: '/calculator' }).filter({ hasText: '20.0%' }).first()).toBeVisible();
  await expect(page.locator('.kpi').filter({ hasText: 'Calculator uses' })).toContainText('8');
  await page.getByRole('button', { name: 'Branded', exact: true }).click();
  await expect(page.getByText('No matching queries among the top reported results.')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('columnheader', { name: 'Page views' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
