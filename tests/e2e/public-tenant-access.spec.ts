import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

// Same fixtures the SSR mock (tests/e2e/support/mock-edge.mjs) serves, so server and browser agree.
const artists = JSON.parse(readFileSync(join(__dirname, 'support', 'public-artists.json'), 'utf8'));

test('TC-RLS-TENANTCFG-ANON signed-out showcase, booking and QR use public Edge endpoints without tenant REST reads', async ({ page }) => {
  const directTenantReads: string[] = [];
  const edgeCalls: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/rest/v1/mova_')) directTenantReads.push(url.pathname);
    if (url.pathname.startsWith('/functions/v1/')) edgeCalls.push(url.pathname);
  });
  const artist = artists['nia-flores'];
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  await page.route('**/functions/v1/public-artist', async route => {
    edgeCalls.push(new URL(route.request().url()).pathname);
    await route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ data: artist, error: null, request_id: 'public-tenant-fixture' }) });
  });
  await page.route('**/functions/v1/availability-search', async route => {
    edgeCalls.push(new URL(route.request().url()).pathname);
    await route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ data: { groups: [{ location_id: 'location-studio', slots: [] }] }, error: null, request_id: 'availability-fixture' }) });
  });
  await page.route('**/functions/v1/scan-landing', async route => {
    edgeCalls.push(new URL(route.request().url()).pathname);
    await route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ data: { recorded: true }, error: null, request_id: 'scan-fixture' }) });
  });
  await page.route('**/functions/v1/client-card-landing', async route => {
    edgeCalls.push(new URL(route.request().url()).pathname);
    await route.fulfill({ status: 404, contentType: 'application/json', headers: cors, body: JSON.stringify({ data: null, error: { code: 'CLIENT_PROFILES_DISABLED' }, request_id: 'client-card-fixture' }) });
  });

  await page.goto('/a/nia-flores');
  await expect(page.getByRole('heading', { level: 1, name: 'Nia Flores' })).toBeVisible();
  await page.getByRole('tab', { name: 'Services' }).click();
  await expect(page.getByText('Color refresh')).toBeVisible();

  await page.goto('/a/nia-flores/book');
  await expect(page.getByText('Nia Flores')).toBeVisible();
  await expect.poll(() => edgeCalls.filter(path => path === '/functions/v1/availability-search').length).toBeGreaterThan(0);

  await page.goto('/s/nia-flores');
  await expect(page.getByRole('heading', { level: 1, name: 'Nia Flores' })).toBeVisible();
  expect(edgeCalls).toContain('/functions/v1/public-artist');
  expect(edgeCalls).toContain('/functions/v1/scan-landing');

  await page.goto(`/c/${'x'.repeat(43)}`);
  await expect(page.locator('main').first()).toBeVisible();
  expect(edgeCalls).toContain('/functions/v1/client-card-landing');
  expect(directTenantReads).toEqual([]);
});

test('TC-F04-DEP-02/TC-F04-DEP-04 deposit services never expose online times or a Book action', async ({ page }) => {
  const calls: string[] = [];
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  const artist = artists['deposit-demo'];
  await page.route('**/functions/v1/public-artist', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ data: artist, error: null, request_id: 'deposit-fixture' }) });
  });
  await page.route('**/functions/v1/availability-search', async route => {
    calls.push(new URL(route.request().url()).pathname);
    await route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ data: { groups: [{ location_id: 'location-studio', slots: [] }], days: [] }, error: null, request_id: 'deposit-availability' }) });
  });

  await page.goto('/a/deposit-demo?tab=services');
  await expect(page.getByText('Hydration Treatment')).toBeVisible();
  await expect(page.getByText('Online booking is unavailable for this service', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: /Book with/ })).toHaveCount(0);

  await page.goto('/a/deposit-demo/book?service_id=service-hydration');
  await expect(page.getByText('Online booking is unavailable for this service', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: /\d{1,2}:\d{2}/ })).toHaveCount(0);
  expect(calls).toEqual([]);
});
