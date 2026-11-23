import { expect, test } from '@playwright/test';
import { openOperatorPage } from './operator-session';

test('operator navigation uses the BID routes and exposes five labelled tabs', async ({ page }) => {
  await openOperatorPage(page, '/');
  const navigation = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(navigation.getByRole('button')).toHaveText(['Home', 'Calendar', 'Clients', 'Reviews', 'Reports']);
  await expect(navigation.locator('[aria-current="page"]')).toHaveCount(1);
  for (const [label, path] of [['Calendar', 'calendar'], ['Clients', 'clients'], ['Reviews', 'reports/reputation'], ['Reports', 'reports'], ['Home', '']] as const) {
    await navigation.getByRole('button', { name: label }).click();
    await expect(page).toHaveURL(new RegExp(`/BID-1/${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?$`));
    await expect(navigation.locator('[aria-current="page"]')).toHaveCount(1);
  }
});

test('TC-SCR-07-01 Home Needs you loads booking, quote and open-slot requests without failed table reads', async ({ page }) => {
  const failedResponses: string[] = [];
  const directNeedsReads: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
  });
  page.on('request', (request) => {
    if (/\/rest\/v1\/(mova_quote_requests|mova_slot_events)(\?|$)/.test(request.url())) directNeedsReads.push(request.url());
  });
  await openOperatorPage(page, '/');
  const needs = page.locator('.mova-home__needs-list');
  await expect(needs.getByRole('link', { name: /Booking request.*Jordan Lee/ })).toHaveAttribute('href', '/BID-1/appointments/AID-16');
  await expect(needs.getByRole('link', { name: /Quote request.*Protective style/ })).toHaveAttribute('href', '/BID-1/growth/concierge/e2500000-0000-4000-8000-000000000031');
  await expect(needs.getByRole('link', { name: /Open slot needs approval/ })).toHaveAttribute('href', '/BID-1/growth/slots');
  await expect(page.getByText('Needs you · 3', { exact: true })).toBeVisible();
  expect(directNeedsReads).toEqual([]);
  expect(failedResponses).toEqual([]);
});

