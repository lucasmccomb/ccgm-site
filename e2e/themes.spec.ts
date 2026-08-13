import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { DEFAULT_THEME, THEMES, type Theme } from '../src/lib/site.ts';

/**
 * The wrangler-served project (playwright.config.ts's "headers" project,
 * port 8788) is the only place `_headers`/CSP are actually enforced --
 * `astro preview` (this spec's default project, port 4321) never serves
 * `_headers` at all. This file is not named `headers.spec.ts`, so it runs
 * under the bulk chromium/webkit projects, not the "headers" project. The
 * one CSP-under-load test below therefore hits the wrangler port directly
 * by absolute URL: playwright.config.ts starts both webServers
 * unconditionally for every project, so port 8788 is already up.
 *
 * The port is overridable via E2E_PORT_HEADERS (see playwright.config.ts,
 * issue #14) so this spec still hits the right server under a parallel
 * worktree run.
 */
const HEADERS_ORIGIN = `http://localhost:${process.env.E2E_PORT_HEADERS ?? '8788'}`;

const STORAGE_KEY = 'ccgmTheme';

interface ThemeProbe {
  bodyFontFamily: string;
  displayFontFamily: string;
  layoutMax: string;
  spaceUnit: string;
}

async function probeTheme(page: import('@playwright/test').Page): Promise<ThemeProbe> {
  return page.evaluate(() => {
    const bodyStyle = getComputedStyle(document.body);
    const rootStyle = getComputedStyle(document.documentElement);
    return {
      bodyFontFamily: bodyStyle.fontFamily,
      displayFontFamily: rootStyle.getPropertyValue('--font-display').trim(),
      layoutMax: rootStyle.getPropertyValue('--layout-max').trim(),
      spaceUnit: rootStyle.getPropertyValue('--space-unit').trim(),
    };
  });
}

