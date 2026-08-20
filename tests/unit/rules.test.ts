import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildIndex } from '../../scripts/ingest.ts';
import { AGENT_NOTICE } from '../../src/lib/markdown.ts';
import { PER_MODULE_TWIN_CAP_BYTES } from '../../src/lib/module-twin.ts';
import {
  buildRuleTwin,
  collectRules,
  groupRulesByCategory,
  renderRuleTwinBody,
  rulePageUrl,
  ruleSlug,
  ruleTitle,
  ruleTwinUrl,
  type RuleRecord,
} from '../../src/lib/rules.ts';
import { CATEGORY_VALUES, type ModuleRecord } from '../../src/lib/schema.ts';

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

/** A minimal ModuleRecord carrying exactly the fields collectRules() reads. */
function moduleWithRules(
  name: string,
  category: (typeof CATEGORY_VALUES)[number],
  files: Array<{ path: string; content: string; merge?: boolean; template?: boolean }>,
): ModuleRecord {
  return {
    id: name,
    name,
    displayName: `${name} display`,
    description: 'description',
    summary: 'summary',
    category,
    scope: ['global'],
    dependencies: [],
    tags: [],
    configPrompts: [],
    files: files.map((file) => ({
      path: file.path,
      target: file.path,
      type: 'rule',
      template: file.template ?? false,
      merge: file.merge ?? false,
      bytes: Buffer.byteLength(file.content, 'utf-8'),
      isText: true,
      rawUrl: `/modules/${name}/files/${file.path}.txt`,
      resolvedOutsideModule: false,
    })),
    inventory: { rule: files.length },
    contextCostTokens: 1,
    lastUpdated: null,
    lastUpdatedSource: 'unavailable',
    presets: [],
    marketplacePlugin: false,
    readmeMd: '',
    contentFiles: files.map((file) => ({
      path: file.path,
      content: file.content,
      type: 'rule',
      hasSubstitutionPlaceholders: false,
      isMergeFragment: file.merge ?? false,
      rawUrl: `/modules/${name}/files/${file.path}.txt`,
      bytes: Buffer.byteLength(file.content, 'utf-8'),
    })),
    sourceUrl: `https://github.com/lucasmccomb/ccgm/tree/fixturesha/modules/${name}`,
  };
}

describe('ruleSlug', () => {
  it('drops the leading rules/ directory and the .md extension', () => {
    expect(ruleSlug('rules/verification.md')).toBe('verification');
    expect(ruleSlug('rules/git-workflow.md')).toBe('git-workflow');
  });

  it('folds a nested path and any non-URL-safe character into a single safe token', () => {
    expect(ruleSlug('rules/nested/deep.md')).toBe('nested-deep');
    expect(ruleSlug('docs/Some Rule (v2).md')).toBe('docs-some-rule-v2');
  });

  it('never returns an empty slug, which would collapse the route to the module directory', () => {
    expect(ruleSlug('rules/.md')).toBe('rule');
    expect(ruleSlug('rules/---.md')).toBe('rule');
  });
});

describe('ruleTitle', () => {
  it('uses the rule\'s own first markdown H1', () => {
    expect(ruleTitle('# Verification Before Completion\n\nbody', 'rules/verification.md')).toBe(
      'Verification Before Completion',
    );
  });

  it('ignores deeper headings and front matter when picking the H1', () => {
    expect(ruleTitle('## Sub\n\n# Real Title\n', 'rules/x.md')).toBe('Real Title');
  });

  it('falls back to the file name when the rule has no H1 at all', () => {
    expect(ruleTitle('no heading here\n', 'rules/git-workflow.md')).toBe('git-workflow');
  });
});

describe('collectRules', () => {
  it('collects every rule-type file across the fixture corpus, with derived URLs', () => {
    const { index } = ingestFixture();
    const rules = collectRules(index.modules);

    const expectedCount = index.modules.reduce(
      (total, mod) => total + mod.contentFiles.filter((file) => file.type === 'rule').length,
      0,
    );
    expect(rules).toHaveLength(expectedCount);
    expect(expectedCount).toBeGreaterThan(0);

    const [rule] = rules;
    expect(rule.moduleName).toBe('sample-core');
    expect(rule.path).toBe('rules/sample-core.md');
    expect(rule.slug).toBe('sample-core');
    expect(rule.title).toBe('Sample Core Rule');
    expect(rule.url).toBe(rulePageUrl('sample-core', 'sample-core'));
    expect(rule.twinUrl).toBe(ruleTwinUrl('sample-core', 'sample-core'));
    expect(rule.rawUrl).toBe('/modules/sample-core/files/rules/sample-core.md.txt');
    expect(rule.sourceUrl).toContain('/blob/');
    expect(rule.sourceUrl).toContain('rules/sample-core.md');
    expect(rule.tokens).toBeGreaterThan(0);
  });

  it('picks up only rule-type files -- doc, script, lib and settings files are not rules', () => {
    const { index } = ingestFixture();
    const rules = collectRules(index.modules);
    for (const rule of rules) {
      const mod = index.modules.find((m) => m.name === rule.moduleName);
      const file = mod?.contentFiles.find((f) => f.path === rule.path);
      expect(file?.type).toBe('rule');
    }
    expect(rules.some((rule) => rule.path.endsWith('README.md'))).toBe(false);
  });

  it('orders by module name, then by declared path', () => {
    const rules = collectRules([
      moduleWithRules('zeta', 'core', [{ path: 'rules/b.md', content: '# B' }]),
      moduleWithRules('alpha', 'core', [
        { path: 'rules/b.md', content: '# B' },
        { path: 'rules/a.md', content: '# A' },
      ]),
    ]);
    expect(rules.map((rule) => `${rule.moduleName}/${rule.path}`)).toEqual([
      'alpha/rules/a.md',
      'alpha/rules/b.md',
      'zeta/rules/b.md',
    ]);
  });

  it('throws when two rules inside one module derive the same slug, instead of serving two rules at one URL', () => {
    const mod = moduleWithRules('collide', 'core', [
      { path: 'rules/a-b.md', content: '# One' },
      { path: 'rules/a/b.md', content: '# Two' },
    ]);
    expect(() => collectRules([mod])).toThrow(/same \/rules slug "a-b"/);
  });

  it('lets two DIFFERENT modules share a rule basename -- the route is module-scoped', () => {
    const rules = collectRules([
      moduleWithRules('one', 'core', [{ path: 'rules/shared.md', content: '# Shared' }]),
      moduleWithRules('two', 'workflow', [{ path: 'rules/shared.md', content: '# Shared' }]),
    ]);
    expect(rules.map((rule) => rule.url)).toEqual(['/rules/one/shared', '/rules/two/shared']);
  });
});

