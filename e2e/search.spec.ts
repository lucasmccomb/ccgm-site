import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { THEMES } from '../src/lib/site.ts';
import { mdTwinUrlFor } from '../src/lib/mdtwin.ts';

/**
 * `astro preview` (this spec's default project, port 4321) serves the same
 * dist/ output the "headers" project's `wrangler pages dev` does, but never
 * applies `_headers`/CSP -- so it can prove Pagefind *works*, but never that
 * it works UNDER the production CSP (Pagefind's search core is WASM;
 * `script-src` must carry `'wasm-unsafe-eval'` or WebAssembly.instantiate
 * throws). The one CSP-under-load test below hits the wrangler port
 * directly by absolute URL, the same pattern e2e/themes.spec.ts already
 * established -- playwright.config.ts starts both webServers
 * unconditionally for every project, so port 8788 is already up.
 */
const HEADERS_ORIGIN = 'http://localhost:8788';

async function waitForResults(page: Page): Promise<void> {
  await expect(page.locator('[data-search-status]')).not.toHaveText('', { timeout: 10_000 });
}

async function search(page: Page, query: string): Promise<void> {
  const input = page.locator('[data-search-input]');
  await input.click();
  await input.fill(query);
  await waitForResults(page);
}

test.describe('search: results and navigation', () => {
  test('typing "verification" surfaces the verification module page, and navigating lands on it', async ({
    page,
  }) => {
    await page.goto('/');
    await search(page, 'verification');

    const results = page.locator('[data-search-result]');
    await expect(results.first()).toBeVisible();

    const verificationResult = page.locator('[data-search-result-url="/modules/verification/"], [data-search-result-url="/modules/verification"]');
    await expect(verificationResult).toHaveCount(1);

    await verificationResult.locator('[data-search-result-link]').click();
    await expect(page).toHaveURL(/\/modules\/verification\/?$/);
    // Scoped to the module-header h1, not a bare `h1` locator: the
    // verification module's own README starts with a markdown "# verification"
    // H1, rendered (via set:html) as a second, un-scoped <h1> inside the page.
    await expect(page.locator('.module-header h1')).toContainText('verification', { ignoreCase: true });
  });

  test('a query matching ONLY inlined file-body text returns nothing (proves the ignore scoping holds)', async ({
    page,
  }) => {
    // _bash_command_prefix is defined only in modules/autoheal/lib/proposal-eval.py
    // (a file body, data-pagefind-ignore'd) and appears nowhere in any
    // module's README/description/tags -- verified by grepping the real
    // ingested clone before writing this test:
    //   grep -rl "_bash_command_prefix" modules/*/README.md modules/*/module.json
    //   -> no matches anywhere in the real ccgm repo.
    await page.goto('/');
    await search(page, '_bash_command_prefix');

    await expect(page.locator('[data-search-result]')).toHaveCount(0);
    await expect(page.locator('[data-search-status]')).toHaveText('No results for "_bash_command_prefix"');
  });

  test('"/" focuses the search input, and does not fire while an editable element already has focus', async ({
    page,
  }) => {
    await page.goto('/');
    const input = page.locator('[data-search-input]');
    await expect(input).not.toBeFocused();

    await page.keyboard.press('/');
    await expect(input).toBeFocused();

    // Typing "/" a second time, now that focus is already inside the
    // (editable) input, must be treated as a literal character, not
    // re-trigger the shortcut and clobber the field.
    await input.fill('');
    await page.keyboard.type('a/b');
    await expect(input).toHaveValue('a/b');
  });

  test('Escape clears an in-progress query and hides the results list', async ({ page }) => {
    await page.goto('/');
    await search(page, 'verification');
    await expect(page.locator('[data-search-result]').first()).toBeVisible();

    await page.locator('[data-search-input]').press('Escape');
    await expect(page.locator('[data-search-input]')).toHaveValue('');
    await expect(page.locator('[data-search-results]')).toBeHidden();
  });
});

