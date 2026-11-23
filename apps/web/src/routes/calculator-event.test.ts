import { afterEach, expect, it, vi } from 'vitest';
import { action } from './calculator-event';

const endpoint = 'https://mova.invalid/api/calculator-event';
const call = (body: string, origin = 'https://mova.invalid') => action({
  request: new Request(endpoint, { method: 'POST', headers: { Origin: origin }, body }),
  params: {}, context: {},
} as Parameters<typeof action>[0]);

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('accepts only known events from the site and forwards only the event name', async () => {
  const fetchStub = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchStub);
  vi.stubEnv('SUPABASE_URL', 'https://db.invalid');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-service-role');
  expect((await call('calculator_used', 'https://elsewhere.invalid')).status).toBe(403);
  expect((await call('{"event":"calculator_used","revenue":750}')).status).toBe(400);
  expect(fetchStub).not.toHaveBeenCalled();
  expect((await call('calculator_used')).status).toBe(204);
  expect(fetchStub).toHaveBeenCalledExactlyOnceWith('https://db.invalid/rest/v1/rpc/mova_record_calculator_event',
    expect.objectContaining({ body: JSON.stringify({ p_event: 'calculator_used' }) }));
});
