import { expect, test } from '@playwright/test';
import { openOperatorPage } from './operator-session';

test('PWA manifest and service worker are available at the standalone start route', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeVisible();

  const manifestPath = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestPath).toBeTruthy();
  const manifest = await page.evaluate(async (path) => {
    const response = await fetch(path!);
    return response.json() as Promise<{ start_url: string; display: string; icons: { sizes: string }[] }>;
  }, manifestPath);
  expect(manifest.start_url).toBe('/login');
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.map((icon) => icon.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));

  await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) throw new Error('Service workers are unavailable');
    await navigator.serviceWorker.ready;
  });

});

test('landing page sign-in and sign-up actions open the stylist pages', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Sign in' }).first().click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeVisible();
  await page.goto('/');
  await page.getByRole('link', { name: /Start free|Sign up/ }).first().click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Create your account' })).toBeVisible();
});

test('the temporary home page has no waitlist form', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Email', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Join the waitlist')).toHaveCount(0);
});

test('artist locale is selected in Settings without a landing-page selector', async ({ page }) => {
  await page.goto('/');
  await openOperatorPage(page, '/settings');
  await page.getByRole('button', { name: /Language & notifications/ }).click();
  await expect(page.getByLabel('Language', { exact: true })).toHaveValue('en-US');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
  await page.getByLabel('Language', { exact: true }).selectOption('es-US');
  await openOperatorPage(page, '/settings');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es-US');
});

test('public guest locale persists across pages and explicit URL locale takes precedence', async ({ page }) => {
  const artist = {
    profile: { display_name: 'Nia Flores', handle: 'nia-flores', specialties: ['Color'], bio: '', photo_urls: {} },
    services: [], locations: [], looks: [], bookable: false,
  };
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  await page.addInitScript(() => {
    if (localStorage.getItem('mova_guest_locale') === null) localStorage.setItem('mova_guest_locale', 'en-US');
  });
  await page.route('**/functions/v1/public-artist', route => route.fulfill({
    status: 200, contentType: 'application/json', headers: cors,
    body: JSON.stringify({ data: artist, error: null, request_id: 'public-locale-fixture' }),
  }));
  await page.route('**/functions/v1/scan-landing', route => route.fulfill({
    status: 200, contentType: 'application/json', headers: cors,
    body: JSON.stringify({ data: { recorded: true }, error: null, request_id: 'scan-locale-fixture' }),
  }));

  await page.goto('/s/nia-flores');
  await expect(page.getByRole('heading', { level: 1, name: 'Nia Flores' })).toBeVisible();
  await page.getByRole('button', { name: 'ES', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es-US');
  await expect(page.getByRole('button', { name: 'ES', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/\?locale=es-US$/);
  await expect(page.getByRole('button', { name: 'Reservar con Nia' })).toBeVisible();

  await page.goto('/s/nia-flores');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es-US');
  await expect(page.getByRole('button', { name: 'Reservar con Nia' })).toBeVisible();

  await page.goto('/s/nia-flores?locale=en-US');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
  await expect(page.getByRole('button', { name: 'Book with Nia' })).toBeVisible();
});

test('service worker does not put private API responses in CacheStorage', async ({ page }) => {
  await page.goto('/login');
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
