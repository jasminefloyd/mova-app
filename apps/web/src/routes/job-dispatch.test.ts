import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoaderFunctionArgs } from 'react-router';
import { loader } from './job-dispatch';

const callLoader = (authorization?: string) => loader({
  request: new Request('https://mova.invalid/api/job-dispatch', authorization ? { headers: { authorization } } : {}),
} as LoaderFunctionArgs);

describe('job dispatcher cron route', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'synthetic-cron');
    vi.stubEnv('SUPABASE_URL', 'https://project.supabase.invalid/');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-service-role');
    vi.stubEnv('MOVA_JOB_DISPATCH_SECRET', 'synthetic-dispatch');
    vi.stubEnv('MOVA_JOB_WORKER_SECRET', 'synthetic-worker');
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('TC-NFR-JOB-04 rejects unauthenticated cron requests', async () => {
    const response = await callLoader();
    expect(response.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('TC-NFR-JOB-05 fails closed when worker secrets are missing', async () => {
    vi.stubEnv('MOVA_JOB_WORKER_SECRET', '');
    const response = await callLoader('Bearer synthetic-cron');
    expect(response.status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('TC-NFR-JOB-06 dispatches pending outbox work before invoking the worker', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ data: { enqueued: 2 } }))
      .mockResolvedValueOnce(Response.json({ data: { leased: 2, succeeded: 2, retried: 0, dead: 0 } }));
    const response = await callLoader('Bearer synthetic-cron');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      dispatch: { enqueued: 2 }, worker: { leased: 2, succeeded: 2, retried: 0, dead: 0 },
    });
    expect(fetch).toHaveBeenNthCalledWith(1, 'https://project.supabase.invalid/functions/v1/job-dispatch', expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ apikey: 'synthetic-service-role', 'x-mova-job-secret': 'synthetic-dispatch' }),
    }));
    expect(fetch).toHaveBeenNthCalledWith(2, 'https://project.supabase.invalid/functions/v1/job-worker', expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ apikey: 'synthetic-service-role', 'x-mova-job-secret': 'synthetic-worker' }),
    }));
  });

  it('TC-NFR-JOB-07 does not invoke the worker when dispatch fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: 'private upstream detail' }, { status: 503 }));
    const response = await callLoader('Bearer synthetic-cron');
    expect(response.status).toBe(503);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await response.text()).not.toContain('private upstream detail');
  });
});
