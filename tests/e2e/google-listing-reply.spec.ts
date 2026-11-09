import { expect, test, type Page, type Route } from '@playwright/test';
import { openOperatorPage } from './operator-session';

// P6 boards 38d (listing and services sync) and 38e (reply on Google). Function calls are route-mocked.
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-mova-artist-business-id', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const connected = { google_account_email: 'ari.monroe@gmail.com', status: 'active', connected_at: '2026-10-01T10:00:00Z', calendar_enabled: true, calendar_id: 'primary', business_profile_enabled: true, business_location_id: 'accounts/1/locations/2', has_business_scope: true, has_calendar_scope: true };

function ok(route: Route, data: unknown) {
  return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify({ data, error: null }) });
}

async function functionCalls(page: Page, name: string, respond: (action: string) => unknown) {
  const calls: Array<Record<string, unknown>> = [];
  await page.route(`**/functions/v1/${name}`, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const body = route.request().postDataJSON() as Record<string, unknown>;
    calls.push(body);
    return ok(route, respond(String(body.action)));
  });
  return calls;
}

test('TC-GOOGLE-38D-01 shows what is waiting for Google and sends only those changes', async ({ page }) => {
  await openOperatorPage(page, '/');
  const listing = {
    connected: true, business_profile_ready: true, provider_configured: true, auto_send: true,
    last_synced_at: new Date(Date.now() - 2 * 3600_000).toISOString(), last_sync_status: 'synced',
    sections: { profile: 'up_to_date', hours: 'up_to_date', booking_link: 'up_to_date', services_waiting: 2 },
    changes: [{ key: 'service:s1', kind: 'service', label: 'Silk press' }, { key: 'service:s3', kind: 'service_new', label: 'Trim & treatment' }],
  };
  const calls = await functionCalls(page, 'google-business-sync', (action) => (action === 'push' ? { sent: 1, synced: true } : listing));
  await page.route('**/rest/v1/mova_services?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify([{ id: 's1', name: 'Silk press', base_price_minor: 15000, status: 'active' }, { id: 's3', name: 'Trim & treatment', base_price_minor: 6500, status: 'active' }]) }));
  await page.route('**/rest/v1/mova_artist_profiles?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify({ display_name: 'Ari Monroe Hair' }) }));
  await page.goto('/BID-1/settings/google/listing');

  await expect(page.getByText('2 changes waiting.')).toBeVisible();
  await expect(page.getByText('New service: Trim & treatment')).toBeVisible();
  await expect(page.getByText('New', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Send 2 changes to Google' }).click();
  await expect(page.getByText('Sent to Google.')).toBeVisible();
  expect(calls).toContainEqual({ action: 'push' });
});

test('TC-GOOGLE-38E-01 replies to a Google review from the Reputation screen', async ({ page }) => {
  await openOperatorPage(page, '/');
  const replies = await functionCalls(page, 'review-management', (action) => (action === 'reply_google' ? { saved: true, reply_status: 'posted' } : {
    reviews: [], settings: { ask_after_visit: false, google_review_url: null }, email_delivery_enabled: false,
    google_reviews: [{ id: 'g1', rating: 5, body: 'Beautiful work.', display_name: 'Kim T.', provider_created_at: '2026-11-03T12:00:00Z', reply_body: null, reply_status: 'none' }],
    summary: { count: 1, average: 5, awaiting_reply: 1, stars: { '5': 1, '4': 0, '3': 0, '2': 0, '1': 0 }, mova_count: 0, mova_average: null, google_count: 1, google_average: 5 },
  }));
  await functionCalls(page, 'calendar-google-connect', () => ({ google: connected, settings: { location_ids: [], apple_feed_enabled: true }, locations: [], feedConfigured: false, providerConfigured: true }));
  await page.goto('/BID-1/reports/reputation');

  await expect(page.getByText('Beautiful work.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reply on Google' })).toBeVisible();
  await page.getByRole('button', { name: 'Reply on Google' }).click();
  const reply = page.getByLabel('Your reply');
  await expect(reply).toBeVisible();
  await reply.fill('Thank you, Kim!');
  await page.getByRole('button', { name: 'Post reply to Google' }).click();
  await expect(page.getByText('Your reply is on Google.')).toBeVisible();
  expect(replies).toContainEqual({ action: 'reply_google', review_id: 'g1', reply: 'Thank you, Kim!' });
});
