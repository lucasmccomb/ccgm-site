import { expect, test } from '@playwright/test';
import { seriousOrCriticalViolations } from './axe.ts';
import {
  COMMAND_EXAMPLES,
  EXAMPLES_HEADING,
  NO_INVENTED_OUTPUT_NOTE,
  PROVENANCE_LABEL,
  allBlocks,
  provenanceTallyLine,
} from '../src/lib/examples.ts';
import { THEMES } from '../src/lib/site.ts';

/**
 * Standing coverage for /examples (#23), matching what the sibling pages get:
 * content smoke, the sourcing-honesty labelling contract as a visitor actually
 * sees it, axe across every theme, no horizontal overflow at 375px, a
 * fully-readable page with JavaScript disabled, and twin parity.
 *
 * Expectations are derived from src/lib/examples.ts -- the same single source
 * the page renders from -- never from literals duplicated here.
 */

test.describe('examples page: content', () => {
  test('renders one section per example, each naming its module', async ({ page }) => {
    await page.goto('/examples');

    await expect(page.getByRole('heading', { name: EXAMPLES_HEADING, level: 1 })).toBeVisible();

    const sections = page.locator('[data-example]');
    await expect(sections).toHaveCount(COMMAND_EXAMPLES.length);

    for (const example of COMMAND_EXAMPLES) {
      const section = page.locator(`[data-example-id="${example.id}"]`);
      await expect(section).toHaveCount(1);
      const heading = section.locator(`#${example.id}-heading`);
      await expect(heading).toHaveText(example.command);
      await expect(heading).toBeVisible();
      await expect(section.getByText(example.summary)).toBeVisible();
      const moduleLink = section.locator('[data-example-module]');
      await expect(moduleLink).toHaveText(example.module);
      await expect(moduleLink).toHaveAttribute('href', `/modules/${example.module}`);
    }
  });

  test('every block renders its exact declared text', async ({ page }) => {
    await page.goto('/examples');

    for (const block of allBlocks()) {
      const pre = page.locator(`#${block.id}`);
      await expect(pre, `block "${block.id}" is missing from the page`).toHaveCount(1);
      await expect(pre).toHaveText(block.text);
    }
  });

  test('the honesty tally is rendered and derived from the data', async ({ page }) => {
    await page.goto('/examples');
    await expect(page.locator('[data-provenance-tally]')).toHaveText(provenanceTallyLine());
    await expect(page.locator('[data-no-invented-output]')).toHaveText(NO_INVENTED_OUTPUT_NOTE);
  });
});

test.describe('examples page: sourcing-honesty labelling contract', () => {
  test('every block carries a provenance attribute AND a visible label a reader can see', async ({
    page,
  }) => {
    await page.goto('/examples');

    for (const block of allBlocks()) {
      const container = page.locator(`[data-example-block][data-block-id="${block.id}"]`);
      await expect(container).toHaveCount(1);
      await expect(container).toHaveAttribute('data-provenance', block.provenance);

      // The label is prose on the page, not just an attribute: an
      // illustrative transcript has to LOOK illustrative to a visitor.
      const label = container.locator(`[data-provenance-label="${block.id}"]`);
      await expect(label).toBeVisible();
      await expect(label).toHaveText(PROVENANCE_LABEL[block.provenance]);
    }
  });

  test('illustrative blocks carry the illustrative marker; verbatim blocks never do', async ({ page }) => {
    await page.goto('/examples');

    const illustrative = allBlocks().filter((block) => block.provenance === 'illustrative');
    expect(illustrative.length).toBeGreaterThan(0);

    await expect(page.locator('[data-illustrative-label]')).toHaveCount(illustrative.length);

    for (const block of allBlocks()) {
      const marker = page.locator(`[data-illustrative-label="${block.id}"]`);
      await expect(marker, `block "${block.id}" marker count`).toHaveCount(
        block.provenance === 'illustrative' ? 1 : 0,
      );
    }
  });

  test('every illustrative block lists every anchor it declares, with its note', async ({ page }) => {
    await page.goto('/examples');

    for (const block of allBlocks()) {
      if (block.provenance !== 'illustrative') continue;
      const anchors = block.anchors ?? [];
      expect(anchors.length, `block "${block.id}" declares no anchors`).toBeGreaterThan(0);

      const details = page.locator(`[data-anchors-for="${block.id}"]`);
      await expect(details).toHaveCount(1);
      // <details> hides its contents from the a11y tree until opened, so open
      // it before asserting on what a reader can actually reach.
      await details.locator('summary').click();

      const items = details.locator(`[data-anchor="${block.id}"]`);
      await expect(items).toHaveCount(anchors.length);

      for (const [i, anchor] of anchors.entries()) {
        await expect(items.nth(i)).toContainText(anchor.text);
        await expect(items.nth(i)).toContainText(anchor.licenses);
      }
    }
  });

  test('every declared source links to the module page and to the raw file, and both resolve', async ({
    page,
    request,
  }) => {
    await page.goto('/examples');

    const seen = new Set<string>();
    for (const block of allBlocks()) {
      const container = page.locator(`[data-example-block][data-block-id="${block.id}"]`);
      const fileLinks = container.locator('[data-source-file]');
      await expect(fileLinks).toHaveCount(block.sources.length);

      for (const [i, source] of block.sources.entries()) {
        const href = await fileLinks.nth(i).getAttribute('href');
        expect(href, `source link for ${source.module}/${source.path}`).toBe(
          `/modules/${source.module}/files/${source.path}.txt`,
        );

        if (seen.has(href!)) continue;
        seen.add(href!);
        const response = await request.get(href!);
        expect(response.ok(), `${href} did not resolve`).toBeTruthy();
        expect(response.headers()['content-type'] ?? '').toMatch(/text\/plain/);
      }
    }
    expect(seen.size).toBeGreaterThan(0);
  });

  test('every quoted block is byte-exact against the raw endpoint it cites', async ({ request }) => {
    // The end-to-end version of the unit suite's substring check: fetch the
    // file the page actually links to and confirm the quoted block is really
    // in it. A verbatim label the served corpus does not back is the exact
    // failure this page's whole premise rests on avoiding.
    for (const block of allBlocks()) {
      if (block.provenance !== 'verbatim') continue;

      let found = false;
      for (const source of block.sources) {
        const response = await request.get(`/modules/${source.module}/files/${source.path}.txt`);
        expect(response.ok()).toBeTruthy();
        if ((await response.text()).includes(block.text)) {
          found = true;
          break;
        }
      }
      expect(found, `block "${block.id}" is labelled verbatim but is not in any cited raw file`).toBe(true);
    }
  });

  test('every anchor is byte-exact against the raw endpoint it cites', async ({ request }) => {
    for (const block of allBlocks()) {
      for (const anchor of block.anchors ?? []) {
        let found = false;
        for (const source of block.sources) {
          const response = await request.get(`/modules/${source.module}/files/${source.path}.txt`);
          expect(response.ok()).toBeTruthy();
          if ((await response.text()).includes(anchor.text)) {
            found = true;
            break;
          }
        }
        expect(found, `anchor ${JSON.stringify(anchor.text)} in "${block.id}" is not in any cited raw file`).toBe(
          true,
        );
      }
    }
  });
});

