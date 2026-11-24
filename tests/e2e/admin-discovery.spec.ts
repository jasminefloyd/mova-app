import { expect, test } from '@playwright/test';
import { mockAdminApi } from './admin-session';

test('Overview reports corrected rates, activation, subscriptions, and Discovery', async ({ page }) => {
  const current = { active_stylists: 4, new_signups: 3, bookings_made: 25, appointments_due: 10, completed: 8, no_shows: 2,
    processed_minor: 20000, fees_minor: 300, recorded_minor: 0, salon_minor: 0,
    seat_filler_filled: 0, seat_filler_offered: 0, autopilot_rebooked: 0, autopilot_sent: 0, concierge_conversations: 0, concierge_handed: 0 };
  const landing = { kind: 'landing', label: '/calculator', sessions: 10, visitors: 8, signups: 2, converted: 2 };
  const ad = { ...landing, kind: 'campaign', label: 'aig_pp_search / pricepilot', sessions: 14 };
  const traffic = { visitors: 8, sessions: 14, identified_sessions: 12, new_users: 6, returning_users: 2, page_views: 18, signup_clicks: 3, signups: 2, converted: 2 };
  const overviewPeriods: unknown[] = [];
  const subscriptionPeriods: unknown[] = [];
  const trafficPeriods: unknown[] = [];
  await mockAdminApi(page, {
    isAdmin: true, signedIn: true,
    rpc: {
      mova_admin_overview_for_period: body => {
        overviewPeriods.push(body);
        return { current, prior: current, weekly_active: [], top_stylists: [], needs_nudge: { quiet: 0, items: [] }, language: { en_us: 0, es_us: 0 } };
      },
      mova_admin_activation: () => [{ cohort: '2026-11-01', verified: 4, published: 3, published_hours: 12, booked: 2, booked_hours: 30, completed: 1, completed_hours: 72 }],
      mova_admin_subscription_summary_for_period: body => {
        subscriptionPeriods.push(body);
        return {
        plans: { free: 3, pro: 1 }, mrr_minor: 1900, paid_subscriptions: 1, active_trials: 0, expiring_trials: 0, trials_converted: 1,
        trials_resolved: 2, past_due: 0, pending_cancellations: 0, billing_events: { payment_failures: 1, cancellations: 0 },
          deletion_requests: 0, open_deletion_requests: 0,
        };
      },
      mova_admin_website_traffic: body => {
        trafficPeriods.push(body);
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
  const filter = page.getByRole('group', { name: 'Report period' });
  const options = ['Last 24 hours', '7 days', '14 days', '28 days', 'Custom'];
  await expect(filter.getByRole('button')).toHaveText(options);
  await expect(filter.getByRole('button', { name: '28 days' })).toHaveAttribute('aria-pressed', 'true');
  await filter.getByRole('button', { name: '14 days' }).click();
  for (const periods of [overviewPeriods, subscriptionPeriods, trafficPeriods]) {
    await expect.poll(() => periods).toContainEqual({ p_period: '14d' });
  }
  await page.getByRole('link', { name: 'View discovery report' }).click();
  await expect(page.getByRole('heading', { name: 'Discovery', exact: true })).toBeVisible();
  await expect(filter.getByRole('button')).toHaveText(options);
  await expect(filter.getByRole('button', { name: '14 days' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Returning visitors', { exact: true })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'aig_pp_search / pricepilot' })).toContainText('14.3%');
  await expect(page.getByRole('rowheader', { name: 'Brooklyn, NY, USA' })).toBeVisible();
  await expect(page.getByRole('rowheader', { name: 'Canada', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Last 24 hours', exact: true }).click();
  await expect.poll(() => trafficPeriods).toContainEqual({ p_period: '24h' });
  await page.getByRole('button', { name: 'Custom', exact: true }).click();
  await page.getByLabel('Start date (UTC)').fill('2026-11-01');
  await page.getByLabel('End date (UTC)').fill('2026-11-20');
  await page.getByRole('button', { name: 'Apply range' }).click();
  const custom = { p_period: 'custom', p_start: '2026-11-01', p_end: '2026-11-20' };
  await expect.poll(() => trafficPeriods).toContainEqual(custom);
  await expect(page.getByRole('heading', { name: 'Google Search' })).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: '/calculator' }).filter({ hasText: '20.0%' }).first()).toBeVisible();
  await expect(page.locator('.kpi').filter({ hasText: 'Calculator uses' })).toContainText('8');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('columnheader', { name: 'Page views' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.getByRole('link', { name: 'Overview', exact: true }).filter({ hasText: /^Overview$/ }).last().click();
  await expect(filter.getByRole('button', { name: 'Custom' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Start date (UTC)')).toHaveValue('2026-11-01');
  await expect(page.getByLabel('End date (UTC)')).toHaveValue('2026-11-20');
  for (const periods of [overviewPeriods, subscriptionPeriods]) {
    await expect.poll(() => periods).toContainEqual(custom);
  }
});

test('changing the Discovery range replaces every section with data for that range', async ({ page }) => {
  const totals = { visitors: 8, sessions: 12, identified_sessions: 12, new_users: 6, returning_users: 2, page_views: 17, signup_clicks: 5, signups: 3, converted: 3 };
  const empty = { visitors: 0, sessions: 0, identified_sessions: 0, new_users: 0, returning_users: 0, page_views: 0, signup_clicks: 0, signups: 0, converted: 0 };
  const breakdown = ([
    ['landing', '/signup'], ['campaign', 'aig_pp_search / pricepilot'], ['channel', 'paid search'],
    ['source', 'google'], ['referrer', 'google.com'], ['device', 'Mobile'], ['browser', 'Safari'],
  ] as const).map(([kind, label]) => ({ kind, label, sessions: 12, visitors: 8, signups: 3, converted: 3 }));

  await mockAdminApi(page, { isAdmin: true, signedIn: true, rpc: {
    mova_admin_website_traffic: body => {
      const short = (body as { p_period: string }).p_period === '24h';
      return {
        start: short ? '2026-11-23T15:00:00Z' : '2026-10-27T15:00:00Z',
        through: '2026-11-24T15:00:00Z',
        current: short ? empty : totals,
        prior: empty,
        breakdown: short ? [] : breakdown,
        geography: short ? [] : [{ city: 'Brooklyn', region: 'NY', country: 'US', sessions: 12, visitors: 8, signups: 3, converted: 3 }],
        pages: short ? [] : [{ path: '/pricing', views: 17, sessions: 12 }],
        calculator: short
          ? { used: 0, signup_clicks: 0, signups: 0, partial_history: true }
          : { used: 9, signup_clicks: 4, signups: 2, partial_history: false },
      };
    },
  } });

  await page.goto('/admin/discovery');
  const kpi = (label: string) => page.locator('.kpi').filter({ has: page.getByText(label, { exact: true }) }).locator('.big');
  const rows = [...breakdown.map(row => row.label), 'Brooklyn, NY, USA', '/pricing'];
  for (const label of rows) await expect(page.getByRole('rowheader', { name: label, exact: true })).toBeVisible();
  await expect(kpi('Sessions')).toHaveText('12');
  await expect(kpi('Page views')).toHaveText('17');
  await expect(kpi('Signup conversion')).toHaveText('25.0%');
  await expect(kpi('Calculator uses')).toHaveText('9');

  await page.getByRole('button', { name: 'Last 24 hours' }).click();
  await expect(page.getByText('Website traffic and verified stylist signups · Last 24 hours')).toBeVisible();
  for (const label of rows) await expect(page.getByRole('rowheader', { name: label, exact: true })).toHaveCount(0);
  for (const label of ['Visitors', 'Sessions', 'Page views', 'New visitors', 'Returning visitors',
    'Visits with a signup link click', 'Calculator uses', 'Start free clicks', 'Verified signups']) {
    await expect(kpi(label)).toHaveText('0');
  }
  await expect(kpi('Signup conversion')).toHaveText('—');
  await expect(page.getByText('No traffic recorded in this view.')).toHaveCount(7);
  await expect(page.getByText('No locations recorded in this period.')).toBeVisible();
  await expect(page.getByText('No page views recorded in this period.')).toBeVisible();
  await expect(page.getByText('Some older calculator activity', { exact: false })).toBeVisible();

  await page.getByRole('button', { name: '28 days' }).click();
  await expect(kpi('Calculator uses')).toHaveText('9');
  await expect(page.getByRole('rowheader', { name: 'Brooklyn, NY, USA' })).toBeVisible();
});
