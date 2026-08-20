import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { DEFAULT_THEME } from '../src/lib/site.ts';

/**
 * The shipped default is asserted from DEFAULT_THEME, never from a literal
 * theme name (#21): the constant in src/lib/site.ts is the single place
 * the default is declared, and these tests fail the moment the served HTML
 * stops matching it.
 */

/**
 * global.css's neutral `:root` placeholder value for `--layout-max`, read
 * out of the stylesheet rather than copied here. No theme layer sets it, so
 * a page still reporting it is a page where no token block applied at all.
 *
 * Reading it keeps the assertion honest: a hardcoded '72rem' would quietly
 * become always-true the day someone edits that placeholder -- which is the
 * exact failure the assertion exists to catch.
 */
function unthemedPlaceholderLayoutMax(): string {
  const cssPath = join(process.cwd(), 'src', 'styles', 'global.css');
  const css = readFileSync(cssPath, 'utf-8');
  const match = /:root\s*\{[^}]*?--layout-max:\s*([^;]+);/.exec(css);
  if (!match) {
    throw new Error(`no :root --layout-max declaration found in ${cssPath}`);
  }
  return match[1].trim();
}
test.describe('smoke', () => {
  test('served HTML carries the DEFAULT_THEME data-theme before any JavaScript runs', async ({ request }) => {
    const response = await request.get('/');
    expect(response.ok()).toBeTruthy();
    const html = await response.text();
    expect(html).toContain(`data-theme="${DEFAULT_THEME}"`);
  });

  test('default theme survives with JavaScript disabled', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('/');

    const dataTheme = await page.locator('html').getAttribute('data-theme');
    expect(dataTheme).toBe(DEFAULT_THEME);

    // A themed canvas, not the transparent default an unstyled element
    // would report: the token layer is applied by the statically rendered
    // data-theme, with no script involved.
    const backgroundColor = await page.evaluate(
      () => getComputedStyle(document.documentElement).backgroundColor,
    );
    expect(backgroundColor).not.toBe('rgba(0, 0, 0, 0)');

    // And the theme's OWN token block won, not global.css's neutral
    // `:root` placeholder.
    const layoutMax = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--layout-max').trim(),
    );
    expect(layoutMax).not.toBe(unthemedPlaceholderLayoutMax());

    await context.close();
  });

  test('CopyButton copies the exact install command, announces, and is keyboard operable', async ({
    page,
    baseURL,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'real clipboard read-back is only reliable under Chromium/CDP permissions',
    );

    await page.goto('/');

    const target = page.locator('#install-command');
    const expectedText = await target.textContent();
    expect(expectedText).toBeTruthy();

    const button = page.locator('[data-copy-button]');
    await expect(button).toHaveAttribute('aria-label', /.+/);

    // Keyboard-operable: focus + Enter triggers the same click handler.
    await button.focus();
    await page.keyboard.press('Enter');

    await expect(button).toHaveAttribute('data-state', 'copied', { timeout: 5000 });

    const liveRegionId = await button.getAttribute('data-copy-live');
    expect(liveRegionId).toBeTruthy();
    const liveRegion = page.locator(`#${liveRegionId}`);
    await expect(liveRegion).toHaveText('Copied');

    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toBe(expectedText);

    void baseURL;
  });

  test('CopyButton failure path shows inline error, announces it, and resets to idle', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'clipboard patching via addInitScript is only reliable under Chromium/CDP permissions',
    );

    // Patch navigator.clipboard.writeText to reject BEFORE any page script
    // runs, so CopyButton's click handler observes a real rejected promise.
    await page.addInitScript(() => {
      navigator.clipboard.writeText = () => Promise.reject(new Error('denied'));
    });

    await page.goto('/');

    const button = page.locator('[data-copy-button]');
    await button.click();

    // Real contract (src/scripts/copy.ts setState): a rejected clipboard
    // promise sets data-state="error" and the visible label to the
    // button's data-error-label ("Copy failed" per CopyButton.astro).
    await expect(button).toHaveAttribute('data-state', 'error', { timeout: 5000 });
    await expect(button.locator('[data-copy-label]')).toHaveText('Copy failed');

    const liveRegionId = await button.getAttribute('data-copy-live');
    expect(liveRegionId).toBeTruthy();
    const liveRegion = page.locator(`#${liveRegionId}`);
    await expect(liveRegion).toHaveText('Copy failed');

    // RESET_DELAY_MS in src/scripts/copy.ts is 2000ms -- wait on the
    // condition (the attribute value), never on a fixed sleep.
    await expect(button).toHaveAttribute('data-state', 'idle', { timeout: 5000 });
  });
});
