import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildIndex } from '../../scripts/ingest.ts';
import { buildLlmsFullTxt, buildLlmsTxt, validateLlmsTxtGrammar } from '../../src/lib/llms.ts';

const FIXTURE_DIR = resolve(process.cwd(), 'tests', 'fixtures', 'ccgm-mini');
const SITE_URL = 'https://ccgm.dev';

function ingestFixture() {
  return buildIndex({
    repoDir: FIXTURE_DIR,
    sourceSha: 'fixturesha',
    hasOwnGit: false,
    siteSha: 'sitesha',
    generatedAt: '2026-01-01T00:00:00.000Z',
  });
}

describe('buildLlmsTxt grammar', () => {
  it('produces a grammar-valid document over the fixture corpus', () => {
    const { index } = ingestFixture();
    const content = buildLlmsTxt({ siteUrl: SITE_URL, modules: index.modules });
    expect(validateLlmsTxtGrammar(content, SITE_URL)).toEqual([]);
  });

  it('has exactly one H1 reading "# CCGM" as the first line', () => {
    const { index } = ingestFixture();
    const content = buildLlmsTxt({ siteUrl: SITE_URL, modules: index.modules });
    const lines = content.split('\n');
    expect(lines[0]).toBe('# CCGM');
    expect(lines.filter((l) => /^# /.test(l))).toHaveLength(1);
  });

  it('has a blockquote immediately after the H1', () => {
    const { index } = ingestFixture();
    const content = buildLlmsTxt({ siteUrl: SITE_URL, modules: index.modules });
    const lines = content.split('\n');
    expect(lines[1]).toBe('');
    expect(lines[2].startsWith('> ')).toBe(true);
  });

  it('has Docs, Modules, and Optional H2 sections', () => {
    const { index } = ingestFixture();
    const content = buildLlmsTxt({ siteUrl: SITE_URL, modules: index.modules });
    expect(content).toContain('## Docs');
    expect(content).toContain('## Modules');
    expect(content).toContain('## Optional');
  });

  it('links every module and every link is absolute against SITE_URL', () => {
    const { index } = ingestFixture();
    const content = buildLlmsTxt({ siteUrl: SITE_URL, modules: index.modules });
    for (const mod of index.modules) {
      expect(content).toContain(`${SITE_URL}/modules/${mod.name}.md`);
    }
    expect(content).not.toContain('](http://localhost');
  });

  it('the ## Optional section links llms-full.txt', () => {
    const { index } = ingestFixture();
    const content = buildLlmsTxt({ siteUrl: SITE_URL, modules: index.modules });
    expect(content).toContain(`${SITE_URL}/llms-full.txt`);
  });

  it('rejects a document missing a required section', () => {
    const broken = '# CCGM\n\n> summary\n\n## Docs\n\n## Modules\n';
    const violations = validateLlmsTxtGrammar(broken, SITE_URL);
    expect(violations.some((v) => v.includes('Optional'))).toBe(true);
  });

  it('rejects a document with more than one H1', () => {
    const broken = '# CCGM\n\n> summary\n\n# Another\n\n## Docs\n\n## Modules\n\n## Optional\n';
    const violations = validateLlmsTxtGrammar(broken, SITE_URL);
    expect(violations.some((v) => v.includes('H1'))).toBe(true);
  });

  it('rejects a non-absolute link', () => {
    const broken = '# CCGM\n\n> summary\n\n## Docs\n- [x](/relative)\n\n## Modules\n\n## Optional\n';
    const violations = validateLlmsTxtGrammar(broken, SITE_URL);
    expect(violations.some((v) => v.includes('absolute'))).toBe(true);
  });

  it('rejects a module summary line over 120 chars', () => {
    const longDescription = 'x'.repeat(150);
    const broken = `# CCGM\n\n> summary\n\n## Docs\n\n## Modules\n- [Name](${SITE_URL}/modules/x.md): ${longDescription}\n\n## Optional\n`;
    const violations = validateLlmsTxtGrammar(broken, SITE_URL);
    expect(violations.some((v) => v.includes('120'))).toBe(true);
  });
});

describe('buildLlmsFullTxt', () => {
  it('includes every module\'s metadata and per-file manifest with absolute rawUrls, never file bodies', () => {
    const { index } = ingestFixture();
    const content = buildLlmsFullTxt({ siteUrl: SITE_URL, modules: index.modules });

    for (const mod of index.modules) {
      expect(content).toContain(`## ${mod.displayName} (${mod.name})`);
      for (const file of mod.files) {
        expect(content).toContain(`${SITE_URL}${file.rawUrl}`);
      }
    }

    // Never inlines a full file body -- the extension-less script's actual
    // command text should not appear verbatim in the metadata-only companion.
    expect(content).not.toContain('sample-tool ran');
  });

  it('reports "no always-loaded rules" for a zero-rule-file module instead of a bare 0', () => {
    const { index } = ingestFixture();
    const content = buildLlmsFullTxt({ siteUrl: SITE_URL, modules: index.modules });
    expect(content).toContain('no always-loaded rules');
  });
});
