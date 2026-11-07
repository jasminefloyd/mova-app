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

test('Money is reachable from both Settings and Reports', async ({ page }) => {
  await openOperatorPage(page, '/settings');
  await page.getByRole('link', { name: 'Payments & payouts' }).click();
  await expect(page).toHaveURL(/\/BID-1\/money$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Money' })).toBeVisible();

  await openOperatorPage(page, '/reports');
  await page.getByRole('link', { name: 'Open Money' }).click();
  await expect(page).toHaveURL(/\/BID-1\/money$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Money' })).toBeVisible();
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
