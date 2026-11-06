import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: [
      { find: /^react$/, replacement: resolve(import.meta.dirname, 'node_modules/react/index.js') },
      { find: /^react\/jsx-runtime$/, replacement: resolve(import.meta.dirname, 'node_modules/react/jsx-runtime.js') },
      { find: /^react\/jsx-dev-runtime$/, replacement: resolve(import.meta.dirname, 'node_modules/react/jsx-dev-runtime.js') },
      { find: /^react-dom\/server$/, replacement: resolve(import.meta.dirname, 'node_modules/react-dom/server.node.js') },
    ],
  },
  test: {
    environment: 'jsdom',
    include: ['apps/web/src/**/*.test.ts', 'apps/web/src/**/*.test.tsx', 'packages/domain/src/**/*.test.ts', 'tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx', 'tests/security/**/*.test.ts', 'supabase/functions/_shared/**/*.test.ts'],
    restoreMocks: true,
    clearMocks: true,
  },
});
