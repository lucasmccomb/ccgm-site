import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import {
  AGENT_PASTE_BLOCK,
  INSTALL_COMMAND,
  INSTALL_COMMAND_NONINTERACTIVE,
  MARKETPLACE_ADD_COMMAND,
  MARKETPLACE_INSTALL_EXAMPLE_COMMAND,
  MARKETPLACE_NON_PARITY_NOTE,
} from '../src/lib/pagecopy.ts';

interface PresetRecord {
  name: string;
  description: string | null;
  modules: string[];
}

/**
 * E2's public /presets.json endpoint does not exist yet (it is authored by
 * E2, which E4 develops in parallel with and merges after -- see the plan's
 * E4 dependency note). Compare against the same generated file the page
 * itself reads (src/generated/presets.json) rather than a hardcoded number,
 * mirroring landing.spec.ts's "read the generated file, never a literal"
 * pattern. Once E2's /presets.json route exists this data is identical.
 */
function readGeneratedPresets(): PresetRecord[] {
  const presetsPath = join(process.cwd(), 'src', 'generated', 'presets.json');
  if (!existsSync(presetsPath)) {
    throw new Error('src/generated/presets.json does not exist -- run `pnpm build` before `pnpm test:e2e`');
  }
  const parsed = JSON.parse(readFileSync(presetsPath, 'utf-8')) as { presets: PresetRecord[] };
  return parsed.presets;
}

async function activateTab(page: Page, tabId: string): Promise<Locator> {
  const tab = page.locator(`[data-tab-id="${tabId}"]`);
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  return page.locator(`[data-tab-panel="${tabId}"]`);
}

async function expectCopiesByteExact(page: Page, targetId: string, expected: string): Promise<void> {
  const target = page.locator(`#${targetId}`);
  await expect(target).toHaveText(expected);

  const button = page.locator(`[data-copy-target="${targetId}"]`);
  await button.click();
  await expect(button).toHaveAttribute('data-state', 'copied', { timeout: 5000 });

  const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboardText).toBe(expected);
}

test.describe('install page', () => {
  test('four tabs are keyboard-navigable (roving tabindex, ArrowRight/Left/Home/End)', async ({
    page,
  }) => {
    await page.goto('/install');

    const tabs = page.locator('[role="tab"]');
    await expect(tabs).toHaveCount(4);

    const first = tabs.nth(0);
    await first.focus();
    await expect(first).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.nth(1)).toBeFocused();

    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('End');
    await expect(tabs.nth(3)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-tab-panel="manual"]')).toBeVisible();

    await page.keyboard.press('Home');
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-tab-panel="bash"]')).toBeVisible();

    await page.keyboard.press('ArrowLeft');
    await expect(tabs.nth(3)).toHaveAttribute('aria-selected', 'true');
  });

  test('bash tab: both install commands copy byte-exact', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'real clipboard read-back needs Chromium/CDP');

    await page.goto('/install');
    await activateTab(page, 'bash');

    await expectCopiesByteExact(page, 'install-command-bash', INSTALL_COMMAND);
    await expectCopiesByteExact(page, 'install-command-noninteractive', INSTALL_COMMAND_NONINTERACTIVE);
  });

  test('agent tab: the agent-paste block copies byte-exact', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'real clipboard read-back needs Chromium/CDP');

    await page.goto('/install');
    await activateTab(page, 'agent');

    await expectCopiesByteExact(page, 'install-command-agent', AGENT_PASTE_BLOCK);
  });

  test('marketplace tab: both commands copy byte-exact and the non-parity note is visible', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'real clipboard read-back needs Chromium/CDP');

    await page.goto('/install');
    const panel = await activateTab(page, 'marketplace');

    await expectCopiesByteExact(page, 'install-command-marketplace', MARKETPLACE_ADD_COMMAND);
    await expectCopiesByteExact(
      page,
      'install-command-marketplace-example',
      MARKETPLACE_INSTALL_EXAMPLE_COMMAND,
    );

    await expect(panel.locator('[data-non-parity-note]')).toHaveText(MARKETPLACE_NON_PARITY_NOTE);
  });

  test('manual tab: links to the module catalog', async ({ page }) => {
    await page.goto('/install');
    const panel = await activateTab(page, 'manual');

    await expect(panel.getByRole('link', { name: /module catalog/i })).toHaveAttribute(
      'href',
      '/modules',
    );
  });

  test('preset table rows and module counts match the generated presets data entry-for-entry', async ({
    page,
  }) => {
    const presets = readGeneratedPresets();
    expect(presets.length).toBeGreaterThan(0);

    await page.goto('/install');
    await activateTab(page, 'bash');

    const rows = page.locator('[data-preset-row]');
    await expect(rows).toHaveCount(presets.length);

    for (const [i, preset] of presets.entries()) {
      const row = rows.nth(i);
      await expect(row).toHaveAttribute('data-preset-name', preset.name);
      await expect(row).toHaveAttribute('data-preset-module-count', String(preset.modules.length));
      await expect(row.locator('[data-preset-modules]')).toHaveText(preset.modules.join(', '));
    }
  });
});
