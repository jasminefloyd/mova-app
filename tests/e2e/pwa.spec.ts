import { expect, test } from '@playwright/test';

test('PWA manifest and service worker are available at the standalone start route', async ({ page }) => {
  await page.goto('/app/home');
  await expect(page.getByText('mova.', { exact: true })).toBeVisible();

  const manifestPath = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestPath).toBeTruthy();
  const manifest = await page.evaluate(async (path) => {
    const response = await fetch(path!);
    return response.json() as Promise<{ start_url: string; display: string; icons: { sizes: string }[] }>;
  }, manifestPath);
  expect(manifest.start_url).toBe('/app/home');
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.map((icon) => icon.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));

  await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) throw new Error('Service workers are unavailable');
    await navigator.serviceWorker.ready;
  });

});

test('guest locale can be switched before sign-in and persists after reload', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Language').selectOption('es-US');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es-US');
  await page.reload();
  await expect(page.getByLabel('Idioma')).toHaveValue('es-US');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es-US');
});

test('artist and guest locale storage remain independent', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Language').selectOption('es-US');
  await page.goto('/app/home');
  await expect(page.getByLabel('Language')).toHaveValue('en-US');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
  await page.goto('/');
  await expect(page.getByLabel('Idioma')).toHaveValue('es-US');
});

test('service worker does not put private API responses in CacheStorage', async ({ page }) => {
  await page.goto('/app/home');
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