test.describe('search: result-snippet safety (real corpus, no unsanitized innerHTML)', () => {
  test('a query whose result snippet contains HTML-tag-like text renders it as inert text, not a live element', async ({
    page,
  }) => {
    // branch-guard/README.md contains the literal, backtick-quoted text
    // `<workflow-reminder>` describing enforce-issue-workflow.py's advisory
    // reminder -- markdown-it (html:false) renders this as escaped text
    // inside a <code> span, and Pagefind indexes it as plain content. This
    // is the real-corpus analogue of the fixture XSS pattern: a distinctive
    // term whose surrounding text looks like an HTML tag. Confirmed unique
    // to this module via `grep -rl workflow-reminder modules/*/README.md`
    // against the real repo before writing this test.
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });

    await page.goto('/');
    await search(page, 'workflow-reminder');

    const result = page.locator('[data-search-result]').first();
    await expect(result).toBeVisible();

    const excerpt = result.locator('[data-search-result-excerpt]');
    // The tag-like text must be visible as literal characters in the
    // rendered DOM (a real <workflow-reminder> element must never exist)...
    await expect(excerpt).toContainText('workflow-reminder');
    const liveElement = excerpt.locator('workflow-reminder');
    await expect(liveElement).toHaveCount(0);
    // ...and no script tag may have been injected into the excerpt either.
    await expect(excerpt.locator('script')).toHaveCount(0);

    expect(dialogs, 'no dialog (alert/confirm/prompt) fired while rendering the snippet').toEqual([]);
  });

  test('a crafted query containing an actual script tag never executes and never survives as a live element anywhere on the page', async ({
    page,
  }) => {
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });

    await page.goto('/');
    // This exact string will not match any indexed content (no results),
    // but it exercises the full render path end to end -- if the query
    // itself were ever echoed back unescaped anywhere (e.g. into the
    // status live region), this is what would catch it.
    await search(page, '<script>window.__xss = true</script>');

    const executed = await page.evaluate(() => (window as unknown as { __xss?: boolean }).__xss);
    expect(executed).toBeUndefined();
    expect(dialogs).toEqual([]);
    await expect(page.locator('script:has-text("__xss")')).toHaveCount(0);
  });
});

test.describe('search: progressive enhancement (no JS)', () => {
  test.use({ javaScriptEnabled: false });

  test('the catalog is fully navigable without JavaScript, and the search input renders as a harmless, inert element', async ({
    page,
  }) => {
    await page.goto('/modules');

    const firstCard = page.locator('[data-module-card] a').first();
    await expect(firstCard).toBeVisible();
    const href = await firstCard.getAttribute('href');
    expect(href).toBeTruthy();

    await firstCard.click();
    await expect(page).not.toHaveURL(/\/modules\/?$/);

    // The search input is present and does nothing -- no broken layout, no
    // results list left stuck open, no console error.
    await page.goto('/');
    const input = page.locator('[data-search-input]');
    await expect(input).toBeVisible();
    await expect(page.locator('[data-search-results]')).toBeHidden();
  });
});

test.describe('search under the production CSP (wrangler pages dev, port 8788)', () => {
  test('a real query against the CSP-enforced deployment returns results with zero CSP-violation console errors', async ({
    page,
  }) => {
    const cspViolations: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' && /content security policy/i.test(message.text())) {
        cspViolations.push(message.text());
      }
    });

    const response = await page.goto(`${HEADERS_ORIGIN}/`);
    expect(response?.ok()).toBeTruthy();

    await search(page, 'verification');
    await expect(page.locator('[data-search-result]').first()).toBeVisible({ timeout: 10_000 });

    expect(cspViolations, 'zero CSP-violation console errors while Pagefind (WASM) ran a real query').toEqual([]);
  });
});

test.describe('404 page', () => {
  test('serves for a bogus path, is themed, and links to the catalog and search', async ({ page }) => {
    const response = await page.goto('/this-page-does-not-exist-at-all');
    expect(response?.status()).toBe(404);

    await expect(page.locator('html')).toHaveAttribute('data-theme', /.+/);
    await expect(page.locator('h1')).toContainText('not found', { ignoreCase: true });

    const catalogLink = page.locator('[data-not-found] a[href="/modules"]');
    await expect(catalogLink).toBeVisible();

    const searchLink = page.locator('[data-not-found] a[href="#site-search-input"]');
    await expect(searchLink).toBeVisible();
    await searchLink.click();
    await expect(page.locator('[data-search-input]')).toBeFocused();
  });

  for (const theme of THEMES) {
    test(`${theme} theme: axe scan of 404 has zero critical/serious violations`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'chromium', 'one authoritative a11y run per theme is enough');

      await page.goto(`/this-page-does-not-exist-at-all?theme=${theme}`);
      const results = await new AxeBuilder({ page }).analyze();
      const seriousOrCritical = results.violations.filter(
        (violation) => violation.impact === 'serious' || violation.impact === 'critical',
      );
      expect(seriousOrCritical, JSON.stringify(seriousOrCritical, null, 2)).toEqual([]);
    });
  }
});

