import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

if (process.env.TIQUI_MEDIA_PERF === '1') {
  process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve('.playwright-browsers');
}

export default defineConfig({
  testDir: process.env.TIQUI_MEDIA_PERF === '1' ? './tests/performance' : './tests/browser',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'node tests/server.js',
    url: 'http://127.0.0.1:4173/quiz.html',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
