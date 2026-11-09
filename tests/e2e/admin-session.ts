import type { Page, Route } from '@playwright/test';

// Admin portal test helpers. The browser talks to Supabase through route mocks, so these tests need no database.
export const adminUserId = 'a0000000-0000-4000-8000-000000000001';

function projectRef(): string {
  return new URL(process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321').hostname.split('.')[0] ?? '127';
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function accessToken(aal: 'aal1' | 'aal2'): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = { aud: 'authenticated', role: 'authenticated', sub: adminUserId, email: 'staff@mova.invalid', aal, session_id: 'playwright-admin', iat: now, exp: now + 3600 };
  return [base64url({ alg: 'HS256', typ: 'JWT' }), base64url(payload), 'playwright-signature'].join('.');
}

export const adminUser = {
  id: adminUserId, aud: 'authenticated', role: 'authenticated', email: 'staff@mova.invalid',
  app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, created_at: '2026-01-01T00:00:00.000Z',
  factors: [{ id: 'totp-1', friendly_name: 'Mova admin', factor_type: 'totp', status: 'verified', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' }],
};

function session(aal: 'aal1' | 'aal2') {
  return { access_token: accessToken(aal), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'playwright-refresh', user: adminUser };
}

export async function fulfillJson(route: Route, value: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, prefer, accept-profile, content-profile', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS' },
    body: JSON.stringify(value),
  });
}

/** Stubs for the functions the shell calls on every admin page. Screens override these by name. */
export const shellStubs: Record<string, (body: Record<string, unknown>) => unknown> = {
  mova_admin_support_list: () => ({ messages: [], counts: { all: 0, new: 0, in_progress: 0, waiting_on_stylist: 0, resolved: 0 } }),
  mova_admin_health: () => ({
    checked_at: new Date().toISOString(),
    stripe_webhooks: { received_24h: 0, failed_24h: 0 }, texts: { sent_24h: 0, failed_24h: 0 }, emails: { sent_24h: 0, failed_24h: 0 },
    calendar: { errors: 0, stylists_affected: 0 }, jobs: { dead_24h: 0, stuck: 0 },
    failed_texts: [], webhook_failures: [], calendar_errors: [], stuck_jobs: [],
  }),
  mova_admin_record_sign_in: () => null,
};

/**
 * Sets up the Supabase mocks. `signedIn` seeds a two-step session in local storage. `isAdmin` decides what
 * mova_admin_whoami says. `rpc` answers the other database functions by name.
 */
export async function mockAdminApi(page: Page, options: {
  signedIn: boolean;
  isAdmin: boolean;
  rpc?: Record<string, (body: Record<string, unknown>) => unknown>;
}) {
  const key = `sb-${projectRef()}-auth-token`;
  if (options.signedIn) {
    await page.addInitScript(({ storageKey, value }) => {
      localStorage.setItem(storageKey, JSON.stringify(value));
    }, { storageKey: key, value: session('aal2') });
  }
  await page.route('**/auth/v1/**', async (route) => {
    if (route.request().method() === 'OPTIONS') return fulfillJson(route, null);
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/user')) return fulfillJson(route, adminUser);
    if (path.endsWith('/token')) return fulfillJson(route, session('aal1'));
    if (path.endsWith('/verify')) return fulfillJson(route, session('aal2'));
    if (path.endsWith('/challenge')) return fulfillJson(route, { id: 'challenge-1', expires_at: Math.floor(Date.now() / 1000) + 300 });
    return fulfillJson(route, {});
  });
  await page.route('**/rest/v1/rpc/**', async (route) => {
    if (route.request().method() === 'OPTIONS') return fulfillJson(route, null);
    const name = new URL(route.request().url()).pathname.split('/').pop() ?? '';
    const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
    if (name === 'mova_admin_whoami') return fulfillJson(route, options.isAdmin ? { is_admin: true, display_name: 'Jasmine F.' } : { is_admin: false });
    const handler = options.rpc?.[name] ?? shellStubs[name];
    if (!handler) return fulfillJson(route, { error: `no stub for ${name}` }, 404);
    return fulfillJson(route, await handler(body));
  });
}
