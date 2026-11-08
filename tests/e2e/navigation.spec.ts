import { expect, test } from '@playwright/test';
import { openOperatorPage } from './operator-session';

test('operator navigation uses the BID routes and exposes five labelled tabs', async ({ page }) => {
  await openOperatorPage(page, '/');
  const navigation = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(navigation.getByRole('button')).toHaveText(['Home', 'Calendar', 'Clients', 'AI Revenue', 'Reports']);
  await expect(navigation.locator('[aria-current="page"]')).toHaveCount(1);
  for (const [label, path] of [['Calendar', 'calendar'], ['Clients', 'clients'], ['AI Revenue', 'growth'], ['Reports', 'reports'], ['Home', '']] as const) {
    await navigation.getByRole('button', { name: label }).click();
    await expect(page).toHaveURL(new RegExp(`/BID-1/${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?$`));
    await expect(navigation.locator('[aria-current="page"]')).toHaveCount(1);
  }
});

test('Home Needs you includes quote requests and open slots awaiting approval', async ({ page }) => {
  await openOperatorPage(page, '/');
  const needs = page.locator('.mova-home__needs-list');
  await expect(needs.getByRole('link', { name: /Quote request.*Protective style/ })).toHaveAttribute('href', '/BID-1/growth/concierge/e2500000-0000-4000-8000-000000000031');
  await expect(needs.getByRole('link', { name: /Open slot needs approval/ })).toHaveAttribute('href', '/BID-1/growth/slots');
  await expect(page.getByText('Needs you · 2', { exact: true })).toBeVisible();
});

test('quote request opens its scoped detail and saves an internal estimate without sending', async ({ page }) => {
  await openOperatorPage(page, '/growth/concierge/e2500000-0000-4000-8000-000000000031');
  await page.getByRole('link', { name: 'Review quote' }).click();
  await expect(page).toHaveURL(/\/BID-1\/growth\/concierge\/quotes\/e2500000-0000-4000-8000-000000000030$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Quote request · Alex Rivera · Protective style' })).toBeVisible();
  await expect(page.getByText('Low-tension protective style', { exact: true })).toBeVisible();
  await expect(page.getByText('No photos were attached to this request.')).toBeVisible();
  await page.getByRole('spinbutton', { name: 'Estimate amount (USD)' }).fill('175');
  await page.getByRole('button', { name: 'Save estimate' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Estimate saved. No message was sent.' })).toBeVisible();
});

test('language selection lives in Settings and Settings matches its menu structure', async ({ page }) => {
  await openOperatorPage(page, '/');
  await expect(page.getByRole('combobox', { name: 'Language' })).toHaveCount(0);
  await openOperatorPage(page, '/settings');
  await expect(page.getByText('Settings', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Language & notifications/ })).toHaveCount(1);
  await expect(page.getByText('Notifications', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /Language & notifications/ }).click();
  const language = page.getByRole('combobox', { name: 'Language' });
  await expect(language).toHaveValue('en-US');
  await language.selectOption('es-US');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es-US');
  await expect(page.getByText('Configuración', { exact: true })).toBeVisible();
});

test('payment settings is reachable from Settings and Money is reachable from Reports', async ({ page }) => {
  await openOperatorPage(page, '/settings');
  await page.getByRole('link', { name: 'Payments & payouts' }).click();
  await expect(page).toHaveURL(/\/BID-1\/settings\/payments$/);
  await expect(page.getByRole('heading', { level: 1, name: 'How you get paid' })).toBeVisible();

  await openOperatorPage(page, '/reports');
  await page.getByRole('link', { name: 'Open Money' }).click();
  await expect(page).toHaveURL(/\/BID-1\/money$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Money' })).toBeVisible();
});

test('running-late sheet identifies the same-day appointment receiving the queued update', async ({ page }) => {
  await openOperatorPage(page, '/appointments/AID-1');
  await page.getByRole('button', { name: 'Running late' }).click();
  await expect(page.getByRole('dialog')).toContainText('Next client: Taylor Morgan');
  await expect(page.getByRole('dialog')).toContainText('Protective style');
  await expect(page.getByRole('dialog')).toContainText('Luxe Salon');
  await page.getByRole('button', { name: '15 min' }).click();
  const queued = page.waitForRequest(request => request.url().endsWith('/functions/v1/running-late-send'));
  await page.getByRole('button', { name: 'Queue update' }).click();
  const request = await queued;
  expect(request.postDataJSON()).toMatchObject({ appointment_id: 'e2500000-0000-4000-8000-000000000061', minutes: 15, offer_new_time: false });
  await expect(page.getByText('The transactional message is queued. The salon is not notified.', { exact: true })).toBeVisible();
});

test('operator tab shell has no horizontal overflow from 320 to 430 px', async ({ page }) => {
  await openOperatorPage(page, '/');
  for (const width of [320, 360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('component gallery stays unavailable in a production build', async ({ page }) => {
  await openOperatorPage(page, '/components');
  await expect(page).toHaveURL(/\/BID-1\/?$/);
  await expect(page.getByRole('heading', { name: 'Component gallery' })).toHaveCount(0);
});