test.describe('examples page: machine surface', () => {
  test('/examples.md twin resolves as markdown and carries the same blocks and labels', async ({ request }) => {
    const response = await request.get('/examples.md');
    expect(response.ok()).toBeTruthy();
    expect(response.headers()['content-type'] ?? '').toMatch(/text\/markdown/);

    const twin = await response.text();
    for (const block of allBlocks()) {
      expect(twin, `block "${block.id}" body missing from the twin`).toContain(block.text);
      expect(twin, `block "${block.id}" provenance label missing from the twin`).toContain(
        PROVENANCE_LABEL[block.provenance],
      );
    }
  });

  test('the page links its own twin via the footer "view as Markdown" affordance', async ({ page }) => {
    await page.goto('/examples');
    await expect(page.locator('[data-view-as-markdown]')).toHaveAttribute('href', '/examples.md');
  });

  test('/llms.txt lists the examples page under ## Docs', async ({ request }) => {
    const response = await request.get('/llms.txt');
    expect(response.ok()).toBeTruthy();

    const text = await response.text();
    const docsSection = text.slice(text.indexOf('## Docs'), text.indexOf('## Modules'));
    expect(docsSection).toContain('/examples.md');
  });

  test('the landing page nav links to /examples', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Examples', exact: true })).toHaveAttribute(
      'href',
      '/examples',
    );
  });
});

test.describe('examples page: cross-theme rendering', () => {
  for (const theme of THEMES) {
    test(`${theme} theme: axe scan of /examples has zero critical/serious violations, with every anchor list EXPANDED`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== 'chromium', 'one authoritative a11y run per theme is enough');

      await page.goto(`/examples?theme=${theme}`);

      // A closed <details> hides its content from the accessibility tree, so
      // the collapsed state can never surface an issue inside the anchor
      // lists -- open every one so axe judges the state a reader reaches by
      // clicking a <summary> (same reasoning as modules.spec.ts).
      const summaries = page.locator('[data-anchors-for] summary');
      const count = await summaries.count();
      for (let i = 0; i < count; i++) {
        await summaries.nth(i).click();
      }

      const seriousOrCritical = await seriousOrCriticalViolations(page);
      expect(seriousOrCritical, JSON.stringify(seriousOrCritical, null, 2)).toEqual([]);
    });
  }

  for (const theme of THEMES) {
    test(`${theme} theme: /examples has no horizontal overflow at a 375px viewport`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 700 });
      await page.goto(`/examples?theme=${theme}`);

      const { scrollWidth, viewportWidth } = await page.evaluate(() => ({
        scrollWidth: document.scrollingElement?.scrollWidth ?? 0,
        viewportWidth: window.innerWidth,
      }));

      const TOLERANCE_PX = 1;
      expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + TOLERANCE_PX);
    });
  }
});

test.describe('examples page: without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('every example, every block, and every provenance label is present with no JavaScript', async ({
    page,
  }) => {
    await page.goto('/examples');

    await expect(page.locator('[data-example]')).toHaveCount(COMMAND_EXAMPLES.length);
    await expect(page.locator('[data-example-block]')).toHaveCount(allBlocks().length);

    for (const block of allBlocks()) {
      await expect(page.locator(`#${block.id}`)).toHaveText(block.text);
      await expect(page.locator(`[data-provenance-label="${block.id}"]`)).toHaveText(
        PROVENANCE_LABEL[block.provenance],
      );
    }
  });

  test('anchor lists are reachable with no JavaScript -- native <details>, not a script-driven toggle', async ({
    page,
  }) => {
    await page.goto('/examples');

    const illustrative = allBlocks().filter((block) => block.provenance === 'illustrative');
    for (const block of illustrative) {
      const details = page.locator(`[data-anchors-for="${block.id}"]`);
      await expect(details).toHaveCount(1);
      await details.locator('summary').click();
      await expect(details).toHaveAttribute('open', '');
      await expect(details.locator(`[data-anchor="${block.id}"]`)).toHaveCount((block.anchors ?? []).length);
    }
  });
});
