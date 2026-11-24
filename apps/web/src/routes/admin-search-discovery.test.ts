import { generateKeyPairSync } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { loader } from './admin-search-discovery';

const call = (token?: string) => loader({
  request: new Request('https://mova.invalid/api/admin-search-discovery', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }),
  params: {}, context: {},
} as Parameters<typeof loader>[0]);

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function setupEnv() {
  vi.stubEnv('SUPABASE_URL', 'https://db.invalid');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key');
}

it('requires a rostered administrator and reports a missing Search Console connection', async () => {
  setupEnv();
  vi.stubEnv('MOVA_SEARCH_CONSOLE_SERVICE_ACCOUNT', '');
  const fetchStub = vi.fn()
    .mockResolvedValueOnce(Response.json({ is_admin: false }))
    .mockResolvedValueOnce(Response.json({ is_admin: true }));
  vi.stubGlobal('fetch', fetchStub);
  expect((await call()).status).toBe(401);
  expect((await call('stylist-token')).status).toBe(403);
  const response = await call('admin-token');
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(await response.json()).toEqual({ state: 'not_configured' });
  expect(fetchStub).toHaveBeenCalledTimes(2);
});

it('requests finalized Search Console totals, queries and pages without exposing credentials', async () => {
  setupEnv();
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-01T20:00:00Z'));
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  vi.stubEnv('MOVA_SEARCH_CONSOLE_SERVICE_ACCOUNT', JSON.stringify({ client_email: 'reader@example.invalid', private_key: privateKey }));
  vi.stubEnv('MOVA_SEARCH_CONSOLE_SITE', 'sc-domain:mova-beauty.co');
  const requests: { dimensions: string[]; dataState: string; startDate: string; endDate: string }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (address: string, init: RequestInit) => {
    if (address === 'https://db.invalid/rest/v1/rpc/mova_admin_whoami') return Response.json({ is_admin: true });
    if (address === 'https://oauth2.googleapis.com/token') {
      const assertion = (init.body as URLSearchParams).get('assertion') ?? '';
      expect(assertion.split('.')).toHaveLength(3);
      return Response.json({ access_token: 'test-oauth-token' });
    }
    expect(address).toContain('/sc-domain%3Amova-beauty.co/');
    const body = JSON.parse(String(init.body)) as typeof requests[number];
    requests.push(body);
    if (body.dataState === 'all') return Response.json({ metadata: { first_incomplete_date: '2026-10-28' } });
    return Response.json({ rows: [{ keys: body.dimensions.map(key => key === 'query' ? 'booth rent' : 'https://mova-beauty.co/calculator'), clicks: 2, impressions: 8, ctr: 0.25, position: 11 }] });
  }));
  const response = await call('admin-token');
  const result = await response.json();
  expect(result).toMatchObject({ state: 'ready', start: '2026-09-30', through: '2026-10-27', current: { clicks: 2 }, terms: [{ keys: ['booth rent', 'https://mova-beauty.co/calculator'] }] });
  expect(requests.filter(query => query.dataState === 'final')).toHaveLength(4);
  expect(JSON.stringify(result)).not.toContain('test-oauth-token');
});
