import { afterEach, expect, it, vi } from 'vitest';
import { action } from './discovery-event';

const site = 'https://mova.invalid';
const data = {
  visit: 'ad119000-0000-4000-8000-000000000001', event: 'ad119000-0000-4000-8000-000000000002',
  landing: '/calculator', path: '/signup', channel: 'paid search', source: 'google', medium: 'cpc',
  campaign: 'aig_pp_search', content: 'pricepilot', visitor: 'ad119000-0000-4000-8000-000000000003', referrer: 'www.google.com', signupClick: false,
};

const call = (body: object, origin = site, extra: Record<string, string> = {}) => action({
  request: new Request(`${site}/api/discovery-event`, { method: 'POST', headers: { Origin: origin, 'User-Agent': 'Mozilla/5.0 (iPhone) FxiOS/110.0 Mobile/15E148 Safari/605.1', 'x-vercel-ip-country': 'US', ...extra }, body: JSON.stringify(body) }),
  params: {}, context: {},
} as Parameters<typeof action>[0]);

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('only forwards allowed discovery fields from marketing pages', async () => {
  vi.stubEnv('SUPABASE_URL', 'https://db.invalid');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
  const fetchStub = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchStub);
  expect((await call(data, 'https://elsewhere.invalid')).status).toBe(403);
  expect((await call({ ...data, path: '/admin' })).status).toBe(400);
  expect((await call({ ...data, campaign: 'visitor@example.invalid' })).status).toBe(400);
  expect((await call({ ...data, email: 'visitor@example.invalid' })).status).toBe(400);
  expect((await call({ ...data, content: 'visitor@example.invalid' })).status).toBe(400);
  expect(fetchStub).not.toHaveBeenCalled();
  expect((await call(data)).status).toBe(204);
  expect(fetchStub).toHaveBeenCalledExactlyOnceWith('https://db.invalid/rest/v1/rpc/mova_record_website_traffic_event',
    expect.objectContaining({ body: expect.stringContaining('"p_content":"pricepilot"') }));
  const firstCall = fetchStub.mock.calls[0]?.[1] as RequestInit;
  expect(JSON.parse(String(firstCall.body))).toMatchObject({ p_source: 'www.google.com', p_audience: { device: 'Mobile', browser: 'Firefox', country: 'US', referrer: 'www.google.com', visitor: data.visitor } });
  expect(firstCall.body).not.toContain('FxiOS');
  expect((await call({ ...data, campaign: 'unknown-campaign', source: 'shop', medium: 'sample' })).status).toBe(204);
  expect(fetchStub).toHaveBeenLastCalledWith('https://db.invalid/rest/v1/rpc/mova_record_website_traffic_event',
    expect.objectContaining({ body: expect.stringContaining('"p_campaign":"","p_content":""') }));
});

it('decodes and forwards city and state alongside the country, with missing or invalid values left blank', async () => {
  vi.stubEnv('SUPABASE_URL', 'https://db.invalid');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
  const fetchStub = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchStub);
  expect((await call(data, site, { 'x-vercel-ip-city': 'Brooklyn', 'x-vercel-ip-country-region': 'NY' })).status).toBe(204);
  expect((await call(data, site, { 'x-vercel-ip-city': 'S%C3%A3o%20Paulo', 'x-vercel-ip-country-region': 'SP', 'x-vercel-ip-country': 'BR' })).status).toBe(204);
  expect((await call(data, site, { 'x-vercel-ip-city': 'Bad%zz', 'x-vercel-ip-country-region': 'invalid' })).status).toBe(204);
  const geography = fetchStub.mock.calls.map(call => JSON.parse(String((call[1] as RequestInit).body)).p_audience);
  expect(geography).toEqual([
    expect.objectContaining({ city: 'Brooklyn', region: 'NY', country: 'US' }),
    expect.objectContaining({ city: 'São Paulo', region: 'SP', country: 'BR' }),
    expect.objectContaining({ city: '', region: '', country: 'US' }),
  ]);
});
