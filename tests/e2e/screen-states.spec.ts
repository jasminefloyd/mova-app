import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { openOperatorPage } from './operator-session';

// Task 2.6: forced loading-failure and offline states, one check per screen family.
const artists = JSON.parse(readFileSync(join(__dirname, 'support', 'public-artists.json'), 'utf8'));
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-mova-artist-business-id', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };

test('TC-STATE-OFFLINE-01 operator screens announce when the device goes offline', async ({ page, context }) => {
  await openOperatorPage(page, '/');
  const notice = page.getByRole('status').filter({ hasText: 'You appear to be offline.' });
  await expect(notice).toHaveCount(0);
  await context.setOffline(true);
  await expect(notice).toBeVisible();
  await context.setOffline(false);
  await expect(notice).toHaveCount(0);
});

test('TC-STATE-ERROR-01 Money shows a retryable error when payments fail to load', async ({ page }) => {
  await openOperatorPage(page, '/money');
  await page.route('**/functions/v1/money-summary', (route) => route.fulfill({ status: 503, contentType: 'application/json', headers: cors, body: JSON.stringify({ data: { code: 'UNAVAILABLE' }, error: null }) }));
  await page.reload();
  await expect(page.getByText("We couldn't load payment information.")).toBeVisible();
  await page.unroute('**/functions/v1/money-summary');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText("We couldn't load payment information.")).toHaveCount(0);
});

test('TC-STATE-ERROR-02 public booking shows an error when times fail to load', async ({ page }) => {
  await page.route('**/functions/v1/public-artist', (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ data: artists['nia-flores'], error: null }) }));
  await page.route('**/functions/v1/availability-search', (route) => route.fulfill({ status: 503, contentType: 'application/json', headers: cors, body: JSON.stringify({ data: { code: 'AVAILABILITY_UNAVAILABLE' }, error: null }) }));
  await page.goto('/a/nia-flores/book');
  await expect(page.getByText("We couldn't load booking times. Try again.")).toBeVisible();
});
