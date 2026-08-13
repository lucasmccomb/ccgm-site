import { describe, expect, it } from 'vitest';
import { buildModuleTwin, cappedTwinLabel, FULL_TWIN_LABEL, PER_MODULE_TWIN_CAP_BYTES, renderModuleTwinBody } from '../../src/lib/module-twin.ts';
import type { ContentFile, ModuleRecord } from '../../src/lib/schema.ts';

/**
 * §3.4 clarification (decisions.md): a module's .md twin inlines every
 * text file's full body when the resulting twin fits the 512 KB
 * per-module cap; merge fragments are NEVER inlined regardless of size,
 * always rendering as an annotated link instead. Over-cap modules fall
 * back to the original links-only body, unchanged.
 *
 * buildModuleTwin() is the single computation both /modules/{name}.md and
 * the detail page's "copy entire module" button call -- these tests pin
 * its under-cap/over-cap branches directly, plus renderModuleTwinBody()'s
 * two body shapes it composes from.
 */

function buildRecord(overrides: Partial<ModuleRecord> = {}, contentFiles: ContentFile[] = []): ModuleRecord {
  const mergeFile = {
    path: 'settings.partial.json',
    target: '~/.claude/settings.json',
    type: 'settings',
    template: false,
    merge: true,
    bytes: 32,
    isText: true,
    rawUrl: '/modules/fixture/files/settings.partial.json.txt',
    resolvedOutsideModule: false,
  };
  const ruleFile = {
    path: 'rules/fixture.md',
    target: '~/.claude/rules/fixture.md',
    type: 'rule',
    template: false,
    merge: false,
    bytes: 20,
    isText: true,
    rawUrl: '/modules/fixture/files/rules/fixture.md.txt',
    resolvedOutsideModule: false,
  };

  return {
    id: 'fixture',
    name: 'fixture',
    displayName: 'Fixture',
    description: 'A fixture module.',
    summary: 'A fixture module.',
    category: 'core',
    scope: [],
    dependencies: [],
    tags: [],
    configPrompts: [],
    files: [mergeFile, ruleFile],
    inventory: { settings: 1, rule: 1 },
    contextCostTokens: 5,
    lastUpdated: null,
    lastUpdatedSource: 'unavailable',
    presets: [],
    marketplacePlugin: true,
    readmeMd: '',
    contentFiles: contentFiles.length > 0
      ? contentFiles
      : [
          {
            path: 'settings.partial.json',
            content: '{"hooks": {"secret-shaped": true}}',
            type: 'settings',
            hasSubstitutionPlaceholders: false,
            isMergeFragment: true,
            rawUrl: '/modules/fixture/files/settings.partial.json.txt',
            bytes: 32,
          },
          {
            path: 'rules/fixture.md',
            content: '# Fixture rule\n\nBody text.',
            type: 'rule',
            hasSubstitutionPlaceholders: false,
            isMergeFragment: false,
            rawUrl: '/modules/fixture/files/rules/fixture.md.txt',
            bytes: 27,
          },
        ],
    sourceUrl: 'https://github.com/lucasmccomb/ccgm/tree/abc1234/modules/fixture',
    ...overrides,
  };
}

describe('renderModuleTwinBody', () => {
  it('inlineFileBodies: false lists every declared file as a flat link, merge fragments included (unchanged pre-existing behaviour)', () => {
    const body = renderModuleTwinBody(buildRecord(), { inlineReadme: true, inlineFileBodies: false });
    expect(body).toContain('- `settings.partial.json`');
    expect(body).toContain('- `rules/fixture.md`');
    expect(body).not.toContain('secret-shaped');
    expect(body).not.toContain('Body text.');
  });

  it('inlineFileBodies: true inlines a non-merge file\'s full content, but never a merge fragment\'s', () => {
    const body = renderModuleTwinBody(buildRecord(), { inlineReadme: true, inlineFileBodies: true });

    expect(body).toContain('Body text.');
    expect(body).toContain('# Fixture rule');

    expect(body).not.toContain('secret-shaped');
    expect(body).toContain('merge fragment');
    expect(body).toContain('/modules/fixture/files/settings.partial.json.txt');
  });
});

describe('buildModuleTwin', () => {
  it('a small module stays under the cap: full body inlining, capped: false, linkedFileCount: 0', () => {
    const result = buildModuleTwin(buildRecord(), {
      siteUrl: 'https://ccgm.dev',
      sourceSha: 'abc1234',
      frontMatter: { schemaVersion: 1, module: 'fixture', sourceSha: 'abc1234', generatedAt: '2026-01-01T00:00:00.000Z' },
    });

    expect(result.capped).toBe(false);
    expect(result.linkedFileCount).toBe(0);
    expect(result.text).toContain('Body text.');
    expect(result.text).not.toContain('secret-shaped');
    expect(Buffer.byteLength(result.text, 'utf-8')).toBeLessThanOrEqual(PER_MODULE_TWIN_CAP_BYTES);
  });

  it('a module whose full-body twin exceeds the cap falls back to links-only: capped: true, linkedFileCount counts non-merge files', () => {
    const hugeContent = 'x'.repeat(PER_MODULE_TWIN_CAP_BYTES + 1024);
    const hugeFile = {
      path: 'lib/huge.py',
      target: '~/.claude/lib/huge.py',
      type: 'lib',
      template: false,
      merge: false,
      bytes: hugeContent.length,
      isText: true,
      rawUrl: '/modules/fixture/files/lib/huge.py.txt',
      resolvedOutsideModule: false,
    };
    const hugeContentFile: ContentFile = {
      path: 'lib/huge.py',
      content: hugeContent,
      type: 'lib',
      hasSubstitutionPlaceholders: false,
      isMergeFragment: false,
      rawUrl: '/modules/fixture/files/lib/huge.py.txt',
      bytes: hugeContent.length,
    };

    const mod = buildRecord(
      { files: [{ ...buildRecord().files[0] }, { ...buildRecord().files[1] }, hugeFile] },
      [...buildRecord().contentFiles, hugeContentFile],
    );

    const result = buildModuleTwin(mod, {
      siteUrl: 'https://ccgm.dev',
      sourceSha: 'abc1234',
      frontMatter: { schemaVersion: 1, module: 'fixture', sourceSha: 'abc1234', generatedAt: '2026-01-01T00:00:00.000Z' },
    });

    expect(result.capped).toBe(true);
    // 2 non-merge files (rules/fixture.md, lib/huge.py) -- the merge
    // fragment is excluded from the link count, matching mod.files.filter(f => !f.merge).
    expect(result.linkedFileCount).toBe(2);
    // The fallback is the original links-only body: no fenced code block
    // for the huge file, just its flat link line.
    expect(result.text).not.toContain('```');
    expect(result.text).toContain('- `lib/huge.py`');
    expect(result.text).not.toContain(hugeContent);
    expect(result.text).not.toContain('secret-shaped');
  });

  it('cappedTwinLabel pluralizes correctly', () => {
    expect(cappedTwinLabel(1)).toContain('1 file linked');
    expect(cappedTwinLabel(2)).toContain('2 files linked');
    expect(FULL_TWIN_LABEL).toBe('copy entire module as markdown');
  });
});
