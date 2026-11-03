import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 20000,
  use: { baseURL: 'http://127.0.0.1:8000' },
  webServer: {
    command: '.venv/bin/python server.py',
    url: 'http://127.0.0.1:8000/replica.mjs',
    reuseExistingServer: false,
  },
});
