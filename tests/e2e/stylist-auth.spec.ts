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

/** otp: 'ok' sends the link, 'unknown' is an email with no account (sign-in only), 'error' fails. */
async function mockAuth(page: Page, options: { otp?: 'ok' | 'unknown' | 'error'; memberships?: number; progress?: string | null } = {}) {
  const requests: { otp: Array<{ body: Record<string, unknown>; redirectTo: string | null }> } = { otp: [] };
  await page.route('**/auth/v1/otp**', async (route) => {
    if (route.request().method() === 'POST') {
      requests.otp.push({ body: route.request().postDataJSON() as Record<string, unknown>, redirectTo: new URL(route.request().url()).searchParams.get('redirect_to') });
    }
    if (options.otp === 'error') return json(route, 429, { code: 'over_email_send_rate_limit', msg: 'Email rate limit exceeded' });
    if (options.otp === 'unknown') return json(route, 422, { code: 'otp_disabled', msg: 'Signups not allowed for otp' });
    return json(route, 200, {});
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
    if (table === 'mova_onboarding_progress') {
      const row = options.progress ? { current_step: options.progress } : null;
      return json(route, 200, single ? row : row ? [row] : []);
    }
    if (table === 'mova_artist_businesses') return json(route, 200, single ? { id: businessId, business_number: 1, business_number_display: 'BID-1' } : [{ id: businessId, business_number: 1 }]);
    return json(route, 200, single ? null : []);
  });
  return requests;
}

/** Opens /auth/confirm the way the emailed link does, with the session the link would create already stored. */
async function landFromEmailLink(page: Page, query = '') {
  const projectRef = new URL(process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321').hostname.split('.')[0] ?? '127';
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: `sb-${projectRef}-auth-token`, value: session() });
  await page.goto(`/auth/confirm${query}`);
}

