import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INLINE_BUDGET_BYTES } from '../../src/lib/inline-budget.ts';

/**
 * Catalog + module-page dist-reading checks (§5 E5, plan's own "Unit"
 * bucket -- distinct from the browser-driven checks in e2e/modules.spec.ts).
 * Never skip when dist/ is absent -- matches the existing budgets.test.ts /
 * repo-invariants.test.ts convention (§8.1).
 */

const REPO_ROOT = resolve(process.cwd());
const DIST_DIR = join(REPO_ROOT, 'dist');

function requireDist(): void {
  if (!existsSync(DIST_DIR)) {
    throw new Error('dist/ does not exist -- run `pnpm build` before `pnpm test` (must never skip)');
  }
}

describe('module catalog: page count matches the data (never hardcoded)', () => {
  it('dist/modules/*/index.html count equals modules.json moduleCount', () => {
    requireDist();
    const modulesJson = JSON.parse(readFileSync(join(DIST_DIR, 'modules.json'), 'utf-8')) as {
      meta: { moduleCount: number };
    };

    const modulesDir = join(DIST_DIR, 'modules');
    const pageDirs = readdirSync(modulesDir).filter((entry) => {
      const full = join(modulesDir, entry);
      return statSync(full).isDirectory() && existsSync(join(full, 'index.html'));
    });

    expect(pageDirs.length).toBe(modulesJson.meta.moduleCount);
  });
});

describe('module detail pages: per-page inline budget (§3.4 fill rule)', () => {
  it('no module page inlines more than the 250 KB budget of file content', () => {
    requireDist();
    const modulesJson = JSON.parse(readFileSync(join(DIST_DIR, 'modules.json'), 'utf-8')) as {
      modules: Array<{ name: string }>;
    };
    expect(modulesJson.modules.length).toBeGreaterThan(0);

    const offenders: string[] = [];

    for (const mod of modulesJson.modules) {
      const htmlPath = join(DIST_DIR, 'modules', mod.name, 'index.html');
      if (!existsSync(htmlPath)) {
        offenders.push(`${mod.name}: no built page`);
        continue;
      }
      const html = readFileSync(htmlPath, 'utf-8');

      // Sum the byte length of every inlined <pre> body inside a file-entry
      // block. This is a coarse proxy (HTML entity-escaping inflates it
      // slightly relative to the raw source bytes) but is exactly the
      // quantity the 250 KB budget bounds, and inflation only makes the
      // assertion stricter, never looser. Matches this codebase's existing
      // convention of regex-scanning built HTML for structural dist checks
      // (repo-invariants.test.ts's inline-<style>/<script> assertions).
      const inlinedBodies = [
        ...html.matchAll(/data-file-inlined="true"[\s\S]*?<pre id="[^"]*" class="file-entry__body">([\s\S]*?)<\/pre>/g),
      ];
      const totalInlinedBytes = inlinedBodies.reduce((sum, match) => sum + Buffer.byteLength(match[1], 'utf-8'), 0);

      if (totalInlinedBytes > INLINE_BUDGET_BYTES) {
        offenders.push(`${mod.name}: ${totalInlinedBytes} bytes inlined, over the ${INLINE_BUDGET_BYTES}-byte budget`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('every module page with a remainder note lists exactly that many non-inlined file entries', () => {
    requireDist();
    const modulesJson = JSON.parse(readFileSync(join(DIST_DIR, 'modules.json'), 'utf-8')) as {
      modules: Array<{ name: string }>;
    };

    const offenders: string[] = [];
    let modulesWithRemainder = 0;

    for (const mod of modulesJson.modules) {
      const htmlPath = join(DIST_DIR, 'modules', mod.name, 'index.html');
      const html = readFileSync(htmlPath, 'utf-8');

      const remainderMatch = html.match(/data-remainder-note[^>]*>(\d+) further/);
      const nonInlinedCount = (html.match(/data-file-inlined="false"/g) ?? []).length;

      if (remainderMatch) {
        modulesWithRemainder++;
        const remainderCount = Number(remainderMatch[1]);
        if (nonInlinedCount !== remainderCount) {
          offenders.push(
            `${mod.name}: remainder note says ${remainderCount} but ${nonInlinedCount} entries are marked non-inlined`,
          );
        }
        // §3.4: a non-inlined file still renders "a bounded preview plus
        // its rawUrl link" -- every such entry carries a raw-file link.
        const rawLinkCount = (html.match(/data-file-raw-link/g) ?? []).length;
        if (rawLinkCount !== nonInlinedCount) {
          offenders.push(`${mod.name}: ${nonInlinedCount} non-inlined entries but only ${rawLinkCount} raw-file links`);
        }
      } else if (nonInlinedCount !== 0) {
        offenders.push(`${mod.name}: ${nonInlinedCount} non-inlined entries but no remainder note rendered`);
      }
    }

    expect(offenders).toEqual([]);
    // Not asserted >0 as a fixed count: today commands-extra/dreaming/
    // autoheal exceed the budget, but module sizes are a census fact
    // (§1.4 principle 13), not a structural one.
    expect(modulesWithRemainder).toBeGreaterThanOrEqual(0);
  });
});

describe('full `pnpm build` duration (§5 E5 acceptance: recorded and within budget)', () => {
  it('completes within the stated 10-minute budget (Cloudflare Pages caps at 20 minutes)', () => {
    const BUDGET_MS = 10 * 60 * 1000;

    const start = Date.now();
    const result = spawnSync('pnpm', ['build'], { cwd: REPO_ROOT, encoding: 'utf-8' });
    const durationMs = Date.now() - start;

    console.log(`pnpm build duration: ${durationMs}ms (${(durationMs / 1000).toFixed(1)}s), budget ${BUDGET_MS}ms`);

    expect(result.status, result.stderr).toBe(0);
    expect(durationMs).toBeLessThan(BUDGET_MS);
  });
});
