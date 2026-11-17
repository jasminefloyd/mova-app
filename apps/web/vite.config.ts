import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { reactRouter } from '@react-router/dev/vite';
import { PWA_PRECACHE_POLICY } from './src/pwa/cache-policy.ts';
import { fileURLToPath } from 'node:url';

const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  envDir: workspaceRoot,
  ssr: {
    // Keep React Router inside the server bundle. Vercel's Node function
    // packaging otherwise resolves react-router/dom to a missing CJS file.
    noExternal: ['react-router', 'react-router-dom'],
  },
  plugins: [
    reactRouter(),
    tailwindcss(),
    VitePWA({
      // Custom service worker (src/sw.ts): offline pages and reads, push notifications, app badge.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: 'auto',
      includeAssets: ['icons/*.png', 'offline.html'],
      manifest: {
        id: '/',
        name: 'Mova Beauty',
        short_name: 'Mova',
        description: 'Your business moves with you.',
        start_url: '/login',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#18392F',
        theme_color: '#18392F',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        ...PWA_PRECACHE_POLICY,
        globIgnores: ['splash/**', 'email/**', 'media/**', 'design-icons/**'],
      },
    }),
  ],
  server: { host: '0.0.0.0' },
});
