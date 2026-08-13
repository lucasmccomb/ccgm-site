import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * Runs only against the "headers" project (wrangler pages dev dist), the
 * one place _headers/CSP are actually applied to a running site.
 *
 * E1 scoped this spec to what existed then: the CSP, discovery headers,
 * nosniff, Referrer-Policy, and Permissions-Policy on `/`. E2 adds the
 * content-type assertions for the machine surface it ships: /llms.txt,
 * /llms-full.txt, a .md twin, /modules.json, and a raw per-file .txt
 * endpoint.
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

  test('/llms.txt is served as text/plain', async ({ request }) => {
    const response = await request.get('/llms.txt');
    expect(response.ok()).toBeTruthy();
    expect(response.headers()['content-type']).toContain('text/plain');
  });

  test('/llms-full.txt is served as text/plain', async ({ request }) => {
    const response = await request.get('/llms-full.txt');
    expect(response.ok()).toBeTruthy();
    expect(response.headers()['content-type']).toContain('text/plain');
  });

  test('a .md twin is served as text/markdown with X-Robots-Tag: noindex', async ({ request }) => {
    const response = await request.get('/modules/index.md');
    expect(response.ok()).toBeTruthy();
    const headers = response.headers();
    expect(headers['content-type']).toContain('text/markdown');
    expect(headers['x-robots-tag']).toContain('noindex');
  });

  test('/modules.json is served as application/json', async ({ request }) => {
    const response = await request.get('/modules.json');
    expect(response.ok()).toBeTruthy();
    expect(response.headers()['content-type']).toContain('application/json');
  });

  test('/presets.json is served as application/json', async ({ request }) => {
    const response = await request.get('/presets.json');
    expect(response.ok()).toBeTruthy();
    expect(response.headers()['content-type']).toContain('application/json');
  });

  test('a raw per-file endpoint (discovered via /modules.json) is served as text/plain', async ({ request }) => {
    const indexResponse = await request.get('/modules.json');
    expect(indexResponse.ok()).toBeTruthy();
    const index = (await indexResponse.json()) as { modules: Array<{ files: Array<{ rawUrl: string }> }> };
    const rawUrl = index.modules.find((m) => m.files.length > 0)?.files[0]?.rawUrl;
    expect(rawUrl).toBeTruthy();

    const fileResponse = await request.get(rawUrl!);
    expect(fileResponse.ok()).toBeTruthy();
    expect(fileResponse.headers()['content-type']).toContain('text/plain');
  });
});
