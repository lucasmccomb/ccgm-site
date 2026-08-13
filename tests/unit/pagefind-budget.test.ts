import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Pagefind index size budget (§5 E6 acceptance: "Pagefind index size within
 * a stated budget (file bodies excluded)"). Measured against the real
 * build: 1.06 MB against the real ccgm corpus (83 pages, 78 modules) with
 * `data-pagefind-ignore` scoping module file-content sections out of the
 * index -- indexing those bodies would pull in a ~4.6 MB corpus of Python,
 * shell, YAML, and JSON instead. 2 MB leaves headroom for ccgm's ongoing
 * module growth (~6 modules/month) without the budget needing to move on
 * every content PR.
 */
const DIST_DIR = join(process.cwd(), 'dist');
const PAGEFIND_DIR = join(DIST_DIR, 'pagefind');
const BUDGET_BYTES = 2 * 1024 * 1024;

function totalBytes(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    total += stat.isDirectory() ? totalBytes(full) : stat.size;
  }
  return total;
}

describe('Pagefind index size budget (real build)', () => {
  it('dist/pagefind exists and stays within the 2 MB budget', () => {
    if (!existsSync(PAGEFIND_DIR)) {
      throw new Error(
        'dist/pagefind does not exist -- run `pnpm build` before `pnpm test` (pagefind-budget must never skip)',
      );
    }

    const actualBytes = totalBytes(PAGEFIND_DIR);
    expect(actualBytes, `dist/pagefind is ${actualBytes} bytes (${(actualBytes / 1024 / 1024).toFixed(2)} MB)`).toBeLessThanOrEqual(
      BUDGET_BYTES,
    );
  });

  it('the ignored module file-content sections are excluded from what Pagefind indexed (module HTML pages are far larger than the index itself)', () => {
    const modulesDir = join(DIST_DIR, 'modules');
    if (!existsSync(modulesDir)) {
      throw new Error('dist/modules does not exist -- run `pnpm build` before `pnpm test`');
    }

    const htmlFiles = readdirSync(modulesDir).filter((name) => {
      const full = join(modulesDir, name);
      return statSync(full).isDirectory() && existsSync(join(full, 'index.html'));
    });
    expect(htmlFiles.length).toBeGreaterThan(0);

    let totalHtmlBytes = 0;
    for (const name of htmlFiles) {
      totalHtmlBytes += statSync(join(modulesDir, name, 'index.html')).size;
    }

    // If the ignored file-content sections had been indexed, the index
    // would scale with the built HTML (which inlines full file bodies up
    // to the 250 KB per-page budget, §5 E5) rather than staying an order
    // of magnitude smaller than it.
    const pagefindBytes = totalBytes(PAGEFIND_DIR);
    expect(pagefindBytes).toBeLessThan(totalHtmlBytes);
  });
});
