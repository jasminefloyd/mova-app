import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { reactRouter } from '@react-router/dev/vite';
import { PWA_WORKBOX_POLICY } from './src/pwa/cache-policy.ts';
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
      strategies: 'generateSW',
      registerType: 'prompt',
      injectRegister: 'auto',
      includeAssets: ['icons/mova-192.svg', 'icons/mova-512.svg'],
      manifest: {
        id: '/',
        name: 'mova',
        short_name: 'mova',
        description: 'Your business moves with you.',
        start_url: '/auth',
        scope: '/',
        display: 'standalone',
        background_color: '#F7F5EF',
        theme_color: '#18392F',
        icons: [
          { src: '/icons/mova-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
          { src: '/icons/mova-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: PWA_WORKBOX_POLICY,
    }),
  ],
  server: { host: '0.0.0.0' },
});