test.describe('stylist sign-up (/signup)', () => {
  test('keeps the landing visit and ignores unapproved UTMs through signup', async ({ page }) => {
    const requests = await mockAuth(page);
    const events: Record<string, unknown>[] = [];
    await page.route('**/api/discovery-event', async route => {
      const request = route.request();
      expect(await request.headerValue('origin')).toBe(new URL(request.url()).origin);
      events.push(request.postDataJSON() as Record<string, unknown>);
      await route.fulfill({ status: 204 });
    });
    let calculatorOrigin: string | null = null;
    await page.route('**/api/calculator-event', async route => {
      calculatorOrigin = await route.request().headerValue('origin');
      await route.fulfill({ status: 204 });
    });
    await page.goto('/calculator?utm_source=google&utm_medium=cpc&utm_campaign=november');
    await expect.poll(() => events.length).toBe(1);
    const visit = events[0]?.visit;
    expect(events[0]).toMatchObject({ landing: '/calculator', path: '/calculator', channel: 'direct / unknown', source: '', medium: '', campaign: '', content: '', visitor: expect.any(String) });
    await page.locator('a[href="/signup?from=calculator"]').click();
    await expect.poll(() => calculatorOrigin).toBe(new URL(page.url()).origin);
    await expect.poll(() => events.some(event => event.signupClick === true && event.visit === visit)).toBe(true);
    await expect.poll(() => events.some(event => event.path === '/signup' && event.visit === visit)).toBe(true);
    await page.locator('#stylist-signup-first').fill('Test');
    await page.locator('#stylist-signup-last').fill('Stylist');
    await page.locator('#stylist-signup-email').fill('new-stylist@mova.invalid');
    await page.locator('#stylist-signup-first').locator('xpath=ancestor::form').locator('button[type="submit"]').click();
    await expect.poll(() => requests.otp[0]?.body.data).toMatchObject({ mova_discovery_visit: visit });
  });

  test('attributes direct signup landing to the PricePilot ad even after an earlier visit', async ({ page }) => {
    const requests = await mockAuth(page);
    const events: Record<string, unknown>[] = [];
    await page.route('**/api/discovery-event', async route => {
      events.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({ status: 204 });
    });
    await page.goto('/pricing');
    await expect.poll(() => events.length).toBe(1);
    await page.goto('/signup?utm_source=google&utm_medium=cpc&utm_campaign=aig_pp_search&utm_content=pricepilot');
    await expect.poll(() => events.length).toBe(2);
    const ad = events[1];
    expect(ad).toMatchObject({ landing: '/signup', channel: 'paid search', source: 'google', medium: '', campaign: 'aig_pp_search', content: 'pricepilot' });
    expect(ad?.visit).not.toBe(events[0]?.visit);
    expect(ad?.visitor).toBe(events[0]?.visitor);
    await page.getByLabel('First name').fill('Test');
    await page.getByLabel('Last name').fill('Stylist');
    await page.getByLabel('Email', { exact: true }).fill(user.email);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect.poll(() => requests.otp[0]?.body.data).toMatchObject({ mova_discovery_visit: ad?.visit });
  });

  for (const newAccount of [true, false]) {
    test(`calculator attribution counts ${newAccount ? 'a newly verified account' : 'no conversion for an existing account'}`, async ({ page }) => {
      await mockAuth(page);
      const events: Array<string | null> = [];
      await page.route('**/api/calculator-event', (route) => {
        events.push(route.request().postData());
        return route.fulfill({ status: 204 });
      });
      await page.route('**/auth/v1/verify', (route) => json(route, 200, {
        ...session(), user: { ...user, created_at: newAccount ? new Date().toISOString() : user.created_at },
      }));
      await page.goto('/calculator');
      await page.locator('a[href="/signup?from=calculator"]').click();
      await page.getByLabel('First name').fill('Ari');
      await page.getByLabel('Last name').fill('Monroe');
      await page.getByLabel('Email', { exact: true }).fill('new-stylist@mova.invalid');
      await page.getByRole('button', { name: 'Create account' }).click();
      await page.locator('input[autocomplete="one-time-code"]').fill('123456');
      await expect(page).toHaveURL(/\/onboarding\/profile$/);
      await expect.poll(() => events).toEqual(newAccount ? ['start_free_clicked', 'signup_completed'] : ['start_free_clicked']);
    });
  }

  for (const newAccount of [true, false]) {
    test(`Tag Manager queues ${newAccount ? 'a verified new signup once' : 'no conversion for a returning account'}`, async ({ page, baseURL }) => {
      // Serve the local build on the production origin in Chromium. All auth and Google requests are mocked.
      const origin = 'https://mova-beauty.co';
      await page.route(`${origin}/**`, async (route) => {
        const url = new URL(route.request().url());
        const response = await route.fetch({ url: new URL(url.pathname + url.search, baseURL).href });
        return route.fulfill({ response });
      });
      await page.route('https://www.googletagmanager.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
      await mockAuth(page);
      let valid = false;
      await page.route('**/auth/v1/verify', (route) => json(route, valid ? 200 : 403, valid ? {
        ...session(), user: { ...user, created_at: newAccount ? new Date().toISOString() : user.created_at },
      } : { code: 'otp_expired', msg: 'Invalid email code' }));
      const commands = () => page.evaluate(() => {
        const layer = (window as Window & { dataLayer?: Array<IArguments | Record<string, unknown>> }).dataLayer ?? [];
        return layer.map(entry => 'length' in entry ? Array.from(entry as IArguments) : entry);
      });
      const conversions = async () => (await commands()).filter(entry => !Array.isArray(entry) && entry['event'] === 'mova_stylist_signup');

      await page.goto(origin + '/');
      await expect(page.locator('script[src*="gtm.js?id=GTM-KT7RSDNS"]')).toHaveCount(1);
      await page.goto(origin + '/signup');
      await expect(page.locator('script[src*="gtm.js?id=GTM-KT7RSDNS"]')).toHaveCount(1);
      await expect(page.locator('script[src*="googletagmanager.com/gtag/js"]')).toHaveCount(0);
      const queued = await commands();
      expect(queued).toContainEqual(['set', 'allow_ad_personalization_signals', false]);
      expect(queued).toContainEqual(expect.objectContaining({ event: 'gtm.js', 'gtm.start': expect.any(Number) }));
      await page.getByLabel('First name').fill('Ari');
      await page.getByLabel('Last name').fill('Monroe');
      await page.getByLabel('Email', { exact: true }).fill(user.email);
      await page.getByRole('button', { name: 'Create account' }).click();
      expect(await conversions()).toEqual([]);
      const code = page.locator('input[autocomplete="one-time-code"]');
      const failed = page.waitForResponse(response => response.url().includes('/auth/v1/verify') && response.status() === 403);
      await code.fill('000000');
      await failed;
      expect(await conversions()).toEqual([]);

      valid = true;
      await code.fill('123456');
      await expect(page).toHaveURL(/\/onboarding\/profile$/);
      expect(await conversions()).toEqual(newAccount ? [
        { event: 'mova_stylist_signup', value: 1.0, currency: 'USD' },
      ] : []);
      expect(await page.evaluate(id => localStorage.getItem('mova_gtm_signup:' + id), userId))
        .toBe(newAccount ? '1' : null);
    });
  }

  test('anyone can create an account: no invite or waitlist gate', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.getByRole('heading', { level: 1, name: 'Create your account' })).toBeVisible();
    await expect(page.getByText('Join the waitlist')).toHaveCount(0);
    await expect(page.getByText('invite-only', { exact: false })).toHaveCount(0);
  });

  test('asks for first name, last name and email, then sends a sign-in code', async ({ page }) => {
    const requests = await mockAuth(page, { otp: 'ok' });
    await page.goto('/signup');
    await expect(page.getByLabel('Password')).toHaveCount(0);
    await expect(page.getByRole('radio')).toHaveCount(0);
    await page.getByLabel('First name').fill('Ari');
    await page.getByLabel('Last name').fill('Monroe');
    await page.getByLabel('Email', { exact: true }).fill('new-stylist@mova.invalid');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Check your email' })).toBeVisible();
    await expect(page.getByText('new-stylist@mova.invalid')).toBeVisible();
    await expect(page.getByRole('button', { name: /Send again/ })).toBeDisabled();
    expect(requests.otp).toHaveLength(1);
    expect(requests.otp[0]?.body).toMatchObject({
      email: 'new-stylist@mova.invalid',
      create_user: true,
      data: { first_name: 'Ari', last_name: 'Monroe', preferred_locale: 'en-US' },
    });
    expect(requests.otp[0]?.redirectTo).toBeNull();
  });

  test('"Use a different email" goes back to the form', async ({ page }) => {
    await mockAuth(page, { otp: 'ok' });
    await page.goto('/signup');
    await page.getByLabel('First name').fill('Ari');
    await page.getByLabel('Last name').fill('Monroe');
    await page.getByLabel('Email', { exact: true }).fill('new-stylist@mova.invalid');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.getByRole('button', { name: 'Use a different email' }).click();
    await expect(page.getByLabel('Email', { exact: true })).toHaveValue('new-stylist@mova.invalid');
  });

  test('a failed request shows the account error', async ({ page }) => {
    await mockAuth(page, { otp: 'error' });
    await page.goto('/signup');
    await page.getByLabel('First name').fill('Ari');
    await page.getByLabel('Last name').fill('Monroe');
    await page.getByLabel('Email', { exact: true }).fill('new-stylist@mova.invalid');
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
  test('emails a sign-in link without creating an account', async ({ page }) => {
    const requests = await mockAuth(page, { otp: 'ok' });
    await page.goto('/login');
    await expect(page.getByLabel('Password')).toHaveCount(0);
    await page.getByLabel('Email', { exact: true }).fill('new-stylist@mova.invalid');
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Check your email' })).toBeVisible();
    expect(requests.otp[0]?.body).toMatchObject({ email: 'new-stylist@mova.invalid', create_user: false });
  });

  test('an email with no account gets the same answer, so the page never reveals who has an account', async ({ page }) => {
    await mockAuth(page, { otp: 'unknown' });
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill('nobody@mova.invalid');
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Check your email' })).toBeVisible();
  });

  test('a failed request shows the sign-in error and stays on /login', async ({ page }) => {
    await mockAuth(page, { otp: 'error' });
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill('new-stylist@mova.invalid');
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
    await expect(page.getByRole('alert')).toContainText("We couldn't send a sign-in link.");
    await expect(page).toHaveURL(/\/login$/);
  });

  test('client sign-in stays at /signin and sign-up is linked from sign-in', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Client sign-in' })).toHaveAttribute('href', '/signin');
    await page.getByRole('link', { name: 'Create a stylist account' }).click();
    await expect(page).toHaveURL(/\/signup$/);
  });

  test('the retired /reset-password page sends stylists to sign-in', async ({ page }) => {
    await page.goto('/reset-password');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('email link landing (/auth/confirm)', () => {
  test('a stylist with one finished business opens that business', async ({ page }) => {
    await mockAuth(page, { memberships: 1, progress: 'complete' });
    await landFromEmailLink(page);
    await expect(page).toHaveURL(/\/BID-1\/?$/);
  });

  test('a stylist with no business goes to onboarding', async ({ page }) => {
    await mockAuth(page, { memberships: 0 });
    await landFromEmailLink(page, '?returnTo=%2Fonboarding%2Fprofile');
    await expect(page).toHaveURL(/\/onboarding\/profile$/);
  });

  test('a stylist part-way through setup resumes onboarding', async ({ page }) => {
    await mockAuth(page, { memberships: 1, progress: 'services' });
    await landFromEmailLink(page);
    await expect(page).toHaveURL(/\/onboarding\//);
  });

  test('an expired link explains itself and offers a new one', async ({ page }) => {
    await page.goto('/auth/confirm#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.getByRole('link', { name: 'Send a new link' }).click();
    await expect(page).toHaveURL(/\/login$/);
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
