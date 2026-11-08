import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoaderFunctionArgs } from 'react-router';

const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }));

import { loader } from './booking-expiry';

function callLoader(authorization?: string) {
  const init: RequestInit = authorization ? { headers: { authorization } } : {};
  return loader({
    request: new Request('https://mova.invalid/api/booking-expiry', init),
  } as LoaderFunctionArgs);
}

describe('booking-expiry cron route', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'synthetic-cron-secret');
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    createClientMock.mockReset();
  });

  afterEach(() => vi.unstubAllEnvs());

  it('rejects requests without the configured bearer secret', async () => {
    const response = await callLoader();

    expect(response.status).toBe(401);
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it('fails closed when the cron secret is not configured', async () => {
    vi.stubEnv('CRON_SECRET', '');

    const response = await callLoader('Bearer synthetic-cron-secret');

    expect(response.status).toBe(401);
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it('returns a server configuration error without creating a Supabase client', async () => {
    const response = await callLoader('Bearer synthetic-cron-secret');

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'Server configuration missing' });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it('invokes the expiry RPC and returns the expired count', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 2, error: null });
    createClientMock.mockReturnValue({ rpc });
    vi.stubEnv('SUPABASE_URL', 'https://project.supabase.invalid');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-service-role-key');

    const response = await callLoader('Bearer synthetic-cron-secret');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ expired: 2 });
    expect(rpc).toHaveBeenCalledWith('mova_expire_booking_requests');
    expect(createClientMock).toHaveBeenCalledWith(
      'https://project.supabase.invalid',
      'synthetic-service-role-key',
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  });

  it('returns a generic failure when the expiry RPC errors', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'private database detail' } });
    createClientMock.mockReturnValue({ rpc });
    vi.stubEnv('SUPABASE_URL', 'https://project.supabase.invalid');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-service-role-key');

    const response = await callLoader('Bearer synthetic-cron-secret');

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({ error: 'Expiry processing failed' });
    expect(JSON.stringify(body)).not.toContain('private database detail');
  });
});
