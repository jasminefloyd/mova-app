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

  await page.goto('/a/nia-flores?locale=es-US');
  await expect(page.getByRole('heading', { level: 1, name: 'Nia Flores' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
  await expect(page.locator('.mova-public-locale-toggle')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Services' }).click();
  await expect(page.getByText('Color refresh')).toBeVisible();

  await page.goto('/a/nia-flores/book');
  await expect(page.getByText('Nia Flores')).toBeVisible();
  await expect.poll(() => edgeCalls.filter(path => path === '/functions/v1/availability-search').length).toBeGreaterThan(0);

  await page.goto('/s/nia-flores');
  const scanHero = page.getByRole('region', { name: 'Nia Flores' });
  await expect(scanHero.getByRole('heading', { level: 1, name: 'Nia Flores' })).toBeVisible();
  await expect(scanHero.getByText(artist.locations[0].name)).toBeVisible();
  const saveCard = page.getByRole('region', { name: 'Save Nia’s card to your phone' });
  await expect(saveCard.getByRole('link', { name: 'Add Nia to My stylists' })).toHaveAttribute('href', /\/signin\?/);
  await expect(page.getByText(/Apple Wallet|Google Wallet/)).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Book with Nia' })).toHaveAttribute('href', '/a/nia-flores/book');
  await expect(page.getByRole('link', { name: 'See Nia’s looks & services' })).toHaveAttribute('href', '/a/nia-flores');
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }
  expect(edgeCalls).toContain('/functions/v1/public-artist');
  await expect.poll(() => edgeCalls.includes('/functions/v1/scan-landing')).toBe(true);

  await page.goto(`/c/${'x'.repeat(43)}`);
  await expect(page.locator('main').first()).toBeVisible();
  expect(edgeCalls).toContain('/functions/v1/client-card-landing');
  expect(directTenantReads).toEqual([]);
});

test('TC-F04-DEP-02/TC-F04-DEP-04 deposit-only services show a locked action and never expose online times', async ({ page }) => {
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
  await expect(page.getByRole('button', { name: 'Book (online booking unavailable)', exact: true })).toBeDisabled();
  await expect(page.getByText('Online booking is unavailable for this service', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Book with/ })).toHaveCount(0);

  await page.goto('/a/deposit-demo/book?service_id=service-hydration');
  await expect(page.getByText('Online booking is unavailable for this service', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: /\d{1,2}:\d{2}/ })).toHaveCount(0);
  expect(calls).toEqual([]);
});

