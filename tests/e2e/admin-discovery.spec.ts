import { expect, test } from '@playwright/test';
import { mockAdminApi } from './admin-session';

test('Overview reports corrected rates, activation, subscriptions, and Discovery', async ({ page }) => {
  const current = { active_stylists: 4, new_signups: 3, bookings_made: 25, appointments_due: 10, completed: 8, no_shows: 2,
    processed_minor: 20000, fees_minor: 300, recorded_minor: 0, salon_minor: 0,
    seat_filler_filled: 0, seat_filler_offered: 0, autopilot_rebooked: 0, autopilot_sent: 0, concierge_conversations: 0, concierge_handed: 0 };
  const landing = { kind: 'landing', label: '/calculator', sessions: 10, visitors: 8, signups: 2, converted: 2 };
  const ad = { ...landing, kind: 'campaign', label: 'aig_pp_search / pricepilot', sessions: 14 };
  const traffic = { visitors: 8, sessions: 14, identified_sessions: 12, new_users: 6, returning_users: 2, page_views: 18, signup_clicks: 3, signups: 2, converted: 2 };
  const periods: unknown[] = [];
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
      mova_admin_website_traffic: body => {
        periods.push(body);
        return { start: '2026-10-28T15:00:00Z', through: '2026-11-24T15:00:00Z', current: traffic, prior: traffic,
          breakdown: [landing, ad, { ...ad, kind: 'device', label: 'Mobile' }, { ...ad, kind: 'country', label: 'US' }],
          geography: [
            { city: 'Brooklyn', region: 'NY', country: 'US', sessions: 8, visitors: 5, signups: 2, converted: 2 },
            { city: '', region: '', country: 'CA', sessions: 6, visitors: 3, signups: 0, converted: 0 },
          ],
          pages: [{ path: '/calculator', views: 13, sessions: 10 }], calculator: { used: 8, signup_clicks: 3, signups: 2 } };
      },
    },
  });
  await page.goto('/admin');
  await expect(page.locator('.kpi').filter({ hasText: 'No-show rate' })).toContainText('20.0%');
  await expect(page.getByText('Stylists with a booking created that week')).toBeVisible();
  await expect(page.getByText('12 hr median')).toBeVisible();
  await expect(page.locator('.kpi').filter({ hasText: 'Monthly recurring revenue' })).toContainText('$19');
  await expect(page.getByRole('heading', { name: 'Growth funnel' })).toHaveCount(0);
  await expect(page.getByText('Returning visitors', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'View discovery report' }).click();
  await expect(page.getByRole('heading', { name: 'Discovery', exact: true })).toBeVisible();
  await expect(page.getByText('Returning visitors', { exact: true })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'aig_pp_search / pricepilot' })).toContainText('14.3%');
  await expect(page.getByRole('rowheader', { name: 'Brooklyn, NY, USA' })).toBeVisible();
  await expect(page.getByRole('rowheader', { name: 'Canada', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Last 24 hours', exact: true }).click();
  await expect.poll(() => periods).toContainEqual({ p_period: '24h' });
  await page.getByRole('button', { name: '3 months', exact: true }).click();
  await expect.poll(() => periods).toContainEqual({ p_period: '3mo' });
  await page.getByRole('button', { name: 'Custom', exact: true }).click();
  await page.getByLabel('Start date (UTC)').fill('2026-11-01');
  await page.getByLabel('End date (UTC)').fill('2026-11-20');
  await page.getByRole('button', { name: 'Apply range' }).click();
  await expect.poll(() => periods).toContainEqual({ p_period: 'custom', p_start: '2026-11-01', p_end: '2026-11-20' });
  await expect(page.getByRole('heading', { name: 'Google Search' })).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: '/calculator' }).filter({ hasText: '20.0%' }).first()).toBeVisible();
  await expect(page.locator('.kpi').filter({ hasText: 'Calculator uses' })).toContainText('8');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('columnheader', { name: 'Page views' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
