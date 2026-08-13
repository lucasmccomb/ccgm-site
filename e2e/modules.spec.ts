import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { SITE_URL, THEMES } from '../src/lib/site.ts';
import { CATEGORY_VALUES, type ModuleRecord, type ModulesIndex } from '../src/lib/schema.ts';
import { buildModuleTwin, cappedTwinLabel, FULL_TWIN_LABEL } from '../src/lib/module-twin.ts';
import {
  MERGE_FRAGMENT_ANNOTATION,
  MERGE_FRAGMENT_COPY_LABEL,
  PLACEHOLDER_ANNOTATION,
  WILL_INSTALL_MERGE_ACTION,
  ZERO_COST_BADGE_TEXT,
} from '../src/lib/modulepagecopy.ts';

/**
 * The FULL ingested index (src/generated/modules-index.json), not the
 * public-facing trimmed /modules.json -- this file still carries
 * contentFiles/readmeMd, which buildModuleTwin() needs to independently
 * reconstruct the same twin the live page computed.
 */
function readModulesIndex(): ModulesIndex {
  const path = join(process.cwd(), 'src', 'generated', 'modules-index.json');
  if (!existsSync(path)) {
    throw new Error('src/generated/modules-index.json does not exist -- run `pnpm build` before `pnpm test:e2e`');
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function findModule(index: ModulesIndex, name: string): ModuleRecord {
  const mod = index.modules.find((m) => m.name === name);
  if (!mod) throw new Error(`modules-index.json has no record for "${name}"`);
  return mod;
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

    const agentManager = findModule(readModulesIndex(), 'agent-manager');
    expect(agentManager.postInstallFile).toBeDefined();
    const expectedGithubUrl = `${agentManager.sourceUrl.replace('/tree/', '/blob/')}/${agentManager.postInstallFile!.path}`;
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

test.describe('"copy entire module as markdown" copies the .md twin body (§3.4 clarification, decisions.md)', () => {
  test('the copied clipboard text equals /modules/{name}.md byte-exact, and the button label mirrors the twin\'s capped state -- for an under-cap and an over-cap module', async ({
    page,
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'real clipboard read-back needs Chromium/CDP');

    // buildModuleTwin() is the actual source of truth the live page and the
    // /modules/{name}.md endpoint both call -- reconstructing it here
    // (rather than pattern-sniffing the fetched text) is exact, not a
    // heuristic, and covers the same under-cap/over-cap split the real
    // corpus produces today: verification/autoheal/remote-server fit under
    // the 512 KB cap (full body inlining); dreaming/commands-extra do not
    // (links-only fallback, §5's over-cap acceptance case).
    const index = readModulesIndex();
    for (const moduleName of ['verification', 'autoheal', 'remote-server', 'dreaming', 'commands-extra']) {
      const mod = findModule(index, moduleName);
      const frontMatter = {
        schemaVersion: index.meta.schemaVersion,
        module: mod.name,
        sourceSha: index.meta.sourceSha,
        generatedAt: index.meta.generatedAt,
      };
      const expectedTwin = buildModuleTwin(mod, { siteUrl: SITE_URL, sourceSha: index.meta.sourceSha, frontMatter });

      const twinResponse = await request.get(`/modules/${moduleName}.md`);
      expect(twinResponse.ok()).toBeTruthy();
      const twinText = await twinResponse.text();
      expect(twinText, `${moduleName}: served twin vs independently recomputed twin`).toBe(expectedTwin.text);

      await page.goto(`/modules/${moduleName}`);
      const button = page.locator(`[data-copy-source="/modules/${moduleName}.md"]`);
      await expect(button).toBeVisible();

      const labelText = await button.locator('[data-copy-label]').textContent();
      const expectedLabel = expectedTwin.capped ? cappedTwinLabel(expectedTwin.linkedFileCount) : FULL_TWIN_LABEL;
      expect(labelText, `${moduleName} button label`).toBe(expectedLabel);

      await button.click();
      await expect(button).toHaveAttribute('data-state', 'copied', { timeout: 5000 });
      const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
      expect(clipboardText, `${moduleName} clipboard vs twin`).toBe(twinText);
    }
  });

  test('an under-cap twin (verification) inlines the full byte-exact content of every declared file', async ({
    request,
  }) => {
    const twinResponse = await request.get('/modules/verification.md');
    const twinText = await twinResponse.text();

    for (const path of readRealModuleFileKeys('verification')) {
      const rawResponse = await request.get(`/modules/verification/files/${path}.txt`);
      const rawContent = await rawResponse.text();
      expect(twinText, `${path} body inlined in the verification twin`).toContain(rawContent.trim());
    }
  });

  test('an under-cap twin never inlines a merge fragment\'s body -- autoheal and remote-server render the annotated link instead', async ({
    request,
  }) => {
    for (const moduleName of ['autoheal', 'remote-server']) {
      const twinResponse = await request.get(`/modules/${moduleName}.md`);
      const twinText = await twinResponse.text();

      const rawResponse = await request.get(`/modules/${moduleName}/files/settings.partial.json.txt`);
      const rawContent = (await rawResponse.text()).trim();

      expect(twinText, `${moduleName} twin must not embed the merge fragment body`).not.toContain(rawContent);
      expect(twinText, `${moduleName} twin must annotate the merge fragment`).toContain('merge fragment');
      expect(twinText, `${moduleName} twin must still link the merge fragment's raw URL`).toContain(
        `/modules/${moduleName}/files/settings.partial.json.txt`,
      );
    }
  });

  test('over-cap twins (dreaming, commands-extra) keep their Files section links-only, with the relabelled button naming the real link count', async ({
    request,
  }) => {
    for (const moduleName of ['dreaming', 'commands-extra']) {
      const twinResponse = await request.get(`/modules/${moduleName}.md`);
      const twinText = await twinResponse.text();

      // Scoped to the "## Files" section: an over-cap module may still
      // keep its README inlined (a separate, independent fallback tier --
      // dropping file bodies alone is often enough to clear the cap), and
      // a real README can legitimately contain its own fenced examples.
      // The Files section itself, though, is always the flat
      // "- `path` (...): url" link format -- never a fenced code block.
      const filesSectionStart = twinText.indexOf('\n## Files\n');
      expect(filesSectionStart, `${moduleName}: no "## Files" section found`).toBeGreaterThan(-1);
      const filesSection = twinText.slice(filesSectionStart);

      expect(filesSection).not.toContain('```');
      expect(filesSection).toMatch(/^- `/m);
    }
  });
});

test.describe('module detail pages: cross-theme rendering', () => {
  for (const theme of THEMES) {
    test(`${theme} theme: axe scan of a module detail page has zero critical/serious violations, with every file-type <details> section EXPANDED`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== 'chromium', 'one authoritative a11y run per theme is enough');

      await page.goto(`/modules/verification?theme=${theme}`);

      // A closed <details> hides its content from the accessibility tree
      // entirely, so the default (collapsed) state can never surface an
      // issue inside a file-entry <pre> -- exactly how the missing
      // tabindex="0" on ModuleFileSection.astro's scrollable <pre>
      // elements slipped past this same scan before. Open every declared
      // file's containing section (reusing the existing per-file helper)
      // so axe judges the expanded state a real visitor reaches by
      // clicking a <summary>.
      for (const path of readRealModuleFileKeys('verification')) {
        await openDetailsFor(page, path);
      }

      const results = await new AxeBuilder({ page }).analyze();
      const seriousOrCritical = results.violations.filter(
        (violation) => violation.impact === 'serious' || violation.impact === 'critical',
      );
      expect(seriousOrCritical, JSON.stringify(seriousOrCritical, null, 2)).toEqual([]);
    });
  }
});
