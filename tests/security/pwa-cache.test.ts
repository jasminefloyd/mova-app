import { describe, expect, it } from 'vitest';
import { PRIVATE_API_NAVIGATION_DENYLIST, PWA_WORKBOX_POLICY } from '../../apps/web/src/pwa/cache-policy';

describe('service worker cache policy', () => {
  it('pre-caches static assets and defines no runtime response caching', () => {
    expect(PWA_WORKBOX_POLICY.globPatterns).toContain('**/*.{css,html,ico,js,png,svg,webmanifest,woff2}');
    expect('runtimeCaching' in PWA_WORKBOX_POLICY).toBe(false);
  });

  it('denies private Supabase/API paths from the app navigation fallback', () => {
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
