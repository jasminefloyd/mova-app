import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { requestApi } from './api';

describe('API envelope client', () => {
  it('sends a request ID and validates the response envelope', async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/i);
      return new Response(JSON.stringify({ data: { value: 'ok' }, error: null, request_id: 'server-request-id' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await expect(requestApi({ url: '/functions/v1/example', dataSchema: z.object({ value: z.string() }), fetcher }))
      .resolves.toEqual({ value: 'ok' });
  });

  it('rejects a malformed envelope instead of trusting the response', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ data: { value: 1 }, error: null }), { status: 200 }));
    await expect(requestApi({ url: '/functions/v1/example', dataSchema: z.object({ value: z.string() }), fetcher }))
      .rejects.toThrow();
  });
});
