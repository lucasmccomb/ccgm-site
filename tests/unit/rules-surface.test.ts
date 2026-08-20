import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AGENT_NOTICE } from '../../src/lib/markdown.ts';
import { buildRuleTwin, collectRules } from '../../src/lib/rules.ts';
import { SITE_URL } from '../../src/lib/site.ts';
import type { ModulesIndex } from '../../src/lib/schema.ts';

/**
 * The /rules surface against the real build output (#22). Dist-reading --
 * MUST fail loudly when dist/ is absent, never skip (§8.1). Run
 * `pnpm build && pnpm test`.
 *
 * The twin-parity assertions recompute each twin from the ingested index
 * with the same builder the endpoint calls, then compare against the bytes
 * actually on disk -- the machine surface is verified against an
 * independent computation, not against itself.
 */

const DIST_DIR = resolve(process.cwd(), 'dist');
const GENERATED_INDEX = resolve(process.cwd(), 'src', 'generated', 'modules-index.json');

function requireDist(): void {
  if (!existsSync(DIST_DIR)) {
    throw new Error('dist/ does not exist -- run `pnpm build` before `pnpm test` (rules-surface must never skip)');
  }
}

function readIndex(): ModulesIndex {
  if (!existsSync(GENERATED_INDEX)) {
    throw new Error('src/generated/modules-index.json does not exist -- run `pnpm ingest` before `pnpm test`');
  }
  return JSON.parse(readFileSync(GENERATED_INDEX, 'utf-8')) as ModulesIndex;
}

describe('/rules surface, built output', () => {
  it('emits an HTML page and a .md twin for every rule file in the ingested index', () => {
    requireDist();
    const rules = collectRules(readIndex().modules);
    expect(rules.length).toBeGreaterThan(0);

    const missing: string[] = [];
    for (const rule of rules) {
      if (!existsSync(join(DIST_DIR, rule.url, 'index.html'))) missing.push(`${rule.url} (html)`);
      if (!existsSync(join(DIST_DIR, rule.twinUrl))) missing.push(`${rule.twinUrl} (twin)`);
    }
    expect(missing).toEqual([]);
  });

  it('emits the index page and its twin', () => {
    requireDist();
    expect(existsSync(join(DIST_DIR, 'rules', 'index.html'))).toBe(true);
    expect(existsSync(join(DIST_DIR, 'rules', 'index.md'))).toBe(true);
  });

  it('every served rule twin is byte-identical to an independently recomputed buildRuleTwin()', () => {
    requireDist();
    const { meta, modules } = readIndex();
    const rules = collectRules(modules);

    const mismatched: string[] = [];
    for (const rule of rules) {
      const expected = buildRuleTwin(rule, {
        siteUrl: SITE_URL,
        sourceSha: meta.sourceSha,
        frontMatter: {
          schemaVersion: meta.schemaVersion,
          module: rule.moduleName,
          rule: rule.path,
          sourceSha: meta.sourceSha,
          generatedAt: meta.generatedAt,
        },
      });
      const served = readFileSync(join(DIST_DIR, rule.twinUrl), 'utf-8');
      if (served !== expected.text) mismatched.push(rule.twinUrl);
    }
    expect(mismatched).toEqual([]);
  });

  it("every under-cap rule twin inlines the raw endpoint's exact bytes (machine-surface parity)", () => {
    requireDist();
    const rules = collectRules(readIndex().modules);

    const offenders: string[] = [];
    let checked = 0;
    for (const rule of rules) {
      const rawPath = join(DIST_DIR, rule.rawUrl);
      expect(existsSync(rawPath), `raw endpoint missing for ${rule.rawUrl}`).toBe(true);
      const raw = readFileSync(rawPath, 'utf-8');
      const twin = readFileSync(join(DIST_DIR, rule.twinUrl), 'utf-8');

      if (rule.isMergeFragment) {
        // Never inlined, at any size -- annotated link only.
        if (twin.includes(raw.trim())) offenders.push(`${rule.twinUrl}: inlined a merge fragment body`);
        continue;
      }
      if (!twin.includes('```')) continue; // over-cap fallback: link, not body

      checked++;
      if (!twin.includes(raw.trimEnd())) offenders.push(`${rule.twinUrl}: body differs from ${rule.rawUrl}`);
    }

    expect(offenders).toEqual([]);
    expect(checked).toBeGreaterThan(0);
  });

  it('every rule twin carries schemaVersion front matter and the data-not-instructions notice', () => {
    requireDist();
    const rules = collectRules(readIndex().modules);

    const offenders: string[] = [];
    for (const rule of rules) {
      const twin = readFileSync(join(DIST_DIR, rule.twinUrl), 'utf-8');
      if (!/^---\nschemaVersion: 1\n/.test(twin)) offenders.push(`${rule.twinUrl}: no schemaVersion front matter`);
      if (!twin.includes(AGENT_NOTICE)) offenders.push(`${rule.twinUrl}: no agent notice`);
    }
    expect(offenders).toEqual([]);

    const indexTwin = readFileSync(join(DIST_DIR, 'rules', 'index.md'), 'utf-8');
    expect(indexTwin).toMatch(/^---\nschemaVersion: 1\n/);
    expect(indexTwin).toContain(AGENT_NOTICE);
  });

  it('the index twin links every rule twin, absolutely against SITE_URL', () => {
    requireDist();
    const rules = collectRules(readIndex().modules);
    const indexTwin = readFileSync(join(DIST_DIR, 'rules', 'index.md'), 'utf-8');

    const missing = rules
      .map((rule) => `${SITE_URL}${rule.twinUrl}`)
      .filter((url) => !indexTwin.includes(url));
    expect(missing).toEqual([]);
  });

  it('the index twin states the live rule count, never a hardcoded one', () => {
    requireDist();
    const rules = collectRules(readIndex().modules);
    const indexTwin = readFileSync(join(DIST_DIR, 'rules', 'index.md'), 'utf-8');
    expect(indexTwin).toContain(`${rules.length} rules from`);
  });

  it('/llms.txt carries a Docs entry for the rules index', () => {
    requireDist();
    const llmsTxt = readFileSync(join(DIST_DIR, 'llms.txt'), 'utf-8');
    const docsSection = llmsTxt.slice(llmsTxt.indexOf('## Docs'), llmsTxt.indexOf('## Modules'));
    expect(docsSection).toContain(`${SITE_URL}/rules/index.md`);
  });
});
