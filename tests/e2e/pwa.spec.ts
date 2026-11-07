import { expect, test } from '@playwright/test';
import { openOperatorPage } from './operator-session';

test('PWA manifest and service worker are available at the standalone start route', async ({ page }) => {
  await page.goto('/auth');
  await expect(page.getByText('Create your account', { exact: true })).toBeVisible();

  const manifestPath = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestPath).toBeTruthy();
  const manifest = await page.evaluate(async (path) => {
    const response = await fetch(path!);
    return response.json() as Promise<{ start_url: string; display: string; icons: { sizes: string }[] }>;
  }, manifestPath);
  expect(manifest.start_url).toBe('/auth');
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.map((icon) => icon.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));

  await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) throw new Error('Service workers are unavailable');
    await navigator.serviceWorker.ready;
  });

});

test('landing page sign-in and sign-up actions open auth', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Language')).toHaveCount(0);
  await page.getByRole('link', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/auth$/);
  await expect(page.getByText('Create your account', { exact: true })).toBeVisible();
  await page.goto('/');
  await page.getByRole('link', { name: 'Sign up' }).click();
  await expect(page).toHaveURL(/\/auth$/);
});

test('artist locale is selected in Settings without a landing-page selector', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Language')).toHaveCount(0);
  await openOperatorPage(page, '/settings');
  await page.getByRole('button', { name: /Language & notifications/ }).click();
  await expect(page.getByLabel('Language', { exact: true })).toHaveValue('en-US');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
  await page.getByLabel('Language', { exact: true }).selectOption('es-US');
  await openOperatorPage(page, '/settings');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es-US');
});

test('service worker does not put private API responses in CacheStorage', async ({ page }) => {
  await page.goto('/auth');
  await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) throw new Error('Service workers are unavailable');
    await navigator.serviceWorker.ready;
  });

  const cachedUrls = await page.evaluate(async () => {
    const names = await caches.keys();
    const requests = await Promise.all(names.map(async (name) => (await caches.open(name)).keys()));
    return requests.flat().map((request) => new URL(request.url).pathname);
  });

  expect(cachedUrls.length).toBeGreaterThan(0);
  expect(cachedUrls.every((path) => !/^\/(functions|rest|auth|storage|graphql)\/v1\//.test(path))).toBe(true);
});
