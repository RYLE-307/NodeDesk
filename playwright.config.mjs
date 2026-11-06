import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  timeout: 20000,
  use: { channel: process.env.NODEDESK_TEST_BROWSER || 'chromium', baseURL: 'http://127.0.0.1:1437', viewport: { width: 1600, height: 1100 } },
  webServer: { command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 1437', url: 'http://127.0.0.1:1437', reuseExistingServer: false },
});
