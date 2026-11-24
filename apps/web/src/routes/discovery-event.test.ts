import { afterEach, expect, it, vi } from 'vitest';
import { action } from './discovery-event';

const site = 'https://mova.invalid';
const data = {
  visit: 'ad119000-0000-4000-8000-000000000001', event: 'ad119000-0000-4000-8000-000000000002',
  landing: '/calculator', path: '/signup', channel: 'paid search', source: 'google', medium: 'cpc',
  campaign: 'november', content: 'pricepilot', signupClick: false,
};

const call = (body: object, origin = site) => action({
  request: new Request(`${site}/api/discovery-event`, { method: 'POST', headers: { Origin: origin }, body: JSON.stringify(body) }),
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
  expect(fetchStub).toHaveBeenCalledExactlyOnceWith('https://db.invalid/rest/v1/rpc/mova_record_discovery_event',
    expect.objectContaining({ body: expect.stringContaining('"p_content":"pricepilot"') }));
  expect((await call({ ...data, content: undefined })).status).toBe(204);
  expect(fetchStub).toHaveBeenLastCalledWith('https://db.invalid/rest/v1/rpc/mova_record_discovery_event',
    expect.objectContaining({ body: expect.stringContaining('"p_content":""') }));
});
