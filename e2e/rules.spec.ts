import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { seriousOrCriticalViolations } from './axe.ts';
import { MAX_INLINE_FILE_BYTES } from '../src/lib/inline-budget.ts';
import { buildRuleTwin, collectRules, type RuleRecord } from '../src/lib/rules.ts';
import { rulesStatsLine } from '../src/lib/rulespagecopy.ts';
import { SITE_URL, THEMES } from '../src/lib/site.ts';
import { CATEGORY_VALUES, type ModulesIndex } from '../src/lib/schema.ts';

/**
 * The FULL ingested index (src/generated/modules-index.json), not the
 * public-facing trimmed /modules.json -- this file still carries
 * contentFiles, which collectRules()/buildRuleTwin() need to independently
 * reconstruct what the live pages computed.
 */
function readModulesIndex(): ModulesIndex {
  const path = join(process.cwd(), 'src', 'generated', 'modules-index.json');
  if (!existsSync(path)) {
    throw new Error('src/generated/modules-index.json does not exist -- run `pnpm build` before `pnpm test:e2e`');
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function allRules(): RuleRecord[] {
  return collectRules(readModulesIndex().modules);
}

/**
 * A small, deterministic sample for the per-page checks: the first rule,
 * the last, the largest by bytes, and the extremes of title and declared
 * path length -- the two the 375px sweep would otherwise miss, since a
 * per-page overflow comes from a long unbroken string, not from file size.
 * Derived from the data rather than hardcoded module names, so a ccgm
 * census change re-picks the sample instead of reding the suite.
 */
function sampleRules(rules: RuleRecord[]): RuleRecord[] {
  const longestBy = (measure: (rule: RuleRecord) => number): RuleRecord =>
    [...rules].sort((a, b) => measure(b) - measure(a))[0];

  const picked = [
    rules[0],
    rules[rules.length - 1],
    longestBy((rule) => rule.bytes),
    longestBy((rule) => rule.title.length),
    longestBy((rule) => rule.path.length),
  ];
  return [...new Map(picked.map((rule) => [rule.url, rule])).values()];
}

test.describe('rules index (/rules)', () => {
  test('renders one row per rule file in the ingested index, and category section counts sum to that total', async ({
    page,
  }) => {
    const rules = allRules();
    expect(rules.length).toBeGreaterThan(0);

    await page.goto('/rules');

    await expect(page.locator('[data-rule-row]')).toHaveCount(rules.length);

    const sections = page.locator('[data-rule-category-section]');
    await expect(sections).toHaveCount(CATEGORY_VALUES.length);

    let sum = 0;
    for (const category of CATEGORY_VALUES) {
      const section = page.locator(`[data-rule-category-section][data-category="${category}"]`);
      sum += Number(await section.getAttribute('data-category-count'));
    }
    expect(sum).toBe(rules.length);
  });

  test('the stats line reports the live counts, never a literal', async ({ page }) => {
    const rules = allRules();
    const moduleCount = new Set(rules.map((rule) => rule.moduleName)).size;

    await page.goto('/rules');
    await expect(page.locator('[data-rules-stats]')).toHaveText(
      rulesStatsLine(rules.length, moduleCount, CATEGORY_VALUES.length),
    );
  });

  test('every row names its module and declared path, and links to a page that resolves', async ({
    page,
    request,
  }) => {
    const rules = allRules();
    await page.goto('/rules');

    const failures: string[] = [];
    for (const rule of rules) {
      const row = page.locator(
        `[data-rule-row][data-rule-module="${rule.moduleName}"][data-rule-path="${rule.path}"]`,
      );
      await expect(row, `no row for ${rule.moduleName}/${rule.path}`).toHaveCount(1);
      await expect(row.locator('[data-rule-module-link]')).toHaveAttribute(
        'href',
        `/modules/${rule.moduleName}`,
      );
      await expect(row.locator('a').first()).toHaveAttribute('href', rule.url);

      const response = await request.get(rule.url);
      if (!response.ok()) failures.push(`${rule.url} -> ${response.status()}`);
    }
    expect(failures).toEqual([]);
  });

  test('the footer "view as Markdown" link points at the index twin', async ({ page }) => {
    await page.goto('/rules');
    await expect(page.locator('[data-view-as-markdown]')).toHaveAttribute('href', '/rules/index.md');
  });

  test('the landing page section nav links to the rules surface', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: 'Site sections' }).getByRole('link', { name: 'Rules' })).toHaveAttribute(
      'href',
      '/rules',
    );
  });

  test('renders every row with JavaScript disabled', async ({ browser }) => {
    const rules = allRules();
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    await page.goto('/rules');
    await expect(page.locator('[data-rule-row]')).toHaveCount(rules.length);
    await expect(page.locator('[data-rule-category-section]')).toHaveCount(CATEGORY_VALUES.length);

    await context.close();
  });
});

