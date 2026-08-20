import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AGENT_NOTICE } from '../../src/lib/markdown.ts';
import { RESERVED_ROUTES, SITE_URL } from '../../src/lib/site.ts';

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
    // body -> the built page(s) it was found on, so a failure names the
    // offending scripts instead of a bare count.
    const bodies = new Map<string, string[]>();

    for (const file of htmlFiles) {
      const html = readFileSync(file, 'utf-8');
      let match: RegExpExecArray | null;
      while ((match = scriptTagPattern.exec(html)) !== null) {
        const rawBody = match[1];
        if (rawBody.trim().length > 0) {
          const files = bodies.get(rawBody) ?? [];
          files.push(file);
          bodies.set(rawBody, files);
        }
      }
    }

    // E3: ThemeInit.astro now ships the site's one inline script (the
    // `?theme=` review-override). Exactly one distinct body is expected,
    // never zero and never more than one -- a second inline script
    // appearing anywhere is exactly the drift this invariant exists to
    // catch (§5 E3 acceptance: "CSP hash drift guard still green"). On
    // failure, name the offending script bodies (truncated) and the pages
    // they came from -- a bare "expected 1, received N" gives no lead on
    // which page introduced the drift.
    const summary = [...bodies.entries()]
      .map(([body, files]) => {
        const trimmed = body.trim();
        const preview = trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
        return `  ${JSON.stringify(preview)} (from: ${files.join(', ')})`;
      })
      .join('\n');

    expect(
      bodies.size,
      `expected exactly one distinct inline <script> body, found ${bodies.size}:\n${summary}`,
    ).toBe(1);

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

