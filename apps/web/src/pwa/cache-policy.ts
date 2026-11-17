export const PRIVATE_API_NAVIGATION_DENYLIST = [
  /^\/functions\/v1\//,
  /^\/rest\/v1\//,
  /^\/auth\/v1\//,
  /^\/storage\/v1\//,
  /^\/graphql\/v1\//,
] as const;

/** Files precached by the service worker (the app build and /offline.html). */
export const PWA_PRECACHE_POLICY: { globPatterns: string[] } = {
  globPatterns: ['**/*.{css,html,ico,js,png,svg,webmanifest,woff2}'],
};

/**
 * Read-only offline (P4–P7): only Supabase table reads are kept, so the last schedule, clients and appointments
 * stay readable. Auth, edge functions (payments, messages, writes), storage and every non-GET request always go
 * to the network. The data cache is wiped on sign-out.
 */
export function isCacheableDataRequest(method: string, url: URL): boolean {
  return method === 'GET' && /^\/rest\/v1\/[a-z_]+$/.test(url.pathname);
}
