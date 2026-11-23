import { expect, test, type Route } from '@playwright/test';

const businessId = 'e2500000-0000-4000-8000-000000000001';
const locationId = 'e2500000-0000-4000-8000-000000000050';
const serviceId = 'e2500000-0000-4000-8000-000000000301';
const userId = 'e2500000-0000-4000-8000-000000000777';
const projectRef = new URL(process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321').hostname.split('.')[0] ?? '127';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-mova-artist-business-id, prefer, accept-profile, content-profile',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': 'Content-Range',
  'Content-Range': '0-0/1',
};

test('new stylist completes onboarding: profile, photo, where you work, what you offer, how you get paid, welcome', async ({ page }) => {
  const user = { id: userId, aud: 'authenticated', role: 'authenticated', email: 'hello+qatest3@move-beauty.co', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: { first_name: 'Ari', last_name: 'Monroe' }, created_at: '2026-01-01T00:00:00.000Z' };
  const session = { access_token: 'onboarding-test-token', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'onboarding-test-refresh', user };
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: `sb-${projectRef}-auth-token`, value: session });

  let claimed = false;
  let profile = { display_name: '', handle: '', bio: '', specialties: [] as string[], preferred_locale: 'en-US', search_index_enabled: true };
  let progress = { current_step: 'profile', completed_steps: [] as string[], form_data: {} as Record<string, unknown> };
  const services: Array<Record<string, unknown>> = [];
  const locations: Array<Record<string, unknown>> = [];
  const writes: Array<{ name: string; body: unknown }> = [];

  await page.route('**/auth/v1/**', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(route.request().url().endsWith('/user') ? user : { user, session }) });
  });
  await page.route('**/rest/v1/**', async (route: Route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const url = new URL(route.request().url());
    const table = url.pathname.split('/').pop() ?? '';
    const method = route.request().method();
    const accept = route.request().headers().accept ?? '';
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });

    if (table === 'mova_check_artist_handle') return json([{ available: true, reason: null }]);
    if (table === 'mova_claim_artist_profile') {
      claimed = true;
      profile = { display_name: 'Rooted Beauty Test', handle: 'rooted-beauty-qa', bio: 'Healthy hair and protective styles.', specialties: ['Silk press'], preferred_locale: 'en-US', search_index_enabled: true };
      progress = { ...progress, current_step: 'photo', form_data: { ...profile } };
      writes.push({ name: table, body: route.request().postDataJSON() });
      return json([{ artist_business_id: businessId, handle: profile.handle }]);
    }
    if (table === 'mova_update_artist_profile') {
      writes.push({ name: table, body: route.request().postDataJSON() });
      return json(null);
    }
    if (table === 'mova_publish_artist_profile') {
      progress = { ...progress, current_step: 'complete', completed_steps: ['profile', 'photo', 'services', 'location', 'publish'] };
      writes.push({ name: table, body: route.request().postDataJSON() });
      return json([{ handle: profile.handle, published_at: new Date().toISOString() }]);
    }
    if (table === 'mova_artist_memberships') {
      const membership = claimed ? { artist_business_id: businessId, role: 'owner', status: 'active' } : null;
      return json(accept.includes('vnd.pgrst.object') ? membership : membership ? [membership] : []);
    }
    if (table === 'mova_artist_businesses') return json(accept.includes('vnd.pgrst.object') ? { id: businessId, business_number: 1 } : [{ id: businessId, business_number: 1 }]);
    if (table === 'mova_artist_profiles') return json(accept.includes('vnd.pgrst.object') ? (claimed ? profile : null) : claimed ? [profile] : []);
    if (table === 'mova_onboarding_progress') {
      if (method === 'PATCH') {
        const body = route.request().postDataJSON() as typeof progress;
        progress = { ...progress, ...body };
        writes.push({ name: table, body });
        return route.fulfill({ status: 204, headers: cors });
      }
      return json(accept.includes('vnd.pgrst.object') ? (claimed ? progress : null) : claimed ? [progress] : []);
    }
    if (table === 'mova_services') {
      if (method === 'POST') {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        services.push({ ...body, id: serviceId });
        writes.push({ name: table, body });
        return json({ id: serviceId }, 201);
      }
      return json(services);
    }
    if (table === 'mova_locations') {
      if (method === 'HEAD') return route.fulfill({ status: 200, headers: { ...cors, 'Content-Range': `0-0/${locations.length}` } });
      return json(accept.includes('vnd.pgrst.object') ? (locations[0] ?? null) : locations);
    }
    if (table === 'mova_service_locations') return json([]);
    return json(accept.includes('vnd.pgrst.object') ? null : []);
  });
  await page.route('**/functions/v1/**', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const name = new URL(route.request().url()).pathname.split('/').pop();
    if (name === 'location-save') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      writes.push({ name, body });
      locations.push({ id: locationId, name: body.name ?? 'Studio 9 Suites', location_type: body.location_type ?? 'suite', booking_mode: 'instant', payment_collector: 'artist', is_active: true });
      return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ data: { id: locationId }, error: null, request_id: 'onboarding-qa' }) });
    }
    if (name === 'payment-settings') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      if (body.action === 'save') writes.push({ name, body });
      return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ data: { cash_enabled: false, other_enabled: false, salon_locations: [] }, error: null }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ data: {}, error: null, request_id: 'onboarding-qa' }) });
  });

  await page.goto('/onboarding/profile');
  await expect(page.getByRole('heading', { level: 1, name: 'Your artist profile' })).toBeVisible();
  await page.getByLabel('Display name').fill('Rooted Beauty Test');
  await page.getByLabel('Your link').fill('rooted-beauty-qa');
  await page.getByLabel('Add a specialty').fill('Silk press');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const specialtyChip = page.getByRole('button', { name: 'Silk press ×' });
  await expect(specialtyChip).toBeVisible();
  expect(await specialtyChip.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await page.getByLabel('About you').fill('Healthy hair and protective styles.');
  await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Add a profile photo' })).toBeVisible();
  await page.getByRole('button', { name: 'Later' }).click();

  // Step 4 · Where you work: the full Settings location editor, inside onboarding.
  await expect(page).toHaveURL(/\/onboarding\/location$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Where you work' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Type of place' }).selectOption({ label: 'Suite rental' });
  await page.getByLabel('Location name').fill('Studio 9 Suites');
  await page.getByLabel('Address').fill('210 Main St, Suite 4');
  await page.getByRole('button', { name: 'Tuesday' }).click();
  await page.getByLabel('Opens').fill('09:00');
  await page.getByLabel('Closes').fill('17:00');
  await page.getByRole('button', { name: 'Save location' }).click();
  await expect(page.getByText('Studio 9 Suites')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add another location' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  // Step 5 · What you offer: the full Add a service editor with the new location already ticked.
  await expect(page).toHaveURL(/\/onboarding\/services$/);
  await expect(page.getByRole('region', { name: 'What you offer' }).getByRole('heading', { level: 1, name: 'Add service' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Studio 9 Suites/ })).toBeChecked();
  await page.getByLabel('Service name').fill('Silk press');
  await page.getByLabel('Duration', { exact: true }).fill('90');
  await page.getByLabel('Buffer', { exact: true }).fill('15');
  await page.getByLabel('Price', { exact: true }).fill('150');
  await page.getByRole('button', { name: 'Save service' }).click();
  await expect(page.getByRole('button', { name: 'Add another service' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  // Step 6 · How you get paid: at least one way to get paid before finishing.
  await expect(page).toHaveURL(/\/onboarding\/payments$/);
  await expect(page.getByRole('heading', { level: 1, name: 'How you get paid' })).toBeVisible();
  await expect(page.getByText('Zelle')).toHaveCount(0);
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await expect(page.getByText('Turn on at least one way to get paid.')).toBeVisible();
  await page.getByRole('switch', { name: /^Cash/ }).check();
  await page.getByRole('button', { name: 'Finish setup' }).click();

  // Step 7 · Welcome: the page is published, then the next step is Settings.
  await expect(page).toHaveURL(/\/onboarding\/welcome$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Welcome to Mova, Ari' })).toBeVisible({ timeout: 8000 });
  await expect(page.getByRole('link', { name: 'mova-beauty.co/a/rooted-beauty-qa' })).toBeVisible();
  expect(writes.map(({ name }) => name)).toEqual(expect.arrayContaining(['mova_claim_artist_profile', 'location-save', 'mova_services', 'payment-settings', 'mova_publish_artist_profile']));
  await page.getByRole('button', { name: 'Go to Settings' }).click();
  await expect(page).toHaveURL(/\/BID-1\/settings\/?$/);
});
