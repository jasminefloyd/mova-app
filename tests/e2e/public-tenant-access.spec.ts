import { expect, test } from '@playwright/test';

test('TC-RLS-TENANTCFG-ANON signed-out showcase, booking and QR use public Edge endpoints without tenant REST reads', async ({ page }) => {
  const directTenantReads: string[] = [];
  const edgeCalls: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/rest/v1/mova_')) directTenantReads.push(url.pathname);
    if (url.pathname.startsWith('/functions/v1/')) edgeCalls.push(url.pathname);
  });
  const artist = {
    profile: { display_name: 'Nia Flores', handle: 'nia-flores', specialties: ['Color'], bio: 'Color specialist', preferred_locale: 'en-US', search_index_enabled: true, photo_urls: {} },
    services: [{ id: 'service-color', name: 'Color refresh', category: 'Color', duration_minutes: 60, base_price_minor: 9000, deposit_type: 'none', deposit_value: 0, location_deposits: [] }],
    looks: [],
    locations: [{ id: 'location-studio', name: 'Rooted Beauty', booking_mode: 'request', time_zone: 'America/New_York' }],
    bookable: true,
  };
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
  await expect(page.locator('main')).toBeVisible();
  expect(edgeCalls).toContain('/functions/v1/client-card-landing');
  expect(directTenantReads).toEqual([]);
});

test('TC-F04-DEP-02/TC-F04-DEP-04 deposit services never expose online times or a Book action', async ({ page }) => {
  const calls: string[] = [];
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  const artist = {
    profile: { display_name: 'Nia Flores', handle: 'nia-flores', specialties: ['Color'], bio: 'Color specialist', preferred_locale: 'en-US', search_index_enabled: true, photo_urls: {} },
    services: [{ id: 'service-hydration', name: 'Hydration Treatment', category: 'Treatment', duration_minutes: 45, base_price_minor: 8500, deposit_type: 'fixed', deposit_value: 2500, location_deposits: [{ location_id: 'location-studio', price_minor: 8500, duration_minutes: 45, deposit_amount_minor: 2500 }] }],
    looks: [], locations: [{ id: 'location-studio', name: 'Rooted Beauty Studio', booking_mode: 'instant', time_zone: 'America/New_York' }], bookable: true,
  };
  await page.route('**/functions/v1/public-artist', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ data: artist, error: null, request_id: 'deposit-fixture' }) });
  });
  await page.route('**/functions/v1/availability-search', async route => {
    calls.push(new URL(route.request().url()).pathname);
    await route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ data: { groups: [{ location_id: 'location-studio', slots: [] }], days: [] }, error: null, request_id: 'deposit-availability' }) });
  });

  await page.goto('/a/nia-flores?tab=services');
  await expect(page.getByText('Hydration Treatment')).toBeVisible();
  await expect(page.getByText('Online booking is unavailable for this service', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: /Book with/ })).toHaveCount(0);

  await page.goto('/a/nia-flores/book?service_id=service-hydration');
  await expect(page.getByText('Online booking is unavailable for this service', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: /\d{1,2}:\d{2}/ })).toHaveCount(0);
  expect(calls).toEqual([]);
});
