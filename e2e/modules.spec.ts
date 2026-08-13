import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { THEMES } from '../src/lib/site.ts';
import { CATEGORY_VALUES } from '../src/lib/schema.ts';
import { cappedBundleLabel, FULL_BUNDLE_LABEL } from '../src/lib/module-bundle.ts';
import {
  MERGE_FRAGMENT_ANNOTATION,
  MERGE_FRAGMENT_COPY_LABEL,
  PLACEHOLDER_ANNOTATION,
  WILL_INSTALL_MERGE_ACTION,
  ZERO_COST_BADGE_TEXT,
} from '../src/lib/modulepagecopy.ts';

interface ModulesIndexModule {
  name: string;
  displayName: string;
  category: string;
  status?: string;
  tags: string[];
  contextCostTokens: number;
  files: Array<{ path: string; rawUrl: string; merge: boolean }>;
}

interface ModulesIndex {
  meta: { moduleCount: number; categories: Record<string, number> };
  modules: ModulesIndexModule[];
}

function readModulesIndex(): ModulesIndex {
  const path = join(process.cwd(), 'src', 'generated', 'modules-index.json');
  if (!existsSync(path)) {
    throw new Error('src/generated/modules-index.json does not exist -- run `pnpm build` before `pnpm test:e2e`');
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/** The real module.json's own `files` keys, read from the ingested clone -- NOT the site's emitted JSON (§5 E5: comparing a filter's output against itself proves nothing). */
function readRealModuleFileKeys(moduleName: string): string[] {
  const path = join(process.cwd(), '.ccgm-src', 'modules', moduleName, 'module.json');
  if (!existsSync(path)) {
    throw new Error(
      `.ccgm-src/modules/${moduleName}/module.json does not exist -- run \`pnpm build\` (real ingest) before \`pnpm test:e2e\``,
    );
  }
  const manifest = JSON.parse(readFileSync(path, 'utf-8')) as { files: Record<string, unknown> };
  return Object.keys(manifest.files);
}

async function openDetailsFor(page: Page, filePath: string): Promise<void> {
  const details = page.locator(`details[data-file-type-section]:has([data-file-entry][data-file-path="${filePath}"])`);
  await details.evaluate((el) => {
    (el as HTMLDetailsElement).open = true;
  });
}

/** Round-trips a single file's copy button against the raw per-file endpoint -- works for both the inlined (targetId) and non-inlined (sourceUrl fetch) CopyButton modes, since the assertion only cares about the resulting clipboard content. */
async function expectFileCopyByteExact(
  page: Page,
  request: APIRequestContext,
  moduleName: string,
  filePath: string,
): Promise<void> {
  const rawResponse = await request.get(`/modules/${moduleName}/files/${filePath}.txt`);
  expect(rawResponse.ok(), `raw endpoint for ${moduleName}/${filePath}`).toBeTruthy();
  const expected = await rawResponse.text();

  await openDetailsFor(page, filePath);
  const entry = page.locator(`[data-file-entry][data-file-path="${filePath}"]`);
  const button = entry.locator('[data-copy-button]');
  await button.click();
  await expect(button).toHaveAttribute('data-state', 'copied', { timeout: 5000 });

  const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboardText).toBe(expected);
}

async function expectMergeTreatment(page: Page, filePath: string): Promise<void> {
  await openDetailsFor(page, filePath);
  const entry = page.locator(`[data-file-entry][data-file-path="${filePath}"]`);
  await expect(entry).toHaveAttribute('data-file-merge', 'true');
  await expect(entry.locator('[data-merge-annotation]')).toHaveText(MERGE_FRAGMENT_ANNOTATION);
  await expect(entry.locator('[data-copy-label]')).toHaveText(MERGE_FRAGMENT_COPY_LABEL);

  const row = page.locator(`[data-will-install-row][data-file-path="${filePath}"]`);
  await expect(row).toHaveAttribute('data-merge', 'true');
  await expect(row.locator('[data-action]')).toHaveText(WILL_INSTALL_MERGE_ACTION);
}

async function expectPlaceholderAnnotation(page: Page, filePath: string, expected: boolean): Promise<void> {
  const entry = page.locator(`[data-file-entry][data-file-path="${filePath}"]`);
  await expect(entry).toHaveAttribute('data-file-placeholder', expected ? 'true' : 'false');
  if (expected) {
    await expect(entry.locator('[data-placeholder-annotation]')).toHaveText(PLACEHOLDER_ANNOTATION);
  } else {
    await expect(entry.locator('[data-placeholder-annotation]')).toHaveCount(0);
  }
}

const DEEP_CHECK_MODULES = ['verification', 'autoheal', 'dreaming', 'remote-server', 'agent-manager'];

test.describe('module catalog (/modules)', () => {
  test('renders one card per record in modules.json, and category section counts sum to that total', async ({
    page,
  }) => {
    const index = readModulesIndex();
    await page.goto('/modules');

    const cards = page.locator('[data-module-card]');
    await expect(cards).toHaveCount(index.modules.length);

    const sections = page.locator('[data-category-section]');
    await expect(sections).toHaveCount(CATEGORY_VALUES.length);

    let sum = 0;
    for (const category of CATEGORY_VALUES) {
      const section = page.locator(`[data-category-section][data-category="${category}"]`);
      const countAttr = await section.getAttribute('data-category-count');
      sum += Number(countAttr);
    }
    expect(sum).toBe(index.modules.length);
  });

  test('tag filter: clicking a chip hides cards without that tag; the clear button restores every card', async ({
    page,
  }) => {
    const index = readModulesIndex();
    await page.goto('/modules');

    const chips = page.locator('[data-tag-chip]');
    const chipCount = await chips.count();
    test.skip(chipCount === 0, 'no tags present in this build');

    const firstChip = chips.first();
    const tag = await firstChip.getAttribute('data-tag');
    expect(tag).toBeTruthy();

    await firstChip.click();
    await expect(firstChip).toHaveAttribute('aria-pressed', 'true');

    const expectedNames = index.modules.filter((mod) => mod.tags.includes(tag!)).map((mod) => mod.name).sort();
    const visibleCards = page.locator('[data-module-card]:not([hidden])');
    const visibleNames = (await visibleCards.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-module-name')),
    )) as string[];
    expect(visibleNames.sort()).toEqual(expectedNames);

    await page.locator('[data-tag-filter-clear]').click();
    await expect(firstChip).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('[data-module-card]:not([hidden])')).toHaveCount(index.modules.length);
  });

  for (const theme of THEMES) {
    test(`${theme} theme: axe scan of /modules has zero critical/serious violations`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'chromium', 'one authoritative a11y run per theme is enough');

      await page.goto(`/modules?theme=${theme}`);
      const results = await new AxeBuilder({ page }).analyze();
      const seriousOrCritical = results.violations.filter(
        (violation) => violation.impact === 'serious' || violation.impact === 'critical',
      );
      expect(seriousOrCritical, JSON.stringify(seriousOrCritical, null, 2)).toEqual([]);
    });
  }
});

