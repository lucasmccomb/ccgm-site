import { describe, expect, it } from 'vitest';
import { renderModuleTwinBody } from '../../src/lib/module-twin.ts';
import type { ModuleRecord } from '../../src/lib/schema.ts';

/**
 * renderModuleTwinBody was extracted from src/pages/modules/[name].md.ts
 * (§5 E5) so the detail page's copy-entire-module bundle
 * (src/lib/module-bundle.ts) can reuse the same header/metadata rendering.
 * These tests pin the one new behaviour (excludeMergeFragments) and the
 * backward-compat default that [name].md.ts depends on byte-for-byte.
 */

function buildRecord(overrides: Partial<ModuleRecord> = {}): ModuleRecord {
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
    files: [
      {
        path: 'settings.partial.json',
        target: '~/.claude/settings.json',
        type: 'settings',
        template: false,
        merge: true,
        bytes: 10,
        isText: true,
        rawUrl: '/modules/fixture/files/settings.partial.json.txt',
        resolvedOutsideModule: false,
      },
      {
        path: 'rules/fixture.md',
        target: '~/.claude/rules/fixture.md',
        type: 'rule',
        template: false,
        merge: false,
        bytes: 20,
        isText: true,
        rawUrl: '/modules/fixture/files/rules/fixture.md.txt',
        resolvedOutsideModule: false,
      },
    ],
    inventory: { settings: 1, rule: 1 },
    contextCostTokens: 5,
    lastUpdated: null,
    lastUpdatedSource: 'unavailable',
    presets: [],
    marketplacePlugin: true,
    readmeMd: '',
    contentFiles: [],
    sourceUrl: 'https://github.com/lucasmccomb/ccgm/tree/abc1234/modules/fixture',
    ...overrides,
  };
}

describe('renderModuleTwinBody', () => {
  it('defaults to listing every declared file, merge fragments included (unchanged /modules/{name}.md behaviour)', () => {
    const body = renderModuleTwinBody(buildRecord(), { inlineReadme: true });
    expect(body).toContain('settings.partial.json');
    expect(body).toContain('rules/fixture.md');
  });

  it('excludeMergeFragments: true omits merge-fragment entries from the Files manifest', () => {
    const body = renderModuleTwinBody(buildRecord(), { inlineReadme: true, excludeMergeFragments: true });
    expect(body).not.toContain('settings.partial.json');
    expect(body).toContain('rules/fixture.md');
  });
});
