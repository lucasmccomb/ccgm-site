import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LLMS_FULL_TXT_CAP_BYTES, LLMS_TXT_CAP_BYTES } from '../../src/lib/llms.ts';
import { PER_MODULE_TWIN_CAP_BYTES } from '../../src/lib/module-twin.ts';

/**
 * Size budgets (§3.4, §1.4 principle 11), asserted against the real build
 * output. Every artifact with a stated cap gets a test here. Dist-reading
 * -- MUST fail loudly when dist/ is absent, never skip (§8.1).
 */

const DIST_DIR = resolve(process.cwd(), 'dist');
const MODULES_JSON_CAP_BYTES = 1024 * 1024;
const PER_MODULE_JSON_CAP_BYTES = 512 * 1024;

function requireDist(): void {
  if (!existsSync(DIST_DIR)) {
    throw new Error('dist/ does not exist -- run `pnpm build` before `pnpm test` (budgets must never skip)');
  }
}

describe('size budgets against dist/ (never loosened, never skipped when dist/ is missing)', () => {
  it('/llms.txt stays under its 50 KB cap', () => {
    requireDist();
    const path = join(DIST_DIR, 'llms.txt');
    expect(existsSync(path)).toBe(true);
    const size = statSync(path).size;
    expect(size).toBeLessThan(LLMS_TXT_CAP_BYTES);
  });

  it('/llms-full.txt stays under its 1 MB cap', () => {
    requireDist();
    const path = join(DIST_DIR, 'llms-full.txt');
    expect(existsSync(path)).toBe(true);
    const size = statSync(path).size;
    expect(size).toBeLessThan(LLMS_FULL_TXT_CAP_BYTES);
  });

  it('/modules.json stays under its 1 MB cap', () => {
    requireDist();
    const path = join(DIST_DIR, 'modules.json');
    expect(existsSync(path)).toBe(true);
    const size = statSync(path).size;
    expect(size).toBeLessThan(MODULES_JSON_CAP_BYTES);
  });

  it('every /modules/{name}.json is under its 512 KB cap, or explicitly contentTruncated', () => {
    requireDist();
    const modulesDir = join(DIST_DIR, 'modules');
    expect(existsSync(modulesDir)).toBe(true);

    const jsonFiles = readdirSync(modulesDir).filter((f) => f.endsWith('.json'));
    expect(jsonFiles.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    let truncatedCount = 0;

    for (const file of jsonFiles) {
      const fullPath = join(modulesDir, file);
      const size = statSync(fullPath).size;
      if (size > PER_MODULE_JSON_CAP_BYTES) {
        const record = JSON.parse(readFileSync(fullPath, 'utf-8')) as { contentTruncated?: boolean };
        if (record.contentTruncated) {
          truncatedCount++;
        } else {
          offenders.push(`${file}: ${size} bytes, over cap, and NOT marked contentTruncated`);
        }
      }
    }

    expect(offenders).toEqual([]);
    // Not asserted >0: today only commands-extra/dreaming exceed the cap; a
    // future census delta could bring that to zero without this being a bug.
    expect(truncatedCount).toBeGreaterThanOrEqual(0);
  });

  it('/presets.json is a reasonably small envelope (sanity bound, well under any real cap)', () => {
    requireDist();
    const path = join(DIST_DIR, 'presets.json');
    expect(existsSync(path)).toBe(true);
    const size = statSync(path).size;
    expect(size).toBeLessThan(MODULES_JSON_CAP_BYTES);
  });

  it('every emitted /modules/{name}.md twin is under its 512 KB cap, or its Files section is links-only', () => {
    requireDist();
    const modulesDir = join(DIST_DIR, 'modules');
    expect(existsSync(modulesDir)).toBe(true);

    const mdFiles = readdirSync(modulesDir).filter((f) => f.endsWith('.md'));
    expect(mdFiles.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    let overCapCount = 0;

    for (const file of mdFiles) {
      const fullPath = join(modulesDir, file);
      const size = statSync(fullPath).size;
      if (size <= PER_MODULE_TWIN_CAP_BYTES) continue;

      overCapCount++;
      const text = readFileSync(fullPath, 'utf-8');
      // Isolate the "## Files" section (always the last top-level
      // section, in both twin shapes) so a fenced code example inside
      // the module's OWN rendered README can't produce a false positive
      // -- the under-cap/over-cap split only governs how FILES are
      // rendered, not README content.
      const filesSectionStart = text.indexOf('\n## Files\n');
      expect(filesSectionStart, `${file}: no "## Files" section found`).toBeGreaterThan(-1);
      const filesSection = text.slice(filesSectionStart);

      if (filesSection.includes('```')) {
        offenders.push(`${file}: ${size} bytes, over the ${PER_MODULE_TWIN_CAP_BYTES}-byte cap, but its Files section contains a fenced code block (not links-only)`);
      }
    }

    expect(offenders).toEqual([]);
    // Not asserted >0: today only commands-extra/dreaming exceed the cap; a
    // future census delta could bring that to zero without this being a bug.
    expect(overCapCount).toBeGreaterThanOrEqual(0);
  });
});
