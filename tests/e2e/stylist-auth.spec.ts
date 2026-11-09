import { expect, test, type Page, type Route } from '@playwright/test';

// P6 auth: open stylist sign-up (/signup, W8), stylist sign-in (/login, W9) and the /auth redirect.
// Supabase Auth and REST calls are answered by route mocks, so no real account is created.

const businessId = 'e2500000-0000-4000-8000-000000000001';
const userId = 'e2500000-0000-4000-8000-000000000778';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-mova-artist-business-id, prefer, accept-profile, content-profile',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
};
const user = {
  id: userId, aud: 'authenticated', role: 'authenticated', email: 'new-stylist@mova.invalid',
  app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, created_at: '2026-01-01T00:00:00.000Z',
};

function session() {
  return {
    access_token: 'playwright-session-token', token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'playwright-refresh-token', user,
  };
}

async function json(route: Route, status: number, body: unknown) {
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  return route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
}

/** signUp: 'session' signs straight in, 'verify' waits for the email link, 'error' fails. */
async function mockAuth(page: Page, options: { signUp?: 'session' | 'verify' | 'error'; signIn?: 'ok' | 'bad'; memberships?: number } = {}) {
  const requests: { signUp: unknown[]; signIn: number } = { signUp: [], signIn: 0 };
  await page.route('**/auth/v1/signup**', async (route) => {
    if (route.request().method() === 'POST') requests.signUp.push(route.request().postDataJSON());
    if (options.signUp === 'error') return json(route, 422, { code: 'weak_password', msg: 'Password should be at least 6 characters.' });
    if (options.signUp === 'verify') return json(route, 200, user);
    return json(route, 200, session());
  });
  await page.route('**/auth/v1/token**', async (route) => {
    if (route.request().method() === 'OPTIONS') return json(route, 200, {});
    requests.signIn += 1;
    if (options.signIn === 'bad') return json(route, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
    return json(route, 200, session());
  });
  await page.route('**/auth/v1/user', (route) => json(route, 200, user));
  await page.route('**/rest/v1/**', async (route) => {
    if (route.request().method() === 'OPTIONS') return json(route, 200, {});
    const url = new URL(route.request().url());
    const table = url.pathname.split('/').pop();
    const accept = route.request().headers()['accept'] ?? '';
    const single = accept.includes('vnd.pgrst.object');
    if (table === 'mova_artist_memberships') {
      const rows = Array.from({ length: options.memberships ?? 0 }, () => ({ artist_business_id: businessId }));
      return json(route, 200, single ? (rows[0] ?? null) : rows);
    }
    if (table === 'mova_artist_businesses') return json(route, 200, single ? { id: businessId, business_number: 1, business_number_display: 'BID-1' } : [{ id: businessId, business_number: 1 }]);
    return json(route, 200, single ? null : []);
  });
  return requests;
}

test.describe('stylist sign-up (/signup)', () => {
  test('anyone can create an account: no invite or waitlist gate', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.getByRole('heading', { level: 1, name: 'Create your account' })).toBeVisible();
    await expect(page.getByText('Join the waitlist')).toHaveCount(0);
    await expect(page.getByText('invite-only', { exact: false })).toHaveCount(0);
  });

  test('a new stylist with a session continues to onboarding, and the app language is sent with the account', async ({ page }) => {
    const requests = await mockAuth(page, { signUp: 'session' });
    await page.goto('/signup');
    await page.getByLabel('Email', { exact: true }).fill('new-stylist@mova.invalid');
    await page.getByLabel('Password', { exact: true }).fill('a-long-password');
    await page.getByRole('radio', { name: 'Español (EE. UU.)' }).check();
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    await expect(page).toHaveURL(/\/onboarding\/profile$/);
    expect(requests.signUp).toHaveLength(1);
    expect(requests.signUp[0]).toMatchObject({
      email: 'new-stylist@mova.invalid',
      data: { preferred_locale: 'es-US' },
    });
  });

  test('without a session the page asks the stylist to verify their email', async ({ page }) => {
    await mockAuth(page, { signUp: 'verify' });
    await page.goto('/signup');
    await page.getByLabel('Email', { exact: true }).fill('new-stylist@mova.invalid');
    await page.getByLabel('Password', { exact: true }).fill('a-long-password');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('status')).toContainText('Check your email for a verification link.');
    await expect(page).toHaveURL(/\/signup$/);
  });

  test('a password under 9 characters is refused before any request is sent', async ({ page }) => {
    const requests = await mockAuth(page, { signUp: 'session' });
    await page.goto('/signup');
    await page.getByLabel('Email', { exact: true }).fill('new-stylist@mova.invalid');
    await page.getByLabel('Password', { exact: true }).fill('short');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('alert')).toContainText('Use at least 9 characters.');
    expect(requests.signUp).toEqual([]);
  });

  test('a failed sign-up shows the account error', async ({ page }) => {
    await mockAuth(page, { signUp: 'error' });
    await page.goto('/signup');
    await page.getByLabel('Email', { exact: true }).fill('new-stylist@mova.invalid');
    await page.getByLabel('Password', { exact: true }).fill('a-long-password');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('alert')).toContainText("We couldn't create your account.");
  });

  test('"See plans" goes to /pricing and "Sign in" goes to /login; the legal links are plain text', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.getByRole('link', { name: 'See plans' })).toHaveAttribute('href', '/pricing');
    await expect(page.getByRole('link', { name: 'Terms' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Privacy Policy' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe('stylist sign-in (/login)', () => {
  test('a stylist with one business opens that business', async ({ page }) => {
    await mockAuth(page, { signIn: 'ok', memberships: 1 });
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill('new-stylist@mova.invalid');
    await page.getByLabel('Password', { exact: true }).fill('a-long-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/BID-1\/?$/);
  });

  test('a stylist with no business goes to onboarding', async ({ page }) => {
    await mockAuth(page, { signIn: 'ok', memberships: 0 });
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill('new-stylist@mova.invalid');
    await page.getByLabel('Password', { exact: true }).fill('a-long-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/onboarding\/profile$/);
  });

  test('wrong credentials show the sign-in error and stay on /login', async ({ page }) => {
    await mockAuth(page, { signIn: 'bad' });
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill('new-stylist@mova.invalid');
    await page.getByLabel('Password', { exact: true }).fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toContainText("We couldn't sign you in.");
    await expect(page).toHaveURL(/\/login$/);
  });

  test('client sign-in stays at /signin and sign-up is linked from sign-in', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Client sign-in' })).toHaveAttribute('href', '/signin');
    await page.getByRole('link', { name: 'Create a stylist account' }).click();
    await expect(page).toHaveURL(/\/signup$/);
  });
});

test.describe('/auth redirect', () => {
  test('/auth lands on /login and keeps the returnTo query', async ({ page }) => {
    await page.goto('/auth?returnTo=%2FBID-1%2Fsettings');
    await expect(page).toHaveURL(/\/login\?returnTo=%2FBID-1%2Fsettings$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeVisible();
  });

  test('the bare /auth path also lands on /login', async ({ page }) => {
    await page.goto('/auth');
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe('stylist auth layout', () => {
  for (const locale of ['en-US', 'es-US'] as const) {
    for (const path of ['/login', '/signup']) {
      test(`${path} has no horizontal scroll at 320px (${locale})`, async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 700 });
        await page.addInitScript((value) => window.localStorage.setItem('mova_onboarding_locale', value), locale);
        await page.goto(path);
        await expect(page.locator('h1')).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }
  }
});
