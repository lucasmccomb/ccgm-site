import { expect, test } from '@playwright/test';
import { seriousOrCriticalViolations } from './axe.ts';
import { DIAGRAMS, DIAGRAMS_HEADING } from '../src/lib/diagrams.ts';
import { THEMES } from '../src/lib/site.ts';

/**
 * Standing coverage for the diagrams page (#24): smoke, axe across every
 * theme in THEMES, 375px no-overflow across every theme, a JavaScript-
 * disabled render, and `.md` twin parity.
 *
 * The counts and headings come from `src/lib/diagrams.ts`, never from
 * literals here -- the same "read the source, not a number" pattern the
 * landing and install specs use.
 */

test.describe('diagrams page', () => {
  test('renders every diagram with an inline, labelled SVG', async ({ page }) => {
    await page.goto('/diagrams');

    await expect(page.getByRole('heading', { level: 1, name: DIAGRAMS_HEADING })).toBeVisible();
    await expect(page.locator('[data-diagram]')).toHaveCount(DIAGRAMS.length);

    for (const spec of DIAGRAMS) {
      const section = page.locator(`[data-diagram="${spec.id}"]`);
      await expect(section).toBeVisible();

      // role="img" + a non-empty accessible name, asserted through the
      // accessibility tree rather than by reading the markup back.
      const image = section.getByRole('img', { name: spec.title });
      await expect(image).toHaveCount(1);

      // The image-free fallback: one <li> per documented step.
      await expect(section.locator('.diagram__steps li')).toHaveCount(spec.steps.length);

      // Traceability: one legend row per ref, each linking somewhere real.
      const legend = page.locator(`[data-diagram-legend="${spec.id}"] a`);
      await expect(legend).toHaveCount(spec.refs.length);
    }
  });

  test('every traceability link is either a resolvable page on this site or a SHA-pinned ccgm blob', async ({
    page,
    request,
  }) => {
    await page.goto('/diagrams');

    const hrefs = await page.locator('[data-diagram-ref]').evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLAnchorElement).getAttribute('href') ?? ''),
    );
    expect(hrefs.length).toBeGreaterThan(0);

    const internal = [...new Set(hrefs.filter((href) => href.startsWith('/')))];
    const external = hrefs.filter((href) => !href.startsWith('/'));

    expect(internal.length, 'no diagram ref resolved to a page on this site').toBeGreaterThan(0);
    for (const href of internal) {
      const response = await request.get(href);
      expect(response.status(), `${href} did not resolve`).toBe(200);
    }

    // External refs are never fetched (a network call would make this suite
    // depend on GitHub); the contract asserted is that they are pinned.
    for (const href of external) {
      expect(href, `${href} is not a SHA-pinned ccgm blob`).toMatch(
        /^https:\/\/github\.com\/lucasmccomb\/ccgm\/blob\/[0-9a-f]{40}\//,
      );
    }
  });

  test('the page and every SVG survive with JavaScript disabled', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('/diagrams');

    await expect(page.locator('[data-diagram]')).toHaveCount(DIAGRAMS.length);
    await expect(page.locator('[data-diagram] svg[role="img"]')).toHaveCount(DIAGRAMS.length);
    await expect(page.locator('.diagram__steps li').first()).toBeVisible();

    await context.close();
  });

  for (const theme of THEMES) {
    test(`${theme} theme: /diagrams has no horizontal overflow at a 375px viewport`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 700 });
      await page.goto(`/diagrams?theme=${theme}`);

      const { scrollWidth, viewportWidth } = await page.evaluate(() => ({
        scrollWidth: document.scrollingElement?.scrollWidth ?? 0,
        viewportWidth: window.innerWidth,
      }));

      const TOLERANCE_PX = 1;
      expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + TOLERANCE_PX);
    });
  }

  for (const theme of THEMES) {
    test(`${theme} theme: axe scan of /diagrams has zero critical/serious violations`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== 'chromium', 'one authoritative a11y run per theme is enough');

      await page.goto(`/diagrams?theme=${theme}`);
      const seriousOrCritical = await seriousOrCriticalViolations(page);

      expect(seriousOrCritical, JSON.stringify(seriousOrCritical, null, 2)).toEqual([]);
    });
  }

  test('the footer offers the twin, and /diagrams.md carries the same diagrams as the page', async ({
    page,
    request,
  }) => {
    await page.goto('/diagrams');
    await expect(page.locator('[data-view-as-markdown]')).toHaveAttribute('href', '/diagrams.md');

    const response = await request.get('/diagrams.md');
    expect(response.ok()).toBeTruthy();
    expect(response.headers()['content-type'] ?? '').toMatch(/text\/markdown/);

    const twin = await response.text();
    for (const spec of DIAGRAMS) {
      expect(twin, `${spec.id}: heading`).toContain(`## ${spec.heading}`);
      expect(twin, `${spec.id}: summary`).toContain(spec.summary);
      for (const step of spec.steps) {
        expect(twin, `${spec.id}: step`).toContain(step);
      }
      for (const ref of spec.refs) {
        expect(twin, `${spec.id}: ref ${ref.path}`).toContain(ref.path);
      }
    }
  });

  test('/llms.txt lists the diagrams twin in its Docs section', async ({ request }) => {
    const response = await request.get('/llms.txt');
    expect(response.ok()).toBeTruthy();

    const body = await response.text();
    const docsSection = body.slice(body.indexOf('## Docs'), body.indexOf('## Modules'));
    expect(docsSection).toContain('/diagrams.md');
  });

  test('the landing page links to the diagrams page', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.hero__links a[href="/diagrams"]')).toBeVisible();
  });
});
