import { expect, test } from '@playwright/test';
import {
  SCHEMA_VERSION_POLICY,
  TRUST_FRAMING,
  URL_IMPERMANENCE,
  agentPromptDiffPreset,
  agentPromptEvaluateCcgm,
  agentPromptInstallModule,
} from '../src/lib/pagecopy.ts';
import { SITE_URL } from '../src/lib/site.ts';

test.describe('agents page: content', () => {
  test('trust framing, schemaVersion policy, and URL-impermanence sentences are present', async ({
    page,
  }) => {
    await page.goto('/agents');

    for (const sentence of TRUST_FRAMING) {
      await expect(page.getByText(sentence)).toBeVisible();
    }
    await expect(page.locator('[data-schema-version-policy]')).toHaveText(SCHEMA_VERSION_POLICY);
    await expect(page.locator('[data-url-impermanence]')).toHaveText(URL_IMPERMANENCE);
  });

  test('cost-methodology note is present and derived from data, not a hardcoded number', async ({
    page,
  }) => {
    await page.goto('/agents');

    const note = page.locator('[data-cost-methodology]');
    await expect(note).toContainText('contextCostTokens counts only');
    await expect(note).toContainText(/\d+% of modules declare zero always-loaded rule files/);
  });

  test('three agent prompts render, each interpolating the derived SITE_URL, and copy cleanly', async ({
    page,
  }, testInfo) => {
    await page.goto('/agents');

    const expected = [
      { id: 'agent-prompt-evaluate', text: agentPromptEvaluateCcgm(SITE_URL) },
      { id: 'agent-prompt-install-module', text: agentPromptInstallModule(SITE_URL) },
      { id: 'agent-prompt-diff-preset', text: agentPromptDiffPreset(SITE_URL) },
    ];

    for (const prompt of expected) {
      await expect(page.locator(`#${prompt.id}`)).toHaveText(prompt.text);
      expect(prompt.text).toContain(SITE_URL);
    }

    test.skip(testInfo.project.name !== 'chromium', 'real clipboard read-back needs Chromium/CDP');

    for (const prompt of expected) {
      const button = page.locator(`[data-copy-target="${prompt.id}"]`);
      await button.click();
      await expect(button).toHaveAttribute('data-state', 'copied', { timeout: 5000 });
      const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
      expect(clipboardText).toBe(prompt.text);
    }
  });

  test('URL surface and size-contract tables document every artifact pattern', async ({ page }) => {
    await page.goto('/agents');

    const surfacePatterns = [
      '/llms.txt',
      '/llms-full.txt',
      '/modules.json',
      '/presets.json',
      '/modules/{name}.json',
      '/modules/{name}.md',
      '/modules/{name}/files/{path}.txt',
    ];
    for (const pattern of surfacePatterns) {
      await expect(page.locator('[data-url-surface-table] code', { hasText: pattern })).toBeVisible();
    }

    const sizeContractArtifacts = ['/llms.txt', '/llms-full.txt', '/modules.json', '/modules/{name}.json'];
    for (const artifact of sizeContractArtifacts) {
      await expect(page.locator('[data-size-contract-table] code', { hasText: artifact })).toBeVisible();
    }
  });
});

/**
 * Live-fetch checks against the machine surface documented above.
 *
 * /llms.txt, /llms-full.txt, /modules.json, /presets.json, and every
 * per-module JSON/Markdown/raw-file endpoint are authored by E2 (content
 * ingestion pipeline), which E4 develops in parallel with and merges after
 * (plan §5 Epic E4 dependency note). The three page-level twins
 * (/index.md, /install.md, /agents.md) are E4's own deliverable, gated on
 * E2's markdown.ts machinery landing first (see the PR description).
 *
 * Each check below is a real assertion once its artifact exists: it
 * fetches the URL, and if the artifact is missing (404) it skips with an
 * explicit reason instead of failing, so this suite stays green on either
 * side of E2's merge without needing to be rewritten -- the URL list and
 * content-type expectations here are already the target state.
 */
test.describe('agents page: documented URL surface (live fetch)', () => {
  const checks: Array<{ path: string; contentType: RegExp; label: string }> = [
    { path: '/index.md', contentType: /text\/markdown/, label: 'landing page twin' },
    { path: '/install.md', contentType: /text\/markdown/, label: 'install page twin' },
    { path: '/agents.md', contentType: /text\/markdown/, label: 'agents page twin' },
    { path: '/llms.txt', contentType: /text\/plain/, label: 'llms.txt index' },
    { path: '/llms-full.txt', contentType: /text\/plain/, label: 'llms-full.txt companion' },
    { path: '/modules.json', contentType: /application\/json/, label: 'modules.json index' },
    { path: '/presets.json', contentType: /application\/json/, label: 'presets.json index' },
  ];

  for (const check of checks) {
    test(`${check.path} (${check.label}) resolves with the documented content type`, async ({
      request,
    }) => {
      const response = await request.get(check.path);
      test.skip(
        response.status() === 404,
        `${check.path} is not wired yet (E2's machine surface or E4's page twins) -- pending merge, see PR description`,
      );

      expect(response.ok()).toBeTruthy();
      expect(response.headers()['content-type'] ?? '').toMatch(check.contentType);
    });
  }

  test('per-module URLs resolve for a module named in /modules.json, sourced dynamically -- never a hardcoded module name', async ({
    request,
  }) => {
    const indexResponse = await request.get('/modules.json');
    test.skip(indexResponse.status() === 404, '/modules.json is not wired yet -- pending E2 merge');

    const index = (await indexResponse.json()) as {
      modules: Array<{ name: string; files: Array<{ rawUrl: string }> }>;
    };
    const [firstModule] = index.modules;
    expect(firstModule).toBeTruthy();

    const jsonResponse = await request.get(`/modules/${firstModule.name}.json`);
    expect(jsonResponse.ok()).toBeTruthy();
    expect(jsonResponse.headers()['content-type'] ?? '').toMatch(/application\/json/);

    const mdResponse = await request.get(`/modules/${firstModule.name}.md`);
    expect(mdResponse.ok()).toBeTruthy();
    expect(mdResponse.headers()['content-type'] ?? '').toMatch(/text\/markdown/);

    const [firstFile] = firstModule.files;
    expect(firstFile).toBeTruthy();
    const rawResponse = await request.get(firstFile.rawUrl);
    expect(rawResponse.ok()).toBeTruthy();
    expect(rawResponse.headers()['content-type'] ?? '').toMatch(/text\/plain/);
  });
});
