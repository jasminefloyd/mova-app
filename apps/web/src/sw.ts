/// <reference lib="webworker" />
/**
 * Mova service worker.
 * - Precaches the app build, plus the offline page.
 * - Pages: network first; a page opened before is served from the cache when offline, otherwise /offline.html.
 * - Supabase reads (REST GETs): network first with a 7-day cache, so the schedule, clients and appointments
 *   last loaded stay readable offline. Writes are never cached or queued.
 * - Push: shows the stylist alert, updates the app badge, opens the right screen on tap.
 */
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { PRIVATE_API_NAVIGATION_DENYLIST, isCacheableDataRequest } from './pwa/cache-policy';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

export const PAGE_CACHE = 'mova-pages-v1';
export const DATA_CACHE = 'mova-data-v1';
const OFFLINE_URL = '/offline.html';

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

const pages = new NetworkFirst({
  cacheName: PAGE_CACHE,
  networkTimeoutSeconds: 4,
  plugins: [new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 7 * 24 * 60 * 60 }) as never],
});

registerRoute(
  ({ request, url }) => request.mode === 'navigate' && !PRIVATE_API_NAVIGATION_DENYLIST.some((pattern) => pattern.test(url.pathname)),
  async (options) => {
    try {
      const response = await pages.handle(options);
      if (response) return response;
    } catch { /* fall through to the offline page */ }
    return (await caches.match(OFFLINE_URL, { ignoreSearch: true })) ?? Response.error();
  },
);

registerRoute(
  ({ request, url }) => isCacheableDataRequest(request.method, url),
  new NetworkFirst({
    cacheName: DATA_CACHE,
    networkTimeoutSeconds: 6,
    plugins: [new ExpirationPlugin({ maxEntries: 400, maxAgeSeconds: 7 * 24 * 60 * 60 }) as never],
  }),
);

self.addEventListener('message', (event) => {
  const data = event.data as { type?: string } | null;
  if (data?.type === 'SKIP_WAITING') void self.skipWaiting();
  // Signing out wipes the saved pages and data from this device.
  if (data?.type === 'CLEAR_USER_CACHES') event.waitUntil(Promise.all([caches.delete(PAGE_CACHE), caches.delete(DATA_CACHE)]).then(() => undefined));
});

type PushPayload = { title?: string; body?: string; url?: string; tag?: string; badge?: number };

self.addEventListener('push', (event) => {
  let payload: PushPayload = {};
  try { payload = (event.data?.json() ?? {}) as PushPayload; } catch { payload = { body: event.data?.text() ?? '' }; }
  const title = payload.title || 'Mova';
  const badgeCount = typeof payload.badge === 'number' ? payload.badge : null;
  event.waitUntil((async () => {
    const nav = self.navigator as Navigator & { setAppBadge?: (count?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (badgeCount !== null) {
      try { if (badgeCount > 0) await nav.setAppBadge?.(badgeCount); else await nav.clearAppBadge?.(); } catch { /* badges are optional */ }
    }
    await self.registration.showNotification(title, {
      body: payload.body ?? '',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      ...(payload.tag ? { tag: payload.tag } : {}),
      data: { url: payload.url ?? '/login' },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data as { url?: string } | null)?.url ?? '/login', self.location.origin);
  // Only open pages on this site.
  const url = target.origin === self.location.origin ? target.href : `${self.location.origin}/login`;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) {
        await client.focus();
        if ('navigate' in client) await (client as WindowClient).navigate(url);
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