describe('E2 structural invariants (ingest pipeline, hard-asserted, never loosened)', () => {
  it('every path declared in a real module.json is emitted (a files[] entry) or explained in skippedFiles', () => {
    requireDist();
    const cloneDir = resolve(REPO_ROOT, '.ccgm-src');
    if (!existsSync(cloneDir)) {
      throw new Error('.ccgm-src/ does not exist -- run `pnpm build` (real ingest) before this test, never skip');
    }

    const index = JSON.parse(readFileSync(join(DIST_DIR, 'modules.json'), 'utf-8')) as {
      meta: { skippedFiles: Array<{ module: string; path: string }> };
      modules: Array<{ name: string; files: Array<{ path: string }> }>;
    };
    const skippedSet = new Set(index.meta.skippedFiles.map((s) => `${s.module}\u0000${s.path}`));

    const modulesDir = join(cloneDir, 'modules');
    const moduleDirNames = readdirSync(modulesDir).filter((name) => statSync(join(modulesDir, name)).isDirectory());
    expect(moduleDirNames.length).toBeGreaterThan(0);

    const missing: string[] = [];
    for (const moduleDirName of moduleDirNames) {
      const manifestPath = join(modulesDir, moduleDirName, 'module.json');
      if (!existsSync(manifestPath)) continue;
      let manifest: { name: string; files?: Record<string, unknown> };
      try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      } catch {
        continue; // malformed module.json is covered by meta.skippedModules, not this per-file check
      }
      const record = index.modules.find((m) => m.name === manifest.name);
      const emittedPaths = new Set((record?.files ?? []).map((f) => f.path));

      for (const declaredPath of Object.keys(manifest.files ?? {})) {
        const emitted = emittedPaths.has(declaredPath);
        const explained = skippedSet.has(`${manifest.name}\u0000${declaredPath}`);
        if (!emitted && !explained) missing.push(`${manifest.name}: ${declaredPath}`);
      }
    }

    expect(missing).toEqual([]);
  });

  it('every emitted rawUrl (sourced from files[], the array /modules.json keeps) resolves to a file that exists in dist/', () => {
    requireDist();
    const modulesJsonDir = join(DIST_DIR, 'modules');
    const jsonFiles = readdirSync(modulesJsonDir).filter((f) => f.endsWith('.json'));
    expect(jsonFiles.length).toBeGreaterThan(0);

    const unresolved: string[] = [];
    let checkedCount = 0;

    for (const file of jsonFiles) {
      const record = JSON.parse(readFileSync(join(modulesJsonDir, file), 'utf-8')) as {
        files: Array<{ rawUrl: string }>;
      };
      for (const entry of record.files) {
        checkedCount++;
        if (!existsSync(join(DIST_DIR, entry.rawUrl))) unresolved.push(entry.rawUrl);
      }
    }

    expect(checkedCount).toBeGreaterThan(0);
    expect(unresolved).toEqual([]);
  });

  it("every emitted self-referential absolute URL's origin equals the build's SITE_URL (github.com links are a deliberate exception)", () => {
    requireDist();
    const siteUrlOrigin = new URL(SITE_URL).origin;
    const urlPattern = /https?:\/\/[^\s")>\]]+/g;

    // Metadata-only artifacts. The per-item twins (/modules/{name}.md,
    // /rules/{module}/{slug}.md) are deliberately NOT scanned here: they
    // inline file bodies, and a rule's own prose legitimately cites
    // third-party URLs (arxiv, llmstxt.org, vendor docs) that this
    // assertion would read as offenders.
    const filesToScan = [
      join(DIST_DIR, 'llms.txt'),
      join(DIST_DIR, 'llms-full.txt'),
      join(DIST_DIR, 'modules', 'index.md'),
      join(DIST_DIR, 'rules', 'index.md'),
    ].filter(existsSync);
    expect(filesToScan.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of filesToScan) {
      const content = readFileSync(file, 'utf-8');
      let match: RegExpExecArray | null;
      while ((match = urlPattern.exec(content)) !== null) {
        const url = match[0].replace(/[.,;:]+$/, '');
        const origin = new URL(url).origin;
        if (origin === 'https://github.com') continue; // rewritten relative refs / sourceUrl -- deliberately external
        if (origin !== siteUrlOrigin) offenders.push(`${file}: ${url}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('no relative link or image survives markdown rendering anywhere in dist/', () => {
    requireDist();
    // Every .md twin under dist/, not just the module ones: the /rules
    // twins (#22) inline the same ingested markdown bodies and are held to
    // the same rule.
    const mdFiles = walk(DIST_DIR, (name) => name.endsWith('.md'));
    expect(mdFiles.length).toBeGreaterThan(0);

    const linkPattern = /\]\(([^)]+)\)/g;
    const offenders: string[] = [];

    for (const file of mdFiles) {
      const rawContent = readFileSync(file, 'utf-8');
      // Under-cap module twins (§5 E5, decisions.md) inline full file
      // bodies inside fenced code blocks -- source code (a regex literal
      // like `[^/:]+`, a shell parameter expansion) can coincidentally
      // match `](...)`) without being a markdown link at all. Strip
      // well-formed fenced blocks (opening/closing fence of the SAME
      // backtick run length, matched via backreference so a shorter
      // backtick run inside the content can't prematurely "close" it)
      // before scanning -- this only removes fenced code, never prose,
      // so a real un-rewritten link outside a fence is still caught.
      const content = rawContent.replace(/^(`{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, '');
      let match: RegExpExecArray | null;
      while ((match = linkPattern.exec(content)) !== null) {
        const url = match[1];
        const isAbsoluteOrAnchor = /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('#');
        if (!isAbsoluteOrAnchor) offenders.push(`${file}: ${url}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('every machine artifact carries schemaVersion', () => {
    requireDist();
    const modulesJson = JSON.parse(readFileSync(join(DIST_DIR, 'modules.json'), 'utf-8')) as {
      meta: { schemaVersion: number };
    };
    expect(modulesJson.meta.schemaVersion).toBe(1);

    const presetsJson = JSON.parse(readFileSync(join(DIST_DIR, 'presets.json'), 'utf-8')) as {
      meta: { schemaVersion: number };
    };
    expect(presetsJson.meta.schemaVersion).toBe(1);

    const modulesDir = join(DIST_DIR, 'modules');
    const perModuleJson = readdirSync(modulesDir).filter((f) => f.endsWith('.json'));
    expect(perModuleJson.length).toBeGreaterThan(0);
    for (const file of perModuleJson) {
      const record = JSON.parse(readFileSync(join(modulesDir, file), 'utf-8')) as { schemaVersion?: number };
      expect(record.schemaVersion).toBe(1);
    }

    // Every .md twin under dist/, not just the per-module ones -- the
    // /rules twins (#22) are machine artifacts on the same contract.
    const twins = walk(DIST_DIR, (name) => name.endsWith('.md'));
    expect(twins.length).toBeGreaterThan(0);
    for (const file of twins) {
      const content = readFileSync(file, 'utf-8');
      expect(content, `${file} carries no schemaVersion front matter`).toMatch(/^---\nschemaVersion: 1\n/);
    }
  });

  it('every .md twin and every text-based machine artifact carries the data-not-instructions notice', () => {
    requireDist();
    expect(readFileSync(join(DIST_DIR, 'llms.txt'), 'utf-8')).toContain(AGENT_NOTICE);
    expect(readFileSync(join(DIST_DIR, 'llms-full.txt'), 'utf-8')).toContain(AGENT_NOTICE);

    const modulesJson = JSON.parse(readFileSync(join(DIST_DIR, 'modules.json'), 'utf-8')) as {
      meta: { notice: string };
    };
    expect(modulesJson.meta.notice).toBe(AGENT_NOTICE);

    const presetsJson = JSON.parse(readFileSync(join(DIST_DIR, 'presets.json'), 'utf-8')) as {
      meta: { notice: string };
    };
    expect(presetsJson.meta.notice).toBe(AGENT_NOTICE);

    // Every .md twin under dist/, not a sample of one: the notice is the
    // contract, and a whole new twin family (#22's /rules twins) shipping
    // without it is exactly what this invariant exists to stop.
    const twins = walk(DIST_DIR, (name) => name.endsWith('.md'));
    expect(twins.length).toBeGreaterThan(0);
    for (const file of twins) {
      expect(readFileSync(file, 'utf-8'), `${file} carries no agent notice`).toContain(AGENT_NOTICE);
    }
  });

  it('every presets/*.json in the real cloned repo parses as a bare array of module-name strings', () => {
    const cloneDir = resolve(REPO_ROOT, '.ccgm-src');
    if (!existsSync(cloneDir)) {
      throw new Error('.ccgm-src/ does not exist -- run `pnpm build` (real ingest) before this test, never skip');
    }
    const presetsDir = join(cloneDir, 'presets');
    const presetFiles = readdirSync(presetsDir).filter((f) => f.endsWith('.json'));
    expect(presetFiles.length).toBeGreaterThan(0);

    for (const file of presetFiles) {
      const parsed: unknown = JSON.parse(readFileSync(join(presetsDir, file), 'utf-8'));
      expect(Array.isArray(parsed)).toBe(true);
      expect((parsed as unknown[]).every((entry) => typeof entry === 'string')).toBe(true);
    }
  });

  it('every real module.json summary is a genuine, non-degenerate prefix of its description (never a bare ellipsis)', () => {
    requireDist();
    const modulesJson = JSON.parse(readFileSync(join(DIST_DIR, 'modules.json'), 'utf-8')) as {
      modules: Array<{ name: string; description: string; summary: string }>;
    };
    expect(modulesJson.modules.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const mod of modulesJson.modules) {
      const collapsed = mod.description.trim().replace(/\s+/g, ' ');
      const { summary } = mod;

      if (summary.length > 120) {
        offenders.push(`${mod.name}: summary exceeds 120 chars (${summary.length}): "${summary}"`);
        continue;
      }

      if (collapsed.length <= 120) {
        // Short descriptions pass through unchanged -- the "full string" case.
        if (summary !== collapsed) {
          offenders.push(`${mod.name}: description fits within 120 chars but summary diverges from it`);
        }
        continue;
      }

      // Truncated case: must end in an ellipsis backed by a substantial,
      // word-bounded prefix -- never the bare/near-empty ellipsis that the
      // bracket-tracking bug (a stalled `[...]` span) used to produce.
      if (!summary.endsWith('…')) {
        offenders.push(`${mod.name}: truncated summary does not end with an ellipsis: "${summary}"`);
        continue;
      }
      const prefix = summary.slice(0, -1);
      if (prefix.trim().length <= 20) {
        offenders.push(`${mod.name}: summary degenerates to a near-empty prefix: "${summary}"`);
        continue;
      }
      if (!collapsed.startsWith(prefix)) {
        offenders.push(`${mod.name}: summary is not a real prefix of the description: "${summary}"`);
        continue;
      }
      const boundaryChar = collapsed[prefix.length];
      if (boundaryChar !== undefined && boundaryChar !== ' ') {
        offenders.push(`${mod.name}: summary cuts mid-word: "${summary}"`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("presets.json's presets[].modules match the real .ccgm-src presets/*.json arrays exactly (order + content)", () => {
    requireDist();
    const cloneDir = resolve(REPO_ROOT, '.ccgm-src');
    if (!existsSync(cloneDir)) {
      throw new Error('.ccgm-src/ does not exist -- run `pnpm build` (real ingest) before this test, never skip');
    }

    const presetsJson = JSON.parse(readFileSync(join(DIST_DIR, 'presets.json'), 'utf-8')) as {
      presets: Array<{ id: string; modules: string[] }>;
    };
    expect(presetsJson.presets.length).toBeGreaterThan(0);

    const presetsDir = join(cloneDir, 'presets');
    const presetFiles = readdirSync(presetsDir).filter((f) => f.endsWith('.json'));
    expect(presetFiles.length).toBeGreaterThan(0);
    expect(presetsJson.presets.length).toBe(presetFiles.length);

    for (const file of presetFiles) {
      const id = file.replace(/\.json$/, '');
      const rawModules = JSON.parse(readFileSync(join(presetsDir, file), 'utf-8')) as string[];
      const record = presetsJson.presets.find((p) => p.id === id);
      expect(record, `presets.json is missing a record for preset "${id}"`).toBeDefined();
      expect(record?.modules).toEqual(rawModules);
    }
  });
});
