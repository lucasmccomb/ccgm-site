import { describe, expect, it } from 'vitest';
import { buildModuleBundle, cappedBundleLabel, FULL_BUNDLE_LABEL } from '../../src/lib/module-bundle.ts';
import { MAX_INLINE_FILE_BYTES } from '../../src/lib/inline-budget.ts';
import type { ContentFile, FileEntry, ModuleRecord } from '../../src/lib/schema.ts';

/**
 * "Copy entire module as markdown" bundle (§5 E5). Deep-checked against
 * real modules in e2e/modules.spec.ts; this file pins the two hazard
 * behaviours the plan calls out explicitly: merge-fragment exclusion, and
 * the "too large to inline" relabel when the bundle's own budget is spent.
 */

function contentFile(overrides: Partial<ContentFile> & Pick<ContentFile, 'path' | 'type' | 'content'>): ContentFile {
  return {
    hasSubstitutionPlaceholders: false,
    isMergeFragment: false,
    rawUrl: `/modules/fixture/files/${overrides.path}.txt`,
    bytes: Buffer.byteLength(overrides.content, 'utf-8'),
    ...overrides,
  };
}

function fileEntry(cf: ContentFile, merge = false): FileEntry {
  return {
    path: cf.path,
    target: `~/.claude/${cf.path}`,
    type: cf.type,
    template: false,
    merge,
    bytes: cf.bytes,
    isText: true,
    rawUrl: cf.rawUrl,
    resolvedOutsideModule: false,
  };
}

function buildRecord(contentFiles: ContentFile[], overrides: Partial<ModuleRecord> = {}): ModuleRecord {
  return {
    id: 'fixture',
    name: 'fixture',
    displayName: 'Fixture',
    description: 'A fixture module for bundle tests.',
    summary: 'A fixture module for bundle tests.',
    category: 'core',
    scope: [],
    dependencies: [],
    tags: [],
    configPrompts: [],
    files: contentFiles.map((cf) => fileEntry(cf, cf.isMergeFragment)),
    inventory: {},
    contextCostTokens: 0,
    lastUpdated: null,
    lastUpdatedSource: 'unavailable',
    presets: [],
    marketplacePlugin: true,
    readmeMd: '# Fixture\n\nSome README text.',
    contentFiles,
    sourceUrl: 'https://github.com/lucasmccomb/ccgm/tree/abc1234/modules/fixture',
    ...overrides,
  };
}

describe('buildModuleBundle', () => {
  it('embeds full content and uses the plain label when everything fits', () => {
    const files = [contentFile({ path: 'rules/a.md', type: 'rule', content: 'rule body' })];
    const mod = buildRecord(files);

    const bundle = buildModuleBundle(mod, 'https://ccgm.dev', 'abc1234');

    expect(bundle.capped).toBe(false);
    expect(bundle.linkedFileCount).toBe(0);
    expect(bundle.label).toBe(FULL_BUNDLE_LABEL);
    expect(bundle.text).toContain('rule body');
    expect(bundle.text).toContain('# Fixture');
    expect(bundle.text).toContain('Some README text.');
  });

  it('excludes merge fragments entirely -- no content, no manifest link -- and lists them separately by name only', () => {
    const mergeFile = contentFile({
      path: 'settings.partial.json',
      type: 'settings',
      content: '{"secret-shaped-content": true}',
      isMergeFragment: true,
    });
    const ruleFile = contentFile({ path: 'rules/a.md', type: 'rule', content: 'rule body' });
    const mod = buildRecord([mergeFile, ruleFile]);

    const bundle = buildModuleBundle(mod, 'https://ccgm.dev', 'abc1234');

    expect(bundle.text).not.toContain('secret-shaped-content');
    expect(bundle.text).toContain('settings.partial.json'); // named in the excluded-files note, not embedded
    expect(bundle.text).toContain('rule body');
    // The merge fragment must not count toward "too large to inline" bookkeeping.
    expect(bundle.capped).toBe(false);
    expect(bundle.linkedFileCount).toBe(0);
  });

  it('relabels to the capped form and links out when the bundle budget is exceeded', () => {
    const big = contentFile({ path: 'lib/big.py', type: 'lib', content: 'x'.repeat(MAX_INLINE_FILE_BYTES + 1) });
    const small = contentFile({ path: 'rules/a.md', type: 'rule', content: 'rule body' });
    const mod = buildRecord([big, small]);

    const bundle = buildModuleBundle(mod, 'https://ccgm.dev', 'abc1234');

    expect(bundle.capped).toBe(true);
    expect(bundle.linkedFileCount).toBe(1);
    expect(bundle.label).toBe(cappedBundleLabel(1));
    expect(bundle.text).toContain('rule body');
    expect(bundle.text).not.toContain('x'.repeat(MAX_INLINE_FILE_BYTES + 1));
    expect(bundle.text).toContain('Too large to inline here');
    expect(bundle.text).toContain('big.py');
  });

  it('fences file content wider than the longest backtick run already inside it, so a nested ``` never breaks the bundle', () => {
    const content = 'some code:\n```\nnested fence\n```\nmore text';
    const files = [contentFile({ path: 'docs/example.md', type: 'doc', content })];
    const mod = buildRecord(files);

    const bundle = buildModuleBundle(mod, 'https://ccgm.dev', 'abc1234');

    expect(bundle.text).toContain(content);
    expect(bundle.text).toContain('````'); // a 4-backtick fence wraps the 3-backtick content
  });

  it('linkedFileCount pluralizes correctly for exactly one file', () => {
    expect(cappedBundleLabel(1)).toContain('1 file linked');
    expect(cappedBundleLabel(2)).toContain('2 files linked');
  });
});
