import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COMMAND_EXAMPLES,
  PROVENANCE_LABEL,
  allBlocks,
  provenanceCounts,
  provenanceTallyLine,
  resolveSource,
  type ExampleSource,
} from '../../src/lib/examples.ts';
import { loadModulesIndex } from '../../src/lib/generated.ts';
import type { ModulesIndex } from '../../src/lib/schema.ts';

/**
 * The sourcing-honesty contract for /examples (#23), enforced structurally
 * rather than by review. Two halves:
 *
 *  1. Against the INGESTED CORPUS -- every declared source resolves to a real,
 *     declared, text-bearing file; every `verbatim` block is a byte-exact
 *     substring of that file; every `illustrative` block's anchors are too.
 *     A quoted block that drifts from ccgm's file, or an authored transcript
 *     line with no documented shape behind it, fails here.
 *  2. Against the BUILT PAGE -- every rendered block carries its provenance as
 *     an attribute, and every illustrative one carries the visible label. This
 *     half reads dist/ and MUST fail loudly when dist/ is absent, never skip
 *     (§8.1), same as every other dist-reading suite.
 */

const DIST_DIR = resolve(process.cwd(), 'dist');

function requireDist(): void {
  if (!existsSync(DIST_DIR)) {
    throw new Error(
      'dist/ does not exist -- run `pnpm build` before `pnpm test` (examples must never skip)',
    );
  }
}

function builtExamplesHtml(): string {
  requireDist();
  const path = join(DIST_DIR, 'examples', 'index.html');
  if (!existsSync(path)) {
    throw new Error(`${path} does not exist -- the /examples page did not build`);
  }
  return readFileSync(path, 'utf-8');
}

/** The ingested body of one declared file, or a loud failure naming the gap. */
function sourceContent(index: ModulesIndex, source: ExampleSource): string {
  const mod = index.modules.find((candidate) => candidate.name === source.module);
  expect(mod, `example source names an unknown module: ${source.module}`).toBeDefined();

  const contentFile = mod!.contentFiles.find((candidate) => candidate.path === source.path);
  expect(
    contentFile,
    `example source ${source.module}/${source.path} has no ingested text content ` +
      '(it is not a text file, or it is not declared by that module.json)',
  ).toBeDefined();

  return contentFile!.content;
}

