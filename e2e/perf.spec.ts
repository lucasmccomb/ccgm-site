import { expect, test } from '@playwright/test';

/**
 * Landing-page transfer-size budget (§5 E7 acceptance: "landing transfer
 * <300 KB excluding fonts"). Measures the sum of document + CSS + JS
 * transfer bytes for a fresh load of `/`, excluding anything under
 * /fonts/ -- fonts are self-hosted (§5 E1 fonts:sync) and cached
 * separately by the browser; this budget governs the page's own weight,
 * not the one-time font download.
 *
 * The 250 KB per-module-page inline-content budget (§5 E5) and the
 * Pagefind index budget (§5 E6) are already asserted elsewhere
 * (tests/unit/inline-budget.test.ts, tests/unit/pagefind-budget.test.ts)
 * and are not duplicated here.
 */

const LANDING_TRANSFER_BUDGET_BYTES = 300 * 1024;

test.describe('performance budgets', () => {
  test('landing page transfer size (document + CSS + JS, excluding fonts) stays under 300 KB', async ({
    page,
  }) => {
    const sizePromises: Promise<{ path: string; bytes: number }>[] = [];

    page.on('response', (response) => {
      const url = new URL(response.url());
      if (url.pathname.startsWith('/fonts/')) return;

      const resourceType = response.request().resourceType();
      if (resourceType !== 'document' && resourceType !== 'stylesheet' && resourceType !== 'script') return;

      sizePromises.push(
        response
          .request()
          .sizes()
          .then((sizes) => {
            // Prefer the wire size Chromium/WebKit actually measured for
            // this request; fall back to the declared Content-Length when
            // a timing entry isn't available (e.g. served from cache).
            const wireBytes = sizes.responseHeadersSize + sizes.responseBodySize;
            if (wireBytes > 0) return { path: url.pathname, bytes: wireBytes };
            const contentLength = response.headers()['content-length'];
            return { path: url.pathname, bytes: contentLength ? Number(contentLength) : 0 };
          })
          .catch(() => ({ path: url.pathname, bytes: 0 })),
      );
    });

    await page.goto('/', { waitUntil: 'networkidle' });

    const measurements = await Promise.all(sizePromises);
    const transferBytes = measurements.reduce((sum, m) => sum + m.bytes, 0);
    const breakdown = measurements.map((m) => `${m.path}: ${m.bytes} bytes`).join('\n');

    expect(
      transferBytes,
      `landing page transferred ${transferBytes} bytes across ${measurements.length} resource(s) (document+CSS+JS, excl. fonts):\n${breakdown}`,
    ).toBeLessThan(LANDING_TRANSFER_BUDGET_BYTES);
  });
});