test.describe('theme candidates (?theme= review override, §3.5)', () => {
  for (const theme of THEMES) {
    test(`?theme=${theme} deep link sets data-theme`, async ({ page }) => {
      await page.goto(`/?theme=${theme}`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    });
  }

  test('each theme differs from the others in font-family and in layout tokens', async ({ page }) => {
    const probes = {} as Record<Theme, ThemeProbe>;
    for (const theme of THEMES) {
      await page.goto(`/?theme=${theme}`);
      probes[theme] = await probeTheme(page);
    }

    // The DISPLAY font is genuinely distinct across all three themes
    // (JetBrains Mono / Inter Variable / Newsreader Variable) -- checked
    // as a CSS custom property rather than the rendered `body` font,
    // because minimal and serif deliberately share Inter for BODY text
    // per §3.5 ("serif = ... Inter body"); asserting body font-family
    // pairwise-unique across all three would fail a spec-correct theme.
    const displayFonts = new Set(THEMES.map((t) => probes[t].displayFontFamily));
    expect(displayFonts.size, JSON.stringify(probes, null, 2)).toBe(THEMES.length);

    // The rendered body font still isn't a colour-only illusion: ascii's
    // monospace body must differ from the shared sans-serif body the
    // other two use.
    expect(probes.ascii.bodyFontFamily, JSON.stringify(probes, null, 2)).not.toBe(probes.minimal.bodyFontFamily);
    expect(probes.ascii.bodyFontFamily, JSON.stringify(probes, null, 2)).not.toBe(probes.serif.bodyFontFamily);

    // At least one layout-bearing token must differ per theme (§3.5) --
    // asserted here as a combined signature of both candidate tokens the
    // plan names, so a colour-only "theme" cannot pass by accident.
    const layoutSignatures = new Set(THEMES.map((t) => `${probes[t].layoutMax}|${probes[t].spaceUnit}`));
    expect(layoutSignatures.size, JSON.stringify(probes, null, 2)).toBe(THEMES.length);
  });

  test('in-session navigation preserves a ?theme= override via sessionStorage', async ({ page }) => {
    await page.goto('/?theme=serif');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'serif');

    // A different page, no ?theme= param: the override must survive via
    // sessionStorage, not just persist within the single page load.
    await page.goto('/404');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'serif');
  });

  test('a fresh context with no ?theme= param gets DEFAULT_THEME', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', DEFAULT_THEME);
  });

  for (const invalidValue of ['foo', '"><script>alert(1)</script>']) {
    test(`?theme=${JSON.stringify(invalidValue)} falls back to the default theme, persists nothing, no console error`, async ({
      page,
    }) => {
      const pageErrors: Error[] = [];
      page.on('pageerror', (error) => pageErrors.push(error));

      await page.goto(`/?theme=${encodeURIComponent(invalidValue)}`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', DEFAULT_THEME);

      const stored = await page.evaluate((key) => sessionStorage.getItem(key), STORAGE_KEY);
      expect(stored).toBeNull();
      expect(pageErrors).toEqual([]);
    });
  }

  test('a storage-denied context still renders fully themed with no uncaught error', async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    // Replace the sessionStorage getter with one that throws, before any
    // page script runs -- simulates Safari's "block all cookies" and
    // similar contexts where the accessor itself throws, not just its
    // methods.
    await page.addInitScript(() => {
      Object.defineProperty(window, 'sessionStorage', {
        get() {
          throw new Error('SecurityError: storage denied');
        },
        configurable: true,
      });
    });

    await page.goto('/');
    // Static default stands: the override script's storage access is
    // guarded, but the statically-rendered data-theme is untouched either
    // way.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'ascii');
    expect(pageErrors).toEqual([]);
  });

  test('the init script is inline and precedes the stylesheet link in built HTML', async ({ request }) => {
    const response = await request.get('/');
    const html = await response.text();

    const scriptIndex = html.indexOf('<script');
    const stylesheetIndex = html.indexOf('<link rel="stylesheet"');

    expect(scriptIndex).toBeGreaterThan(-1);
    expect(stylesheetIndex).toBeGreaterThan(-1);
    expect(scriptIndex).toBeLessThan(stylesheetIndex);
  });

  for (const theme of THEMES) {
    test(`${theme} theme has no horizontal overflow at a 375px viewport`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 700 });
      await page.goto(`/?theme=${theme}`);

      const { scrollWidth, viewportWidth } = await page.evaluate(() => ({
        scrollWidth: document.scrollingElement?.scrollWidth ?? 0,
        viewportWidth: window.innerWidth,
      }));

      const TOLERANCE_PX = 1;
      expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + TOLERANCE_PX);
    });
  }

  for (const theme of THEMES) {
    test(`${theme} theme: axe scan of / has zero critical/serious violations`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'chromium', 'one authoritative a11y run per theme is enough');

      await page.goto(`/?theme=${theme}`);
      const results = await new AxeBuilder({ page }).analyze();
      const seriousOrCritical = results.violations.filter(
        (violation) => violation.impact === 'serious' || violation.impact === 'critical',
      );

      expect(seriousOrCritical, JSON.stringify(seriousOrCritical, null, 2)).toEqual([]);
    });
  }

  for (const theme of THEMES) {
    test(`${theme} theme: landing page screenshot artifact`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'chromium', 'one screenshot per theme is enough for the HE3 pick');

      await page.goto(`/?theme=${theme}`);
      const screenshot = await page.screenshot({ fullPage: true });
      // Attached via testInfo so the Playwright HTML reporter bundles it
      // into playwright-report/ -- the directory ci.yml already uploads
      // as a CI artifact (no new workflow needed).
      await testInfo.attach(`theme-${theme}-landing.png`, {
        body: screenshot,
        contentType: 'image/png',
      });
    });
  }

  test('the ASCII banner node has role="img" and a non-empty aria-label', async ({ page }) => {
    await page.goto('/');
    const banner = page.locator('[role="img"]').first();
    await expect(banner).toHaveAttribute('aria-label', /.+/);
  });

  test('no theme-selection control exists in the shipped chrome', async ({ page }) => {
    await page.goto('/');
    const switcherLike = page.locator(
      [
        '[data-theme-switcher]',
        '[data-theme-select]',
        'select[name*="theme" i]',
        '[aria-label*="theme" i]',
        '[role="radiogroup"][aria-label*="theme" i]',
      ].join(', '),
    );
    await expect(switcherLike).toHaveCount(0);
  });

  test('zero CSP-violation console errors on / under the wrangler headers project', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'CSP console reporting is most reliable under Chromium');

    const cspViolations: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' && /content security policy/i.test(message.text())) {
        cspViolations.push(message.text());
      }
    });

    const response = await page.goto(`${HEADERS_ORIGIN}/`);
    expect(response?.ok()).toBeTruthy();
    await page.waitForLoadState('networkidle');

    expect(cspViolations).toEqual([]);
  });
});
