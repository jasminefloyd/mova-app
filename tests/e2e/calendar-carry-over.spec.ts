import { expect, test, type Page, type Route } from '@playwright/test';
import { openOperatorPage } from './operator-session';

// P6: an existing calendar connection carried over by migration 0072 shows up on the one Google connection
// without a reconnect. Business Profile is off until its permission is granted; calendar keeps working.
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-mova-artist-business-id', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const carriedOver = {
  google: {
    google_account_email: 'ari.monroe@gmail.com', status: 'active', connected_at: '2026-10-01T10:00:00Z',
    calendar_enabled: true, calendar_id: 'work-calendar', business_profile_enabled: false, business_location_id: null,
    has_business_scope: false, has_calendar_scope: true,
  },
  settings: { location_ids: [], apple_feed_enabled: true },
  locations: [{ id: 'loc-1', name: 'Studio 9 Suites' }],
  feedConfigured: true,
  providerConfigured: true,
};

async function mockConnection(page: Page) {
  const actions: Array<Record<string, unknown>> = [];
  await page.route('**/functions/v1/calendar-google-connect', async (route: Route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const body = route.request().postDataJSON() as Record<string, unknown>;
    actions.push(body);
    const data = body.action === 'calendars'
      ? { calendars: [{ id: 'work-calendar', summary: 'Work', primary: true }, { id: 'personal-calendar', summary: 'Personal', primary: false }] }
      : body.action === 'set-toggles' ? { saved: true, ...body } : carriedOver;
    return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify({ data, error: null }) });
  });
  await page.route('**/functions/v1/google-business-sync', (route) => route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify({ data: { connected: true, business_profile_ready: false, provider_configured: true, auto_send: true, last_synced_at: null, last_sync_status: 'never', sections: { profile: 'up_to_date', hours: 'up_to_date', booking_link: 'up_to_date', services_waiting: 0 }, changes: [] }, error: null }) }));
  await page.route('**/functions/v1/review-management', (route) => route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify({ data: { summary: { google_count: 0, awaiting_reply: 0 } }, error: null }) }));
  return actions;
}

test('TC-GOOGLE-CARRY-01 a carried-over calendar connection shows as connected with no reconnect', async ({ page }) => {
  await openOperatorPage(page, '/');
  await mockConnection(page);
  await page.goto('/BID-1/settings/google');

  await expect(page.getByRole('heading', { name: 'Google', exact: true })).toBeVisible();
  await expect(page.getByText('ari.monroe@gmail.com')).toBeVisible();
  await expect(page.getByText('Connected', { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Sync Google Calendar' })).toBeChecked();
  await expect(page.getByRole('switch', { name: 'Use Google Business Profile' })).not.toBeChecked();
  await expect(page.getByText('Turning this on needs one more Google permission. Your calendar stays connected.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect Google', exact: true })).toHaveCount(0);
});

test('TC-GOOGLE-CARRY-02 calendar sync shows the shared Google account, the calendar choice and stop sync', async ({ page }) => {
  await openOperatorPage(page, '/');
  const actions = await mockConnection(page);
  await page.goto('/BID-1/settings/calendar-sync');

  await expect(page.getByText('ari.monroe@gmail.com')).toBeVisible();
  await expect(page.getByText('Same Google connection as your reviews')).toBeVisible();
  const calendar = page.locator('select');
  await expect(calendar).toHaveValue('work-calendar');
  await expect(calendar.locator('option')).toHaveCount(2);
  await page.getByRole('button', { name: 'Stop calendar sync' }).click();
  await expect(page.getByText('Calendar sync stopped.')).toBeVisible();
  await expect(page.getByText('Your Google reviews and listing stay connected.')).toBeVisible();
  expect(actions).toContainEqual({ action: 'set-toggles', calendar_enabled: false });
});
