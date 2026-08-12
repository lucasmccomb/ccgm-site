import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { HERO_TAGLINE, INSTALL_COMMAND, WHAT_IS_HEADING, WHAT_IS_INTRO } from '../src/lib/pagecopy.ts';

interface IndexMeta {
  moduleCount: number;
  categories: Record<string, number>;
}

function readModulesIndexMeta(): IndexMeta {
  const indexPath = join(process.cwd(), 'src', 'generated', 'modules-index.json');
  if (!existsSync(indexPath)) {
    throw new Error(
      'src/generated/modules-index.json does not exist -- run `pnpm build` before `pnpm test:e2e`',
    );
  }
  const parsed = JSON.parse(readFileSync(indexPath, 'utf-8')) as { meta: IndexMeta };
  return parsed.meta;
}

test.describe('landing page', () => {
  test('hero renders: ASCII banner, tagline, primary install command with a copy button', async ({
    page,
  }) => {
    await page.goto('/');

    await expect(page.locator('[role="img"]')).toBeVisible();
    await expect(page.getByText(HERO_TAGLINE)).toBeVisible();

    const installCommand = page.locator('#install-command');
    await expect(installCommand).toHaveText(INSTALL_COMMAND);
    await expect(page.locator('[data-copy-button]')).toBeVisible();
  });

  test('"what is CCGM" section is present with the module explanation and install-paths overview', async ({
    page,
  }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: WHAT_IS_HEADING })).toBeVisible();
    await expect(page.getByText(WHAT_IS_INTRO)).toBeVisible();

    const installPaths = page.locator('[data-install-paths] li');
    await expect(installPaths).toHaveCount(3);

    await expect(page.locator('[data-example-module]')).toBeVisible();
  });

  test('install command copies byte-exact via keyboard-operable CopyButton', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'real clipboard read-back is only reliable under Chromium/CDP permissions',
    );

    await page.goto('/');

    const target = page.locator('#install-command');
    const expectedText = await target.textContent();
    expect(expectedText).toBe(INSTALL_COMMAND);

    const button = page.locator('[data-copy-button]');
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(button).toHaveAttribute('data-state', 'copied', { timeout: 5000 });

    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toBe(expectedText);
  });

  test('stats strip shows the module count and category count read from modules-index.json meta, never a literal', async ({
    page,
  }) => {
    const meta = readModulesIndexMeta();

    await page.goto('/');

    await expect(page.locator('[data-stat="module-count"]')).toHaveText(String(meta.moduleCount));
    await expect(page.locator('[data-stat="category-count"]')).toHaveText(
      String(Object.keys(meta.categories).length),
    );
  });
});
