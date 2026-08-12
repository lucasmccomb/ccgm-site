import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * Runs only against the "headers" project (wrangler pages dev dist), the
 * one place _headers/CSP are actually applied to a running site.
 *
 * Content-type assertions for /llms.txt, /llms-full.txt, and .md twins
 * activate in E2 once those routes exist -- E1 scopes this spec to what
 * exists today: the CSP, discovery headers, nosniff, Referrer-Policy, and
 * Permissions-Policy on `/`, all emitted unconditionally by
 * scripts/gen-headers.ts regardless of which routes are built yet.
 */

test.describe('headers (wrangler pages dev, production _headers applied)', () => {
  test('/ responds with the expected security + discovery headers', async ({ request }) => {
    const response = await request.get('/');
    expect(response.ok()).toBeTruthy();
    const headers = response.headers();

    expect(headers['content-security-policy']).toContain("default-src 'self'");
    expect(headers['content-security-policy']).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['permissions-policy']).toContain('camera=()');
    expect(headers['x-llms-txt']).toContain('/llms.txt');
    expect(headers['link']).toContain('rel="llms-txt"');
  });

  test('/ loads with zero CSP-violation console errors', async ({ page }) => {
    const cspViolations: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' && /content security policy/i.test(message.text())) {
        cspViolations.push(message.text());
      }
    });

    const response = await page.goto('/');
    expect(response?.ok()).toBeTruthy();
    await page.waitForLoadState('networkidle');

    expect(cspViolations).toEqual([]);
  });

  test('scripts/verify-headers.sh passes against this deployment', async ({ baseURL }) => {
    const scriptPath = join(process.cwd(), 'scripts', 'verify-headers.sh');
    expect(() => {
      execFileSync('bash', [scriptPath, baseURL!], { stdio: 'pipe' });
    }).not.toThrow();
  });
});
