import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: 'embedding.spec.ts', timeout: 45000,
  outputDir: 'test-results-embedding',
  use: { baseURL: 'http://127.0.0.1:5198', browserName: 'chromium', viewport: { width: 1440, height: 900 } },
  webServer: { command: 'npm run start --prefix examples/next-host', url: 'http://127.0.0.1:5198', reuseExistingServer: false },
  reporter: 'list',
});