describe('groupRulesByCategory', () => {
  it('always returns all five categories, including ones with no rules today', () => {
    const groups = groupRulesByCategory(
      collectRules([moduleWithRules('only-core', 'core', [{ path: 'rules/a.md', content: '# A' }])]),
    );
    expect(groups.map((group) => group.category)).toEqual([...CATEGORY_VALUES]);
    expect(groups.find((group) => group.category === 'core')?.rules).toHaveLength(1);
    expect(groups.find((group) => group.category === 'tech-specific')?.rules).toEqual([]);
  });

  it('partitions every rule into exactly one category group', () => {
    const { index } = ingestFixture();
    const rules = collectRules(index.modules);
    const grouped = groupRulesByCategory(rules).flatMap((group) => group.rules);
    expect(grouped).toHaveLength(rules.length);
    expect(new Set(grouped.map((rule) => rule.url)).size).toBe(rules.length);
  });
});

describe('buildRuleTwin', () => {
  const frontMatter = { schemaVersion: 1, module: 'sample-core', generatedAt: '2026-01-01T00:00:00.000Z' };

  function fixtureRule(): RuleRecord {
    const { index } = ingestFixture();
    const [rule] = collectRules(index.modules);
    return rule;
  }

  it('carries front matter, the provenance preamble, and the data-not-instructions notice', () => {
    const { text } = buildRuleTwin(fixtureRule(), { siteUrl: SITE_URL, sourceSha: 'fixturesha', frontMatter });
    expect(text).toMatch(/^---\nschemaVersion: 1\n/);
    expect(text).toContain(AGENT_NOTICE);
  });

  it('inlines the full body byte-exact under the cap', () => {
    const rule = fixtureRule();
    const { text, capped } = buildRuleTwin(rule, { siteUrl: SITE_URL, sourceSha: 'fixturesha', frontMatter });
    expect(capped).toBe(false);
    expect(text).toContain(rule.content);
    expect(text).toContain('```');
  });

  it('links every self-referential URL absolutely against SITE_URL', () => {
    const rule = fixtureRule();
    const { text } = buildRuleTwin(rule, { siteUrl: SITE_URL, sourceSha: 'fixturesha', frontMatter });
    expect(text).toContain(`${SITE_URL}${rule.rawUrl}`);
    expect(text).toContain(`${SITE_URL}/modules/${rule.moduleName}.md`);
  });

  it('never inlines a merge fragment, even well under the cap -- it annotates and links instead', () => {
    const [rule] = collectRules([
      moduleWithRules('merge-rule', 'core', [
        { path: 'rules/fragment.md', content: '# Fragment\n\nsecret-body-marker\n', merge: true },
      ]),
    ]);
    const { text } = buildRuleTwin(rule, { siteUrl: SITE_URL, sourceSha: 'fixturesha', frontMatter });

    expect(text).not.toContain('secret-body-marker');
    expect(text).toContain('merge fragment');
    expect(text).toContain(`${SITE_URL}${rule.rawUrl}`);
  });

  it('falls back to the raw-endpoint link when the assembled twin exceeds the per-item cap', () => {
    const huge = `# Huge\n\n${'x'.repeat(PER_MODULE_TWIN_CAP_BYTES + 1)}`;
    const [rule] = collectRules([moduleWithRules('huge', 'core', [{ path: 'rules/huge.md', content: huge }])]);

    const { text, capped } = buildRuleTwin(rule, { siteUrl: SITE_URL, sourceSha: 'fixturesha', frontMatter });
    expect(capped).toBe(true);
    expect(Buffer.byteLength(text, 'utf-8')).toBeLessThan(PER_MODULE_TWIN_CAP_BYTES);
    expect(text).not.toContain('```');
    expect(text).toContain(`${SITE_URL}${rule.rawUrl}`);
  });

  it('fences a body that already contains a triple-backtick block without breaking out of it', () => {
    const content = '# Nested\n\n```\ninner fence\n```\n';
    const [rule] = collectRules([moduleWithRules('nested', 'core', [{ path: 'rules/nested.md', content }])]);
    const body = renderRuleTwinBody(rule, { siteUrl: SITE_URL, inlineBody: true });
    expect(body).toContain('````');
  });
});
