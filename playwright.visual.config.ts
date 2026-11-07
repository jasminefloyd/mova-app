import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/visual',
  snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}{ext}',
  fullyParallel: false,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'corepack pnpm --filter @mova/web test:visual:server',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
