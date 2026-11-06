export const PRIVATE_API_NAVIGATION_DENYLIST = [
  /^\/functions\/v1\//,
  /^\/rest\/v1\//,
  /^\/auth\/v1\//,
  /^\/storage\/v1\//,
  /^\/graphql\/v1\//,
] as const;

export const PWA_WORKBOX_POLICY = {
  cacheId: 'mova-app',
  globPatterns: ['**/*.{css,html,ico,js,png,svg,webmanifest,woff2}'],
  navigateFallback: '/index.html',
  navigateFallbackDenylist: [...PRIVATE_API_NAVIGATION_DENYLIST],
  cleanupOutdatedCaches: true,
  clientsClaim: false,
  skipWaiting: false,
};
