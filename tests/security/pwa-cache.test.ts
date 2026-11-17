import { describe, expect, it } from 'vitest';
import { PRIVATE_API_NAVIGATION_DENYLIST, PWA_PRECACHE_POLICY, isCacheableDataRequest } from '../../apps/web/src/pwa/cache-policy';

describe('service worker cache policy', () => {
  it('pre-caches static assets', () => {
    expect(PWA_PRECACHE_POLICY.globPatterns).toContain('**/*.{css,html,ico,js,png,svg,webmanifest,woff2}');
  });

  it('keeps only Supabase table reads for offline use, never auth, functions, storage or writes', () => {
    const base = 'https://project.supabase.co';
    expect(isCacheableDataRequest('GET', new URL(`${base}/rest/v1/mova_appointments?select=*`))).toBe(true);
    expect(isCacheableDataRequest('POST', new URL(`${base}/rest/v1/mova_appointments`))).toBe(false);
    expect(isCacheableDataRequest('PATCH', new URL(`${base}/rest/v1/mova_clients?id=eq.1`))).toBe(false);
    expect(isCacheableDataRequest('GET', new URL(`${base}/rest/v1/rpc/mova_secret`))).toBe(false);
    for (const path of ['/auth/v1/user', '/functions/v1/money-summary', '/storage/v1/object/private/x']) {
      expect(isCacheableDataRequest('GET', new URL(`${base}${path}`))).toBe(false);
    }
  });

  it('denies private Supabase/API paths from page caching', () => {
    const privatePaths = [
      '/functions/v1/private',
      '/rest/v1/private',
      '/auth/v1/user',
      '/storage/v1/object/private',
      '/graphql/v1/private',
    ];
    for (const path of privatePaths) {
      expect(PRIVATE_API_NAVIGATION_DENYLIST.some((pattern) => pattern.test(path))).toBe(true);
    }
  });
});