test('quote request opens its scoped detail and saves an internal estimate without sending', async ({ page }) => {
  await openOperatorPage(page, '/growth/concierge/e2500000-0000-4000-8000-000000000031');
  await page.getByRole('link', { name: 'Review quote' }).click();
  await expect(page).toHaveURL(/\/BID-1\/growth\/concierge\/quotes\/e2500000-0000-4000-8000-000000000030$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Alex Rivera · Protective style' })).toBeVisible();
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
  await expect(page.getByRole('link', { name: /Language & notifications/ })).toHaveCount(1);
  await expect(page.getByText('Notifications', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: /Language & notifications/ }).click();
  await expect(page.getByRole('radio', { name: 'English' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: 'Español' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es-US');
  await expect(page.getByRole('heading', { level: 1, name: 'Idioma y notificaciones' })).toBeVisible();
});

test('payment settings is reachable from Settings and Money is reachable from Reports', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openOperatorPage(page, '/settings');
  await page.getByRole('link', { name: 'Payments & payouts' }).click();
  await expect(page).toHaveURL(/\/BID-1\/settings\/payments$/);
  await expect(page.getByRole('heading', { level: 1, name: 'How you get paid' })).toBeVisible();

  await openOperatorPage(page, '/reports');
  await page.getByRole('link', { name: 'Money', exact: true }).click();
  await expect(page).toHaveURL(/\/BID-1\/money$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Money' })).toBeVisible();
  await expect(page.getByText('Service value', { exact: true })).toBeVisible();
  await expect(page.getByText('Recent activity', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Reports', exact: true }).click();
  await expect(page).toHaveURL(/\/BID-1\/reports$/);
});

test('Settings uses the saved profile photo and current plan in the banner', async ({ page }) => {
  await openOperatorPage(page, '/');
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-mova-artist-business-id',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
  let photoPath: string | null = null;
  let planAvailable = true;
  let imageAvailable = true;
  await page.route('**/rest/v1/mova_artist_profiles?*', (route) => route.fulfill({
    headers,
    json: { display_name: 'Rooted Beauty', handle: 'rooted-beauty', is_published: true, profile_photo_path: photoPath },
  }));
  await page.route('**/functions/v1/plan-management', (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    return route.fulfill(planAvailable
      ? { headers, json: { data: { current_plan: { plan_key: 'ai_growth' }, plans: [] }, error: null } }
      : { status: 503, headers, json: { data: null, error: { code: 'TEMPORARILY_UNAVAILABLE' } } });
  });
  const signedPath = '/object/sign/mova_profile_photos/demo-avatar.png?token=test';
  await page.route('**/storage/v1/object/sign/mova_profile_photos/**', (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (route.request().method() === 'POST') return route.fulfill({ headers, json: { signedURL: signedPath } });
    return imageAvailable
      ? route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMHsAAAAASUVORK5CYII=', 'base64') })
      : route.fulfill({ status: 404 });
  });

  await page.goto('/BID-1/settings');
  const banner = page.locator('.mova-settings-profile');
  const avatar = banner.getByRole('img', { name: 'Rooted Beauty' });
  await expect(banner).toContainText('AI + Growth · Published');
  await expect(avatar).toHaveText('RB');
  await expect(avatar.locator('img')).toHaveCount(0);

  await page.getByRole('link', { name: 'Profile, photo & looks' }).click();
  await expect(page).toHaveURL(/\/settings\/profile$/);
  // The profile photo processor writes this path when a replacement photo is saved.
  photoPath = 'e2500000-0000-4000-8000-000000000001/variants/demo-avatar.png';
  await page.goBack();
  const image = avatar.locator('img');
  await expect(image).toHaveAttribute('src', new RegExp('demo-avatar\\.png'));
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);

  imageAvailable = false;
  planAvailable = false;
  await page.evaluate(() => sessionStorage.removeItem('mova_plan_summary_e2500000-0000-4000-8000-000000000001'));
  await page.reload();
  await expect(page.getByRole('link', { name: /Plan details could not be loaded/ })).toBeVisible();
  await expect(banner).toContainText('Published');
  await expect(banner).not.toContainText('Not configured');
  await expect(avatar).toHaveText('RB');
  await expect(avatar.locator('img')).toHaveCount(0);
});

test('running-late sheet identifies the same-day appointment receiving the queued update', async ({ page }) => {
  await openOperatorPage(page, '/appointments/AID-1', 'BID-1', new Date('2026-11-10T14:00:00.000Z'));
  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByRole('button', { name: /^Running late/ }).click();
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

test('artist can reschedule a confirmed appointment into an available slot immediately', async ({ page }) => {
  await openOperatorPage(page, '/appointments/AID-1', 'BID-1', new Date('2026-11-10T14:00:00.000Z'));
  await page.route('**/functions/v1/availability-search', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { groups: [{ slots: [{ starts_at: '2026-11-11T18:00:00.000Z', local_date: '2026-11-11', local_time: '1:00 PM', utc_offset: 'GMT-5' }] }] }, error: null, request_id: 'reschedule-test' }) });
  });
  const requests: Record<string, unknown>[] = [];
  await page.route('**/functions/v1/booking-transition', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-mova-artist-business-id, idempotency-key', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } });
    requests.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { status: 'confirmed', starts_at: '2026-11-11T18:00:00.000Z' }, error: null, request_id: 'reschedule-test' }) });
  });

  await page.getByRole('button', { name: 'Reschedule' }).click();
  await expect(page.getByRole('dialog')).toContainText('Choose an available time. The appointment updates as soon as you save.');
  await page.getByRole('button', { name: /2026-11-11 · 1:00 PM/ }).click();
  await page.getByRole('button', { name: 'Save new time' }).click();

  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({ appointment_id: 'e2500000-0000-4000-8000-000000000061', artist_reschedule_starts_at: '2026-11-11T18:00:00.000Z' });
  await expect(page.getByRole('dialog')).toHaveCount(0);
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
