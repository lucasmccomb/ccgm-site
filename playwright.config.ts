import { defineConfig, devices } from '@playwright/test';

/**
 * Two server targets (§2 / §5 E1):
 *  - `astro preview` (4321) for the bulk suite -- fast, but serves no
 *    _headers, so it can never prove anything about the site's own CSP.
 *  - `wrangler pages dev dist` (8788) for the "headers" project -- the only
 *    place the site is ever exercised UNDER its production CSP/_headers.
 */
const BULK_PORT = 4321;
const HEADERS_PORT = 8788;
const BULK_BASE_URL = `http://localhost:${BULK_PORT}`;
const HEADERS_BASE_URL = `http://localhost:${HEADERS_PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  projects: [
    {
      name: 'chromium',
      testIgnore: /headers\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: BULK_BASE_URL,
        permissions: ['clipboard-read', 'clipboard-write'],
      },
    },
    {
      name: 'webkit',
      testIgnore: /headers\.spec\.ts/,
      use: {
        ...devices['Desktop Safari'],
        baseURL: BULK_BASE_URL,
      },
    },
    {
      name: 'headers',
      testMatch: /headers\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: HEADERS_BASE_URL,
      },
    },
  ],
  webServer: [
    {
      command: 'pnpm exec astro preview --port 4321',
      url: BULK_BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'pnpm exec wrangler pages dev dist --port 8788 --compatibility-date=2026-01-01',
      url: HEADERS_BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        WRANGLER_SEND_METRICS: 'false',
      },
    },
  ],
});