test.describe('module detail pages: deep-check 5 representative modules', () => {
  for (const moduleName of DEEP_CHECK_MODULES) {
    test(`${moduleName}: a content section exists for every text file declared in module.json`, async ({ page }) => {
      const declaredPaths = readRealModuleFileKeys(moduleName);
      expect(declaredPaths.length).toBeGreaterThan(0);

      await page.goto(`/modules/${moduleName}`);

      for (const path of declaredPaths) {
        const entry = page.locator(`[data-file-entry][data-file-path="${path}"]`);
        await expect(entry, `missing file-entry section for ${moduleName}/${path}`).toHaveCount(1);
      }
    });
  }

  test('verification (rules-only, 3 files): every file copies byte-exact against its raw endpoint', async ({
    page,
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'real clipboard read-back needs Chromium/CDP');

    const declaredPaths = readRealModuleFileKeys('verification');
    expect(declaredPaths).toHaveLength(3);

    await page.goto('/modules/verification');
    for (const path of declaredPaths) {
      await expectFileCopyByteExact(page, request, 'verification', path);
    }
  });

  test('autoheal (hook/lib/script-heavy, 39 files, no status, merge fragment): file copy, merge treatment, placeholder treatment, no status badge', async ({
    page,
    request,
  }, testInfo) => {
    await page.goto('/modules/autoheal');

    await expect(page.locator('[data-status-badge]')).toHaveCount(0);

    await expectMergeTreatment(page, 'settings.partial.json');
    await expectPlaceholderAnnotation(page, 'lib/com.__USERNAME__.ccgm.autoheal.daily.plist.template', true);
    await expectPlaceholderAnnotation(page, 'lib/autoheal.cron.template', true);
    // A regular, non-template rule file must NOT carry the annotation.
    await expectPlaceholderAnnotation(page, 'rules/autoheal.md', false);

    test.skip(testInfo.project.name !== 'chromium', 'real clipboard read-back needs Chromium/CDP');
    // Representative sample: the merge fragment, a placeholder file, an
    // ordinary inlined file, and (per computeInlineBudget over the real
    // data) the one file the 250 KB page budget pushes out of line --
    // bin/autoheal-analyze.sh -- covering both CopyButton modes.
    await expectFileCopyByteExact(page, request, 'autoheal', 'settings.partial.json');
    await expectFileCopyByteExact(page, request, 'autoheal', 'rules/autoheal.md');
    await expectFileCopyByteExact(page, request, 'autoheal', 'bin/autoheal-analyze.sh');
  });

  test('dreaming (status: beta, 39 files): beta badge renders, placeholder files annotated, large files copy byte-exact via fetch mode', async ({
    page,
    request,
  }, testInfo) => {
    await page.goto('/modules/dreaming');

    await expect(page.locator('[data-status-badge="beta"]')).toHaveText('beta');

    await expectPlaceholderAnnotation(page, 'lib/com.__USERNAME__.ccgm.dreaming.daily.plist.template', true);
    await expectPlaceholderAnnotation(page, 'lib/dreaming.cron.template', true);

    test.skip(testInfo.project.name !== 'chromium', 'real clipboard read-back needs Chromium/CDP');
    // dream_analyze.py (82,786 bytes) and apply_dream_proposal.py
    // (131,841 bytes) both exceed the 64 KB per-file inline cap -- these
    // exercise the non-inlined, fetch-based CopyButton path specifically.
    await expectFileCopyByteExact(page, request, 'dreaming', 'lib/dream_analyze.py');
    await expectFileCopyByteExact(page, request, 'dreaming', 'lib/apply_dream_proposal.py');
    await expectFileCopyByteExact(page, request, 'dreaming', 'rules/dreaming.md');
  });

  test('remote-server: placeholder annotation on onremote.md, merge treatment on the settings fragment', async ({
    page,
    request,
  }, testInfo) => {
    await page.goto('/modules/remote-server');

    await expectPlaceholderAnnotation(page, 'commands/onremote.md', true);
    await expectPlaceholderAnnotation(page, 'rules/remote-server.md', false);
    await expectMergeTreatment(page, 'settings.partial.json');

    test.skip(testInfo.project.name !== 'chromium', 'real clipboard read-back needs Chromium/CDP');
    for (const path of readRealModuleFileKeys('remote-server')) {
      await expectFileCopyByteExact(page, request, 'remote-server', path);
    }
  });

  test('agent-manager: deprecated banner, gated install strip, postInstall callout, zero-cost badge', async ({
    page,
  }) => {
    await page.goto('/modules/agent-manager');

    await expect(page.locator('[data-status-badge="deprecated"]')).toHaveText('deprecated');
    await expect(page.locator('[data-deprecated-banner]')).toBeVisible();

    // Install strip is gated behind an explicit "install anyway" affordance.
    const gate = page.locator('[data-install-strip-gate]');
    await expect(gate).toHaveCount(1);
    const isOpenBeforeClick = await gate.evaluate((el) => (el as HTMLDetailsElement).open);
    expect(isOpenBeforeClick).toBe(false);
    await expect(gate.locator('[data-install-strip]')).toHaveCount(1);

    // postInstall names a path outside files[] -- the callout must render
    // its actual content, not a dead reference, plus a GitHub link at the
    // pinned SHA (§5 E5: "CopyButton and GitHub link").
    const callout = page.locator('[data-post-install-callout]');
    await expect(callout).toContainText('postInstall.sh');
    await expect(callout.locator('pre')).not.toHaveText('');

    const index = readModulesIndex();
    const agentManager = (
      index as unknown as { modules: Array<{ name: string; sourceUrl: string; postInstallFile: { path: string } }> }
    ).modules.find((m) => m.name === 'agent-manager')!;
    const expectedGithubUrl = `${agentManager.sourceUrl.replace('/tree/', '/blob/')}/${agentManager.postInstallFile.path}`;
    await expect(callout.locator('[data-post-install-github-link]')).toHaveAttribute('href', expectedGithubUrl);

    // agent-manager declares only a `command` file -- zero always-loaded
    // rule files -- so the cost badge must render the zero-cost text, not
    // a bare "0".
    await expect(page.locator('[data-cost-badge]')).toHaveText(ZERO_COST_BADGE_TEXT);
  });

  test('agent-manager: every file copies byte-exact', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'real clipboard read-back needs Chromium/CDP');

    await page.goto('/modules/agent-manager');
    for (const path of readRealModuleFileKeys('agent-manager')) {
      await expectFileCopyByteExact(page, request, 'agent-manager', path);
    }
  });
});

