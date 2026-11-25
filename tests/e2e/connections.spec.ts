import { expect, test } from '@playwright/test';
import { openOperatorPage } from './operator-session';
import { mockConnections } from './support/connections-mock';

// Connections (CN1–CN8). Every Edge Function call is route-mocked with sample data; nothing reaches a provider.
test('CN1 Settings has one Connections row instead of the Google and calendar rows, and no preview eye', async ({ page }) => {
  await openOperatorPage(page, '/');
  await mockConnections(page);
  await page.goto('/BID-1/settings');
  const menu = page.locator('.mova-settings-menu');
  await expect(menu.getByRole('link', { name: /Connections/ })).toBeVisible();
  await expect(menu.getByText('Calendar sync')).toHaveCount(0);
  await expect(menu.getByText(/Reviews & Google profile/)).toHaveCount(0);
  await expect(menu.getByText(/Google · profile & calendar/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Preview profile' })).toHaveCount(0);
  await expect(menu.getByRole('link', { name: /Connections/ })).toContainText('3 of 5 on');
});

test('CN2 the hub shows each connection with its logo, name and status only', async ({ page }) => {
  await openOperatorPage(page, '/');
  await mockConnections(page);
  await page.goto('/BID-1/settings/connections');
  await expect(page.getByRole('heading', { name: 'Connections' })).toBeVisible();
  for (const [name, status] of [['Stripe', 'Active'], ['Google', 'Connected'], ['Meta', 'Not connected'], ['Google Calendar', 'On'], ['Apple Calendar', 'Not set up']]) {
    await expect(page.getByRole('link', { name: `${name}, ${status}`, exact: true })).toBeVisible();
  }
  await expect(page.getByText('ari.monroe@gmail.com')).toHaveCount(0);
});

test('CN3 Stripe shows payouts and saves the deposit switch', async ({ page }) => {
  await openOperatorPage(page, '/');
  const calls = await mockConnections(page);
  await page.goto('/BID-1/settings/connections/stripe');
  await expect(page.getByRole('heading', { name: 'Stripe', level: 1 })).toBeVisible();
  await expect(page.getByTestId('payout-bank')).toHaveText('Bank •••• 4821');
  await expect(page.getByText('$412.80')).toBeVisible();
  await page.getByRole('switch', { name: /Ask for deposits/ }).click({ force: true });
  await expect.poll(() => calls.find((call) => call.body.action === 'save-card-switches')?.body).toEqual({ action: 'save-card-switches', deposits_enabled: false });
  await page.getByRole('button', { name: 'Disconnect Stripe' }).click();
  await expect(page.getByRole('dialog')).toContainText('Disconnecting stops card payments');
});

test('CN4 Google has a Google reviews switch and new-review alerts', async ({ page }) => {
  await openOperatorPage(page, '/');
  const calls = await mockConnections(page);
  await page.goto('/BID-1/settings/connections/google');
  await expect(page.getByRole('heading', { name: 'Google reviews' })).toBeVisible();
  await expect(page.getByText('14 · 4.9 average')).toBeVisible();
  await page.getByRole('switch', { name: 'Use Google reviews' }).click({ force: true });
  await expect.poll(() => calls.find((call) => call.body.action === 'set_google_import')?.body).toEqual({ action: 'set_google_import', enabled: false });
  await page.getByRole('switch', { name: /Tell me about new reviews/ }).click({ force: true });
  await expect.poll(() => calls.find((call) => call.body.action === 'preferences')?.body).toEqual({ action: 'preferences', preferences: { events: { new_google_review: { email: false, push: false } } } });
});

test('CN5 Meta explains what is needed and stays unclickable until Meta is switched on', async ({ page }) => {
  await openOperatorPage(page, '/');
  await mockConnections(page, { meta: 'off' });
  await page.goto('/BID-1/settings/connections/meta');
  await expect(page.getByRole('heading', { name: 'Before you connect' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect with Meta' })).toBeDisabled();
  await expect(page.getByText("Connecting Meta isn’t switched on for Mova yet.")).toBeVisible();
});

test('CN5b connected Meta switches Concierge per channel', async ({ page }) => {
  await openOperatorPage(page, '/');
  const calls = await mockConnections(page, { meta: 'connected' });
  await page.goto('/BID-1/settings/connections/meta');
  await expect(page.getByText('@samplehair').first()).toBeVisible();
  await page.getByRole('switch', { name: /Answer Facebook messages/ }).click({ force: true });
  await expect.poll(() => calls.find((call) => call.body.action === 'set-channel')?.body).toEqual({ action: 'set-channel', channel: 'messenger', enabled: true });
});

test('CN6 and CN7 calendars: Google Calendar settings and the Apple link', async ({ page }) => {
  await openOperatorPage(page, '/');
  await mockConnections(page);
  await page.goto('/BID-1/settings/connections/google-calendar');
  await expect(page.getByText('Studio 9 Suites')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop calendar sync' })).toBeVisible();
  await page.goto('/BID-1/settings/connections/apple-calendar');
  await expect(page.getByRole('button', { name: 'Add to Apple Calendar' })).toBeVisible();
  await expect(page.locator('.mova-conn-split__detail').getByText('Not set up')).toBeVisible();
});

test('old Settings addresses forward to Connections and keep their query', async ({ page }) => {
  await openOperatorPage(page, '/');
  await mockConnections(page);
  await page.goto('/BID-1/settings/google?google=connected');
  await expect(page).toHaveURL(/\/BID-1\/settings\/connections\/google\?google=connected$/);
  await expect(page.getByText('Google connected.')).toBeVisible();
  await page.goto('/BID-1/settings/calendar-sync');
  await expect(page).toHaveURL(/\/BID-1\/settings\/connections$/);
});
