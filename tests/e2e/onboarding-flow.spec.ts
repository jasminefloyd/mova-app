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
  'Content-Range': '0-0/1',
};

test('new stylist can complete onboarding through the shared service and location editors', async ({ page }) => {
  const user = { id: userId, aud: 'authenticated', role: 'authenticated', email: 'hello+qatest3@move-beauty.co', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, created_at: '2026-01-01T00:00:00.000Z' };
  const session = { access_token: 'onboarding-test-token', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'onboarding-test-refresh', user };
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: `sb-${projectRef}-auth-token`, value: session });

  let claimed = false;
  let profile = { display_name: '', handle: '', bio: '', specialties: [] as string[], preferred_locale: 'en-US', search_index_enabled: true };
  let progress = { current_step: 'profile', completed_steps: [] as string[], form_data: {} as Record<string, unknown> };
  const services: Array<Record<string, unknown>> = [];
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
      if (method === 'HEAD') return route.fulfill({ status: 200, headers: { ...cors, 'Content-Range': claimed ? '0-0/1' : '0-0/0' } });
      return json([]);
    }
    if (table === 'mova_service_locations') return json([]);
    return json(accept.includes('vnd.pgrst.object') ? null : []);
  });
  await page.route('**/functions/v1/location-save', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    writes.push({ name: 'location-save', body: route.request().postDataJSON() });
    return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ data: { id: locationId }, error: null, request_id: 'onboarding-qa' }) });
  });
  await page.route('**/functions/v1/**', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const name = new URL(route.request().url()).pathname.split('/').pop();
    if (name === 'location-save') writes.push({ name, body: route.request().postDataJSON() });
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

  await expect(page.getByRole('heading', { level: 1, name: 'Add your services' })).toBeVisible();
  await page.getByRole('button', { name: 'Add your first service' }).click();
  await expect(page).toHaveURL(/\/BID-1\/settings\/services\?return_to=%2Fonboarding%2Fservices&new=1$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Add service' })).toBeVisible();
  await page.getByLabel('Service name').fill('Silk press');
  await page.getByLabel('Category').fill('Silk press');
  await page.getByLabel('Duration (minutes)').fill('90');
  await page.getByLabel('Buffer (minutes)').fill('15');
  await page.getByLabel('Price (USD)').fill('150');
  await page.getByRole('button', { name: 'Save service' }).click();
  await expect(page).toHaveURL(/\/onboarding\/services$/);
  await expect(page.getByText('Silk press')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page).toHaveURL(/\/BID-1\/settings\/locations\/new\?return_to=%2Fonboarding%2Fpublish&back_to=%2Fonboarding%2Fservices$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Where else do you work?' })).toBeVisible();
  await page.getByRole('radio', { name: 'Suite rental' }).check();
  await page.getByLabel('Location name').fill('Studio 9 Suites');
  await page.getByLabel('Address').fill('210 Main St, Suite 4');
  await page.getByRole('button', { name: 'Save location' }).click();

  await expect(page).toHaveURL(/\/onboarding\/publish$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Ready to go live' })).toBeVisible();
  expect(writes.map(({ name }) => name)).toEqual(expect.arrayContaining(['mova_claim_artist_profile', 'mova_services', 'location-save']));
  await page.getByRole('button', { name: 'Publish my showcase' }).click();
  await expect(page).toHaveURL(/\/BID-1\/?$/);
  expect(writes.map(({ name }) => name)).toContain('mova_publish_artist_profile');
});