test('booking a public look preselects all linked services and keeps compact deposit details', async ({ page }) => {
  const availabilityRequests: { location_id: string; service_ids: string[] }[] = [];
  const artist = artists['look-demo'];
  await page.route('**/functions/v1/public-artist', route => route.fulfill({
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' },
    json: { data: { ...artist, profile: { ...artist.profile, display_name: 'Rooted Beauty' } } },
  }));
  const slots = Array.from({ length: 8 }, (_, index) => {
    const start = Date.UTC(2026, 11, 1, 15, 15 * index);
    return {
      starts_at: new Date(start).toISOString(), ends_at: new Date(start + 105 * 60_000).toISOString(),
      local_date: '2026-12-01', local_time: '', utc_offset: '-05:00',
      time_zone: 'America/New_York', booking_mode: 'request',
    };
  });
  await page.route('**/functions/v1/availability-search', async route => {
    if (route.request().method() === 'POST') {
      const { location_id, service_ids } = route.request().postDataJSON();
      availabilityRequests.push({ location_id, service_ids });
    }
    await route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' },
      json: { data: { groups: [{ slots }], days: [{ date: '2026-12-01', open_count: slots.length }] } } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => sessionStorage.setItem('mova_booking_draft_look-demo', JSON.stringify({
    serviceIds: ['service-style'], day: '', slot: null, locationId: '', alternateStartsAt: '',
  })));
  await page.goto('/a/look-demo');
  await expect(page.getByRole('img', { name: 'Mova' })).toBeVisible();
  await expect(page.getByText('Cover photo', { exact: true })).toHaveCount(0);
  const cover = await page.locator('.mova-public-artist__hero').boundingBox();
  const credit = await page.getByRole('link', { name: 'Sample Photographer' }).boundingBox();
  expect(credit!.y).toBeGreaterThanOrEqual(cover!.y + cover!.height);
  expect(credit!.x).toBeGreaterThan(cover!.x + cover!.width / 2);

  const firstLook = page.locator('.mova-look-card').filter({ hasText: 'Dimensional color' });
  await expect(firstLook.getByRole('button')).toHaveCount(1);
  await expect(page.getByText('Portfolio photo', { exact: true })).toHaveCount(0);
  const lookPhoto = await firstLook.getByRole('img').boundingBox();
  const lookCaption = await firstLook.getByText('Dimensional color', { exact: true }).boundingBox();
  expect(lookCaption!.y).toBeGreaterThanOrEqual(lookPhoto!.y + lookPhoto!.height);
  const lockedLook = page.locator('.mova-look-card').filter({ hasText: 'Hydrated natural curls' }).getByRole('button');
  await expect(lockedLook).toBeDisabled();
  expect((await lockedLook.locator('.mova-icon').boundingBox())?.width).toBe(18);
  await expect(page.locator('.mova-look-card').filter({ hasText: 'Color and hydration' }).getByRole('button')).toBeDisabled();
  await firstLook.getByRole('button', { name: 'Book this look' }).click();
  await expect(page).toHaveURL(/\/book\?/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const heading = page.getByRole('heading', { name: 'Book with Rooted Beauty', exact: true });
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(heading).toHaveCSS('white-space', 'nowrap');
    await page.evaluate(() => document.fonts.ready);
    const dimensions = await heading.evaluate(element => ({
      textWidth: element.scrollWidth, availableWidth: element.clientWidth,
    }));
    expect(dimensions.textWidth, `The entire title fits at ${width}px`).toBeLessThanOrEqual(dimensions.availableWidth);
  }
  await expect(page.locator('.mova-public-locale-toggle')).toHaveCount(0);
  const query = new URL(page.url()).searchParams;
  expect(query.get('service_ids')?.split(',')).toEqual(['service-color', 'service-style']);
  expect(query.get('portfolio_item_id')).toBe('look-color');
  const summary = page.locator('.mova-booking__service');
  await expect(summary.getByRole('listitem')).toHaveText(['Color refresh', 'Style and finish']);
  await expect(summary.getByText('1 hr 45 min')).toBeVisible();
  await expect(summary.getByText('$150.00')).toBeVisible();
  await expect.poll(() => availabilityRequests).toEqual([
    { location_id: 'location-salon', service_ids: ['service-color', 'service-style'] },
  ]);

  const times = page.getByRole('group', { name: 'Rooted Beauty Salon' });
  await expect(times.getByRole('button')).toHaveCount(6);
  await expect(page.getByRole('button', { name: 'Continue' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Show more times' }).click();
  await expect(times.getByRole('button')).toHaveCount(8);
  await times.getByRole('button', { name: '11:45 AM', exact: true }).click();
  const sticky = page.locator('.mova-booking__sticky');
  await expect(sticky).toContainText('Dec 1');
  await expect(sticky).toContainText('11:45 AM');
  await expect(sticky).toContainText('Rooted Beauty Salon · Stylist confirmation required');
  await page.getByRole('button', { name: 'Show fewer times' }).click();
  await expect(times.getByRole('button')).toHaveCount(6);
  await expect(times.getByRole('button', { name: '11:45 AM' })).toHaveAttribute('aria-pressed', 'true');

  await sticky.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('button', { name: 'Request booking' })).toBeVisible();
  await expect(summary.getByText('No deposit')).toBeVisible();
  await summary.getByRole('button', { name: 'Change' }).click();

  const add = summary.getByRole('combobox', { name: 'Add a service' });
  await expect(add.getByRole('option', { name: /Style and finish/ })).toHaveCount(0);
  await summary.getByRole('button', { name: 'Remove Style and finish' }).click();
  await expect(add).toBeFocused();
  await expect(summary.getByRole('listitem')).toHaveText(['Color refresh']);
  await expect(summary.getByText('1 hr')).toBeVisible();
  await expect(summary.getByText('$90.00')).toBeVisible();
  await expect(sticky).toHaveCount(0);
  await expect.poll(() => availabilityRequests.at(-1)?.service_ids).toEqual(['service-color']);

  await summary.getByRole('button', { name: 'Remove Color refresh' }).click();
  await expect(summary.getByText('Add a service to see available times.')).toBeVisible();
  await expect(times).toHaveCount(0);
  await add.selectOption('service-style');
  await expect(summary.getByRole('listitem')).toHaveText(['Style and finish']);
  await add.selectOption('service-color');
  await expect(summary.getByRole('listitem')).toHaveText(['Style and finish', 'Color refresh']);
  await expect(summary.getByText('$150.00')).toBeVisible();
  await expect.poll(() => availabilityRequests.at(-1)?.service_ids).toEqual(['service-style', 'service-color']);

  await page.goto('/a/look-demo?tab=services');
  const mixed = page.getByRole('listitem').filter({ hasText: 'Color refresh' });
  await expect(mixed.getByText('Rooted Beauty Salon', { exact: true })).toHaveCount(1);
  await expect(mixed.getByText('$25.00 deposit', { exact: true })).toBeVisible();
  await expect(mixed.getByRole('button', { name: 'Book', exact: true })).toBeEnabled();
  const same = page.getByRole('listitem').filter({ hasText: 'Style and finish' });
  await expect(same.getByText('No deposit', { exact: true })).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