test.describe('rule detail pages (/rules/{module}/{slug})', () => {
  test('a rule page renders its title, module link, declared path, raw link, and source link', async ({ page }) => {
    for (const rule of sampleRules(allRules())) {
      await page.goto(rule.url);

      await expect(page.getByRole('heading', { level: 1, name: rule.title })).toBeVisible();
      await expect(page.locator('[data-rule-module-link]')).toHaveAttribute('href', `/modules/${rule.moduleName}`);
      await expect(page.locator('[data-rule-path]')).toHaveText(rule.path);
      await expect(page.locator('[data-rule-raw-link]')).toHaveAttribute('href', rule.rawUrl);
      await expect(page.locator('[data-rule-source-link]')).toHaveAttribute('href', rule.sourceUrl);
      await expect(page.locator('[data-view-as-markdown]')).toHaveAttribute('href', rule.twinUrl);
    }
  });

  test('the body is inlined exactly when the shared per-file inline cap allows it', async ({ page }) => {
    for (const rule of sampleRules(allRules())) {
      await page.goto(rule.url);

      const expected = rule.bytes <= MAX_INLINE_FILE_BYTES;
      await expect(page.locator('[data-rule-body-section]')).toHaveAttribute(
        'data-rule-inlined',
        expected ? 'true' : 'false',
      );
      await expect(page.locator('[data-rule-preview]')).toHaveCount(expected ? 0 : 1);
      await expect(page.locator('[data-rule-truncated-note]')).toHaveCount(expected ? 0 : 1);
    }
  });

  test('the merge-fragment annotation appears exactly when the record says the rule is one', async ({ page }) => {
    for (const rule of sampleRules(allRules())) {
      await page.goto(rule.url);
      await expect(page.locator('[data-merge-annotation]')).toHaveCount(rule.isMergeFragment ? 1 : 0);
      await expect(page.locator('[data-placeholder-annotation]')).toHaveCount(
        rule.hasSubstitutionPlaceholders ? 1 : 0,
      );
    }
  });

  test('the rule body copies byte-exact against the raw endpoint', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'real clipboard read-back needs Chromium/CDP');

    for (const rule of sampleRules(allRules())) {
      const rawResponse = await request.get(rule.rawUrl);
      expect(rawResponse.ok(), `raw endpoint for ${rule.rawUrl}`).toBeTruthy();
      const expected = await rawResponse.text();

      await page.goto(rule.url);
      const button = page.locator('[data-copy-button]');
      await button.click();
      await expect(button).toHaveAttribute('data-state', 'copied', { timeout: 5000 });

      const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
      expect(clipboardText, `${rule.url} clipboard vs ${rule.rawUrl}`).toBe(expected);
    }
  });
});

test.describe('rules machine surface', () => {
  test('/rules/index.md and every rule twin resolve as text/markdown', async ({ request }) => {
    const indexResponse = await request.get('/rules/index.md');
    expect(indexResponse.ok()).toBeTruthy();
    expect(indexResponse.headers()['content-type'] ?? '').toMatch(/text\/markdown/);

    const failures: string[] = [];
    for (const rule of allRules()) {
      const response = await request.get(rule.twinUrl);
      if (!response.ok()) {
        failures.push(`${rule.twinUrl} -> ${response.status()}`);
        continue;
      }
      if (!/text\/markdown/.test(response.headers()['content-type'] ?? '')) {
        failures.push(`${rule.twinUrl} -> wrong content type`);
      }
    }
    expect(failures).toEqual([]);
  });

  test('a served rule twin equals an independently recomputed buildRuleTwin(), byte for byte', async ({
    request,
  }) => {
    const index = readModulesIndex();
    for (const rule of sampleRules(collectRules(index.modules))) {
      const expected = buildRuleTwin(rule, {
        siteUrl: SITE_URL,
        sourceSha: index.meta.sourceSha,
        frontMatter: {
          schemaVersion: index.meta.schemaVersion,
          module: rule.moduleName,
          rule: rule.path,
          sourceSha: index.meta.sourceSha,
          generatedAt: index.meta.generatedAt,
        },
      });

      const response = await request.get(rule.twinUrl);
      expect(response.ok()).toBeTruthy();
      expect(await response.text(), `${rule.twinUrl}: served twin vs recomputed twin`).toBe(expected.text);
    }
  });
});

test.describe('rules surface: cross-theme rendering', () => {
  for (const theme of THEMES) {
    test(`${theme} theme: axe scan of /rules has zero critical/serious violations`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'chromium', 'one authoritative a11y run per theme is enough');

      await page.goto(`/rules?theme=${theme}`);
      const seriousOrCritical = await seriousOrCriticalViolations(page);
      expect(seriousOrCritical, JSON.stringify(seriousOrCritical, null, 2)).toEqual([]);
    });
  }

  for (const theme of THEMES) {
    test(`${theme} theme: axe scan of a rule detail page has zero critical/serious violations`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== 'chromium', 'one authoritative a11y run per theme is enough');

      const [rule] = sampleRules(allRules());
      await page.goto(`${rule.url}?theme=${theme}`);
      const seriousOrCritical = await seriousOrCriticalViolations(page);
      expect(seriousOrCritical, JSON.stringify(seriousOrCritical, null, 2)).toEqual([]);
    });
  }

  for (const theme of THEMES) {
    test(`${theme} theme: /rules and every sampled rule page have no horizontal overflow at 375px`, async ({
      page,
    }) => {
      // Every sampled detail page, not just the first: the index covers
      // the longest declared path (it renders every row), but a per-page
      // overflow from an unusually long title or path only shows on the
      // page that carries it.
      const paths = ['/rules', ...sampleRules(allRules()).map((rule) => rule.url)];
      await page.setViewportSize({ width: 375, height: 700 });

      for (const path of paths) {
        await page.goto(`${path}?theme=${theme}`);
        const { scrollWidth, viewportWidth } = await page.evaluate(() => ({
          scrollWidth: document.scrollingElement?.scrollWidth ?? 0,
          viewportWidth: window.innerWidth,
        }));

        const TOLERANCE_PX = 1;
        expect(scrollWidth, `${path} under ${theme}`).toBeLessThanOrEqual(viewportWidth + TOLERANCE_PX);
      }
    });
  }
});
