import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RESERVED_ROUTES } from '../../src/lib/site.ts';

/**
 * Structural invariants (§1.4 principle 13): properties of the pipeline,
 * true for any input, hard-asserted and never loosened. Every assertion
 * here that reads dist/ MUST fail loudly when dist/ is absent -- never
 * skip (§8.1). Run `pnpm build && pnpm test`.
 */

const DIST_DIR = resolve(process.cwd(), 'dist');
const REPO_ROOT = resolve(process.cwd());

function requireDist(): void {
  if (!existsSync(DIST_DIR)) {
    throw new Error(
      'dist/ does not exist -- run `pnpm build` before `pnpm test` (repo-invariants must never skip)',
    );
  }
}

function walk(dir: string, predicate: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walk(full, predicate));
    } else if (predicate(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('repo invariants (structural, hard-asserted, never loosened)', () => {
  it('dist/**/*.html contains zero inline <style> elements', () => {
    requireDist();
    const htmlFiles = walk(DIST_DIR, (name) => name.endsWith('.html'));
    expect(htmlFiles.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of htmlFiles) {
      const html = readFileSync(file, 'utf-8');
      if (/<style[\s>]/i.test(html)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('dist/**/*.html has exactly one distinct inline <script> (ThemeInit), and its hash is in dist/_headers', () => {
    requireDist();
    const htmlFiles = walk(DIST_DIR, (name) => name.endsWith('.html'));
    const scriptTagPattern = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
    const bodies = new Set<string>();

    for (const file of htmlFiles) {
      const html = readFileSync(file, 'utf-8');
      let match: RegExpExecArray | null;
      while ((match = scriptTagPattern.exec(html)) !== null) {
        const rawBody = match[1];
        if (rawBody.trim().length > 0) bodies.add(rawBody);
      }
    }

    // E3: ThemeInit.astro now ships the site's one inline script (the
    // `?theme=` review-override). Exactly one distinct body is expected,
    // never zero and never more than one -- a second inline script
    // appearing anywhere is exactly the drift this invariant exists to
    // catch (§5 E3 acceptance: "CSP hash drift guard still green").
    expect(bodies.size).toBe(1);

    const headersContent = readFileSync(join(DIST_DIR, '_headers'), 'utf-8');
    expect(headersContent).toContain('sha256-');
  });

  it('no package.json script and no .github/workflows/* file contains "pages deploy"', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8')) as {
      scripts?: Record<string, string>;
    };
    for (const command of Object.values(pkg.scripts ?? {})) {
      expect(command.toLowerCase()).not.toContain('pages deploy');
    }

    const workflowsDir = join(REPO_ROOT, '.github', 'workflows');
    if (existsSync(workflowsDir)) {
      for (const file of readdirSync(workflowsDir)) {
        const content = readFileSync(join(workflowsDir, file), 'utf-8').toLowerCase();
        expect(content).not.toContain('pages deploy');
      }
    }
  });

  it('nothing in dist/ matches a RESERVED_ROUTE', () => {
    requireDist();
    for (const route of RESERVED_ROUTES) {
      const withoutLeadingSlash = route.replace(/^\//, '');
      const candidates = [
        join(DIST_DIR, withoutLeadingSlash),
        join(DIST_DIR, `${withoutLeadingSlash}.html`),
        join(DIST_DIR, withoutLeadingSlash, 'index.html'),
      ];
      for (const candidate of candidates) {
        expect(existsSync(candidate)).toBe(false);
      }
    }
  });

  it('every url() referenced in built CSS resolves to a file in dist/ (missing-webfont oracle)', () => {
    requireDist();
    const cssFiles = walk(DIST_DIR, (name) => name.endsWith('.css'));
    expect(cssFiles.length).toBeGreaterThan(0);

    const urlPattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
    const unresolved: string[] = [];

    for (const cssFile of cssFiles) {
      const css = readFileSync(cssFile, 'utf-8');
      let match: RegExpExecArray | null;
      while ((match = urlPattern.exec(css)) !== null) {
        const raw = match[2];
        if (raw.startsWith('data:')) continue;
        if (/^https?:\/\//i.test(raw)) continue;

        const withoutQuery = raw.split(/[?#]/)[0];
        const resolved = withoutQuery.startsWith('/')
          ? join(DIST_DIR, withoutQuery)
          : join(dirname(cssFile), withoutQuery);

        if (!existsSync(resolved)) {
          unresolved.push(`${cssFile}: url(${raw}) -> ${resolved}`);
        }
      }
    }

    expect(unresolved).toEqual([]);
  });
});