describe('examples: declared sources resolve against the ingested ccgm corpus', () => {
  it('every source names a real module and a file that module actually declares', () => {
    const index = loadModulesIndex();

    for (const block of allBlocks()) {
      expect(block.sources.length, `block "${block.id}" declares no source`).toBeGreaterThan(0);
      for (const source of block.sources) {
        // resolveSource throws (with the offending module/path named) rather
        // than returning a partial record -- the same failure the page build
        // takes if an attribution goes stale.
        const resolved = resolveSource(index, source);
        expect(resolved.rawUrl, `${source.module}/${source.path} resolved to an empty rawUrl`).toMatch(
          /^\/modules\/.+\.txt$/,
        );
        expect(resolved.modulePath).toBe(`/modules/${source.module}`);
      }
    }
  });

  it('every declared source is text-bearing, so its content can actually be checked', () => {
    const index = loadModulesIndex();
    for (const block of allBlocks()) {
      for (const source of block.sources) {
        expect(
          sourceContent(index, source).length,
          `${source.module}/${source.path} ingested as empty content`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('every example names a module that is in the ingested index', () => {
    const index = loadModulesIndex();
    const names = new Set(index.modules.map((mod) => mod.name));
    for (const example of COMMAND_EXAMPLES) {
      expect(names.has(example.module), `example "${example.id}" names unknown module ${example.module}`).toBe(
        true,
      );
    }
  });
});

describe('examples: provenance contract (the sourcing-honesty gate)', () => {
  it('every VERBATIM block appears byte-for-byte in one of its declared sources', () => {
    const index = loadModulesIndex();
    const offenders: string[] = [];

    for (const block of allBlocks()) {
      if (block.provenance !== 'verbatim') continue;

      const found = block.sources.some((source) => sourceContent(index, source).includes(block.text));
      if (!found) {
        const where = block.sources.map((s) => `${s.module}/${s.path}`).join(', ');
        offenders.push(
          `block "${block.id}" is labelled verbatim but its text is not a byte-exact substring of ${where}`,
        );
      }
    }

    expect(offenders).toEqual([]);
  });

  it('every ILLUSTRATIVE block carries anchors, and every anchor appears byte-for-byte in one of its sources', () => {
    const index = loadModulesIndex();
    const offenders: string[] = [];

    for (const block of allBlocks()) {
      if (block.provenance !== 'illustrative') continue;

      const anchors = block.anchors ?? [];
      if (anchors.length === 0) {
        offenders.push(
          `block "${block.id}" is labelled illustrative but declares no anchors -- an authored ` +
            'transcript with nothing behind it is an invented capability',
        );
        continue;
      }

      for (const anchor of anchors) {
        expect(anchor.licenses.trim().length, `anchor in "${block.id}" has an empty licenses note`).toBeGreaterThan(0);
        const found = block.sources.some((source) => sourceContent(index, source).includes(anchor.text));
        if (!found) {
          const where = block.sources.map((s) => `${s.module}/${s.path}`).join(', ');
          offenders.push(`block "${block.id}": anchor ${JSON.stringify(anchor.text)} is not present in ${where}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('a VERBATIM block never carries anchors (anchors are the illustrative-only mechanism)', () => {
    for (const block of allBlocks()) {
      if (block.provenance === 'verbatim') {
        expect(block.anchors, `verbatim block "${block.id}" should not declare anchors`).toBeUndefined();
      }
    }
  });

  it('both provenance values are actually exercised, so neither label goes untested', () => {
    const counts = provenanceCounts();
    expect(counts.verbatim).toBeGreaterThan(0);
    expect(counts.illustrative).toBeGreaterThan(0);
  });

  it('the tally line is derived from the data, never hand-counted', () => {
    const counts = provenanceCounts();
    const line = provenanceTallyLine();
    expect(line).toContain(`${COMMAND_EXAMPLES.length} commands`);
    expect(line).toContain(`${counts.verbatim} quoted verbatim`);
    expect(line).toContain(`${counts.illustrative} authored`);
  });
});

describe('examples: structural shape', () => {
  it('example ids and block ids are unique and safe to use as DOM ids', () => {
    const exampleIds = COMMAND_EXAMPLES.map((example) => example.id);
    expect(new Set(exampleIds).size).toBe(exampleIds.length);

    const blockIds = allBlocks().map((block) => block.id);
    expect(new Set(blockIds).size).toBe(blockIds.length);

    for (const id of [...exampleIds, ...blockIds]) {
      expect(id, `"${id}" is not a safe DOM id token`).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it('every example carries a command, a summary, at least one paragraph, and at least one block', () => {
    for (const example of COMMAND_EXAMPLES) {
      expect(example.command, `example "${example.id}" has no command`).toMatch(/^\/[a-z][a-z0-9-]*$/);
      expect(example.summary.trim().length).toBeGreaterThan(0);
      expect(example.whatHappens.length, `example "${example.id}" has no prose`).toBeGreaterThan(0);
      expect(example.blocks.length, `example "${example.id}" has no blocks`).toBeGreaterThan(0);
      for (const paragraph of example.whatHappens) {
        expect(paragraph.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('the examples span more than one ccgm module and more than one category', () => {
    const index = loadModulesIndex();
    const modules = new Set(COMMAND_EXAMPLES.map((example) => example.module));
    const categories = new Set(
      COMMAND_EXAMPLES.map(
        (example) => index.modules.find((mod) => mod.name === example.module)?.category ?? 'unknown',
      ),
    );
    expect(modules.size).toBeGreaterThan(1);
    expect(categories.size).toBeGreaterThan(1);
  });
});

describe('examples: the built page carries the labelling contract (dist-reading, never skipped)', () => {
  it('every block renders with a data-provenance attribute matching its declared value', () => {
    const html = builtExamplesHtml();

    for (const block of allBlocks()) {
      const pattern = new RegExp(
        `<[^>]*\\bdata-example-block\\b[^>]*\\bdata-block-id="${block.id}"[^>]*>`,
      );
      const match = pattern.exec(html);
      expect(match, `no [data-example-block] with data-block-id="${block.id}" in the built page`).not.toBeNull();
      expect(match![0], `block "${block.id}" rendered without its data-provenance`).toContain(
        `data-provenance="${block.provenance}"`,
      );
    }
  });

  it('the number of rendered blocks equals the number of declared blocks -- no stray or missing block', () => {
    const html = builtExamplesHtml();
    const rendered = html.match(/\bdata-example-block\b/g) ?? [];
    expect(rendered.length).toBe(allBlocks().length);
  });

  it('every illustrative block renders the visible illustrative label as text, not just an attribute', () => {
    const html = builtExamplesHtml();
    const illustrative = allBlocks().filter((block) => block.provenance === 'illustrative');
    expect(illustrative.length).toBeGreaterThan(0);

    for (const block of illustrative) {
      const marker = `data-illustrative-label="${block.id}"`;
      expect(html, `block "${block.id}" has no [data-illustrative-label]`).toContain(marker);
    }

    // The label text itself is on the page, so "illustrative" is readable
    // prose to a visitor, not an attribute only a scraper can see.
    expect(html).toContain(PROVENANCE_LABEL.illustrative);
  });

  it('every anchor of every illustrative block is listed on the page', () => {
    const html = builtExamplesHtml();
    for (const block of allBlocks()) {
      if (block.provenance !== 'illustrative') continue;
      const rendered = html.match(new RegExp(`data-anchor="${block.id}"`, 'g')) ?? [];
      expect(rendered.length, `block "${block.id}" rendered ${rendered.length} anchors`).toBe(
        (block.anchors ?? []).length,
      );
    }
  });

  it('every declared source is linked from the built page by its raw-text endpoint', () => {
    const html = builtExamplesHtml();
    const index = loadModulesIndex();

    for (const block of allBlocks()) {
      for (const source of block.sources) {
        const resolved = resolveSource(index, source);
        expect(html, `${source.module}/${source.path} is not linked from the page`).toContain(
          `href="${resolved.rawUrl}"`,
        );
      }
    }
  });

  it('the Markdown twin carries every block, its provenance label, and its body byte-for-byte', () => {
    requireDist();
    const twinPath = join(DIST_DIR, 'examples.md');
    expect(existsSync(twinPath), `${twinPath} does not exist -- the /examples twin did not build`).toBe(true);

    const twin = readFileSync(twinPath, 'utf-8');
    for (const block of allBlocks()) {
      expect(twin, `block "${block.id}" is missing its caption in the twin`).toContain(block.caption);
      expect(twin, `block "${block.id}" is missing its provenance label in the twin`).toContain(
        PROVENANCE_LABEL[block.provenance],
      );
      // Parity, not paraphrase: the twin must carry the same bytes the page
      // shows, so an agent reading the twin sees the same quoted output.
      expect(twin, `block "${block.id}" body is not byte-identical in the twin`).toContain(block.text);
    }
  });

  it('the twin repeats every anchor verbatim, so its traceability matches the page', () => {
    requireDist();
    const twin = readFileSync(join(DIST_DIR, 'examples.md'), 'utf-8');

    for (const block of allBlocks()) {
      for (const anchor of block.anchors ?? []) {
        // Single-line by contract: the twin inline-codes anchors, and a
        // multi-line anchor would need a fence instead.
        expect(anchor.text, `anchor in "${block.id}" spans lines`).not.toContain('\n');
        expect(twin, `anchor ${JSON.stringify(anchor.text)} is missing from the twin`).toContain(anchor.text);
        expect(twin, `anchor note for "${block.id}" is missing from the twin`).toContain(anchor.licenses);
      }
    }
  });
});