test.describe('skip link', () => {
  test('is the first tab stop on the page and moves focus to <main> when activated', async ({
    page,
    browserName,
  }) => {
    // WebKit (headless, no real Safari "Full Keyboard Access" session) does
    // not tab-focus links by default -- a browser-engine default, not a
    // property of this page. The href/DOM-order assertions below (which
    // this test still runs under webkit for) already prove the skip link
    // is correctly the first element and points at #main-content;
    // Chromium proves the actual Tab-focus behavior end to end.
    await page.goto('/');

    const skipLink = page.locator('.skip-link');
    await expect(skipLink).toHaveAttribute('href', '#main-content');

    test.skip(browserName === 'webkit', 'WebKit does not tab-focus links by default outside a real Safari session');

    await page.keyboard.press('Tab');
    await expect(skipLink).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();
  });
});

test.describe('view as Markdown link', () => {
  const pageTypes: Array<{ label: string; path: string }> = [
    { label: 'landing', path: '/' },
    { label: 'install', path: '/install' },
    { label: 'agents', path: '/agents' },
    { label: 'catalog', path: '/modules' },
    { label: 'module detail', path: '/modules/verification' },
  ];

  for (const { label, path } of pageTypes) {
    test(`${label} page (${path}) carries a "View as Markdown" link that resolves 200 with the expected twin URL`, async ({
      page,
      request,
    }) => {
      await page.goto(path);
      const link = page.locator('[data-view-as-markdown]');
      await expect(link).toBeVisible();

      const href = await link.getAttribute('href');
      expect(href).toBe(mdTwinUrlFor(path));

      const twinResponse = await request.get(href!);
      expect(twinResponse.ok(), `${href} should resolve 200`).toBeTruthy();
      expect(twinResponse.headers()['content-type'] ?? '').toContain('text/markdown');
    });
  }

  test('a page with no twin (404) omits the link entirely', async ({ page }) => {
    await page.goto('/this-page-does-not-exist-at-all');
    await expect(page.locator('[data-view-as-markdown]')).toHaveCount(0);
  });
});

test.describe('a11y sweep (E6-owned): /install, /agents, a mixed inline/preview module page, across all three themes', () => {
  for (const theme of THEMES) {
    test(`${theme} theme: axe scan of /install has zero critical/serious violations`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'chromium', 'one authoritative a11y run per theme is enough');

      await page.goto(`/install?theme=${theme}`);
      const results = await new AxeBuilder({ page }).analyze();
      const seriousOrCritical = results.violations.filter(
        (violation) => violation.impact === 'serious' || violation.impact === 'critical',
      );
      expect(seriousOrCritical, JSON.stringify(seriousOrCritical, null, 2)).toEqual([]);
    });
  }

  for (const theme of THEMES) {
    test(`${theme} theme: axe scan of /agents has zero critical/serious violations`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'chromium', 'one authoritative a11y run per theme is enough');

      await page.goto(`/agents?theme=${theme}`);
      const results = await new AxeBuilder({ page }).analyze();
      const seriousOrCritical = results.violations.filter(
        (violation) => violation.impact === 'serious' || violation.impact === 'critical',
      );
      expect(seriousOrCritical, JSON.stringify(seriousOrCritical, null, 2)).toEqual([]);
    });
  }

  for (const theme of THEMES) {
    test(`${theme} theme: axe scan of a module detail page with a MIXED inline/preview file set (autoheal) has zero critical/serious violations, every file-type section EXPANDED`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== 'chromium', 'one authoritative a11y run per theme is enough');

      // autoheal (39 files, hook/lib/script-heavy) mixes inlined and
      // over-the-64KB-cap preview files, unlike E5's verification-only
      // axe coverage (verification is small enough that every file
      // inlines -- it never exercises the preview-state markup at all).
      await page.goto(`/modules/autoheal?theme=${theme}`);

      const detailsSections = page.locator('details[data-file-type-section]');
      const count = await detailsSections.count();
      for (let i = 0; i < count; i++) {
        await detailsSections.nth(i).evaluate((el) => {
          (el as HTMLDetailsElement).open = true;
        });
      }

      const results = await new AxeBuilder({ page }).analyze();
      const seriousOrCritical = results.violations.filter(
        (violation) => violation.impact === 'serious' || violation.impact === 'critical',
      );
      expect(seriousOrCritical, JSON.stringify(seriousOrCritical, null, 2)).toEqual([]);
    });
  }
});

test.describe('search results, styled per theme via semantic tokens', () => {
  for (const theme of THEMES) {
    test(`${theme} theme: search results render using themed tokens, not hardcoded colors`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'chromium', 'one authoritative check per theme is enough');

      await page.goto(`/?theme=${theme}`);
      await search(page, 'verification');
      await expect(page.locator('[data-search-result]').first()).toBeVisible();

      const border = await page
        .locator('[data-search-results]')
        .evaluate((el) => getComputedStyle(el).borderColor);
      expect(border).toBeTruthy();
    });
  }
});