test.describe('placeholder annotation: real-repo negative cases outside the 5 deep-checked modules', () => {
  test('a template:false file whose content matches the placeholder pattern is NOT annotated (cloud-dispatch/lib/workspace-setup.sh)', async ({
    page,
  }) => {
    await page.goto('/modules/cloud-dispatch');
    await expectPlaceholderAnnotation(page, 'lib/workspace-setup.sh', false);
  });

  test('a template:true scaffold file with no __VAR__ match is NOT annotated (identity/rules/soul.md)', async ({
    page,
  }) => {
    await page.goto('/modules/identity');
    await expectPlaceholderAnnotation(page, 'rules/soul.md', false);
  });
});

test.describe('"copy entire module as markdown" bundle', () => {
  test('the button label mirrors the bundle endpoint, and the copied text equals it exactly -- for a merge-free and a merge-bearing module', async ({
    page,
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'real clipboard read-back needs Chromium/CDP');

    for (const moduleName of ['dreaming', 'autoheal', 'verification']) {
      const bundleResponse = await request.get(`/modules/${moduleName}/bundle.md`);
      expect(bundleResponse.ok()).toBeTruthy();
      const bundleText = await bundleResponse.text();

      await page.goto(`/modules/${moduleName}`);
      const button = page.locator('[data-copy-source$="/bundle.md"]');
      await expect(button).toBeVisible();

      const tooLargeCount = (bundleText.match(/Too large to inline here/g) ?? []).length;
      const labelText = await button.locator('[data-copy-label]').textContent();
      if (tooLargeCount > 0) {
        expect(labelText).toBe(cappedBundleLabel(tooLargeCount));
      } else {
        expect(labelText).toBe(FULL_BUNDLE_LABEL);
      }

      await button.click();
      await expect(button).toHaveAttribute('data-state', 'copied', { timeout: 5000 });
      const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
      expect(clipboardText).toBe(bundleText);
    }
  });

  test('excludes merge fragments -- content and manifest link alike -- for autoheal and remote-server', async ({
    request,
  }) => {
    for (const moduleName of ['autoheal', 'remote-server']) {
      const bundleResponse = await request.get(`/modules/${moduleName}/bundle.md`);
      const bundleText = await bundleResponse.text();

      const rawResponse = await request.get(`/modules/${moduleName}/files/settings.partial.json.txt`);
      const rawContent = (await rawResponse.text()).trim();

      expect(bundleText).not.toContain(rawContent);
      // Named in the excluded-fragments note, but never embedded as content.
      expect(bundleText).toContain('settings.partial.json');
    }
  });
});

test.describe('module detail pages: cross-theme rendering', () => {
  for (const theme of THEMES) {
    test(`${theme} theme: axe scan of a module detail page has zero critical/serious violations`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== 'chromium', 'one authoritative a11y run per theme is enough');

      await page.goto(`/modules/verification?theme=${theme}`);
      const results = await new AxeBuilder({ page }).analyze();
      const seriousOrCritical = results.violations.filter(
        (violation) => violation.impact === 'serious' || violation.impact === 'critical',
      );
      expect(seriousOrCritical, JSON.stringify(seriousOrCritical, null, 2)).toEqual([]);
    });
  }
});
