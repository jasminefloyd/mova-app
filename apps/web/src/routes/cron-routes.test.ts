import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoaderFunctionArgs } from 'react-router';
import { cronAuthorized } from './cron-auth';
import { loader as calendarSync } from './calendar-sync';
import { action as reportsRefreshAction, loader as reportsRefresh } from './reports-refresh';

// Task 4.6: every scheduled route checks the shared secret before doing anything.
const request = (path: string, authorization?: string, method = 'GET') =>
  ({ request: new Request(`https://mova.invalid${path}`, { method, ...(authorization ? { headers: { authorization } } : {}) }) } as LoaderFunctionArgs);

describe('cron secret check', () => {
  const secret = 'synthetic-cron-secret';
  it('accepts only the exact bearer secret', () => {
    expect(cronAuthorized(new Request('https://x.invalid', { headers: { authorization: `Bearer ${secret}` } }), secret)).toBe(true);
    for (const header of ['', secret, `Bearer ${secret}x`, `bearer ${secret}`, `Bearer ${secret.slice(0, -1)}`]) {
      expect(cronAuthorized(new Request('https://x.invalid', { headers: header ? { authorization: header } : {} }), secret)).toBe(false);
    }
  });
  it('fails closed without a secret or with a short one', () => {
    expect(cronAuthorized(new Request('https://x.invalid', { headers: { authorization: 'Bearer ' } }), '')).toBe(false);
    expect(cronAuthorized(new Request('https://x.invalid', { headers: { authorization: 'Bearer short' } }), 'short')).toBe(false);
    expect(cronAuthorized(new Request('https://x.invalid', { headers: { authorization: 'Bearer undefined' } }), undefined)).toBe(false);
  });
});

describe.each([
  ['calendar-sync', '/api/calendar-sync', calendarSync, 'calendar-sync-run'],
  ['reports-refresh (GET, as Vercel Cron calls it)', '/api/reports-refresh', reportsRefresh, 'reports-refresh'],
  ['reports-refresh (POST)', '/api/reports-refresh', reportsRefreshAction, 'reports-refresh'],
] as const)('%s cron route', (_name, path, handler, fn) => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'synthetic-cron-secret');
    vi.stubEnv('SUPABASE_URL', 'https://project.supabase.invalid');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-service-role');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ refreshed: 1 })));
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('rejects a missing or wrong secret without calling anything', async () => {
    expect((await handler(request(path))).status).toBe(401);
    expect((await handler(request(path, 'Bearer wrong-secret-value!!'))).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('fails closed when server configuration is missing', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    expect((await handler(request(path, 'Bearer synthetic-cron-secret'))).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('runs the Edge Function with the secret', async () => {
    const response = await handler(request(path, 'Bearer synthetic-cron-secret'));
    expect(response.status).toBe(200);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe(`https://project.supabase.invalid/functions/v1/${fn}`);
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer synthetic-cron-secret');
  });
});
