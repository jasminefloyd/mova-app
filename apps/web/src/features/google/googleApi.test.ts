import { describe, expect, it } from 'vitest';
import { errorCodeOf, relativeTime } from './googleApi';

describe('Google client helpers (P6)', () => {
  it('reads the stable server code from a failed function call', async () => {
    const response = new Response(JSON.stringify({ data: { code: 'GOOGLE_NOT_CONFIGURED' }, error: { code: 'GOOGLE_NOT_CONFIGURED' } }), { status: 503 });
    expect(await errorCodeOf({ context: response })).toBe('GOOGLE_NOT_CONFIGURED');
  });
  it('falls back to ACTION_FAILED when there is no readable code', async () => {
    expect(await errorCodeOf(new Error('network down'))).toBe('ACTION_FAILED');
    expect(await errorCodeOf({ context: new Response('not json', { status: 500 }) })).toBe('ACTION_FAILED');
  });
  it('formats the time since a sync in the active language', () => {
    const now = Date.parse('2026-11-08T12:00:00Z');
    expect(relativeTime('2026-11-08T10:00:00Z', 'en-US', now)).toBe('2 hours ago');
    expect(relativeTime('2026-11-08T11:55:00Z', 'en-US', now)).toBe('5 minutes ago');
    expect(relativeTime('2026-11-08T10:00:00Z', 'es-US', now)).toMatch(/hace 2 horas/);
    expect(relativeTime(null, 'en-US', now)).toBe('');
  });
});
