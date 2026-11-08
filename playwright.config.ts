import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: 'corepack pnpm --filter @mova/web preview',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      // Answers Edge Function calls made by SSR loaders, which page.route cannot intercept.
      command: 'node tests/e2e/support/mock-edge.mjs',
      url: 'http://127.0.0.1:54321/health',
      reuseExistingServer: false,
      timeout: 10_000,
    },
  ],
});
