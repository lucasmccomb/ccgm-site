import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DIAGRAMS,
  DIAGRAMS_HEADING,
  LABEL_FONT_SIZE,
  META_FONT_SIZE,
  NODE_PADDING_X,
  estimateTextWidth,
  resolveRef,
  resolveRefs,
  type DiagramSpec,
} from '../../src/lib/diagrams.ts';
import { defaultDocEntries } from '../../src/lib/llms.ts';
import { AGENT_NOTICE } from '../../src/lib/markdown.ts';
import { SITE_URL } from '../../src/lib/site.ts';

/**
 * Two kinds of assertion live here, both structural (§1.4 principle 13):
 *
 *  - Properties of the diagram DATA that no valid spec may violate --
 *    unique ids, geometry inside the canvas, no label wider than its own
 *    box, every ref a repo-relative path.
 *  - Properties of the BUILT page -- every SVG carries `role="img"` and a
 *    non-empty accessible name, the twin exists and carries the shared
 *    preamble, and the page stays inside the 250 KB page-level budget.
 *
 * Deliberately NOT asserted: that any particular ccgm file still exists.
 * That is a census fact (README "Structural invariants vs. census facts"),
 * and promoting it here would turn an ordinary ccgm rename into a red gate
 * on an unrelated PR. The link resolver is what makes that safe: a
 * repo-root path becomes a SHA-pinned GitHub blob, which cannot rot, and a
 * module path only becomes a site link when THIS build ingested that
 * module.
 */

const DIST_DIR = resolve(process.cwd(), 'dist');
/** Same page-level cap the module pages inline against (src/lib/inline-budget.ts). */
const PAGE_BUDGET_BYTES = 250 * 1024;

function requireDist(): void {
  if (!existsSync(DIST_DIR)) {
    throw new Error('dist/ does not exist -- run `pnpm build` before `pnpm test` (dist-reading tests never skip)');
  }
}

function readDiagramsHtml(): string {
  requireDist();
  const path = join(DIST_DIR, 'diagrams', 'index.html');
  if (!existsSync(path)) {
    throw new Error(`${path} does not exist -- the diagrams page did not build`);
  }
  return readFileSync(path, 'utf-8');
}

/** Every `<svg ...>` opening tag in the built page. */
function svgOpenTags(html: string): string[] {
  return [...html.matchAll(/<svg\b[^>]*>/gi)].map((match) => match[0]);
}

function attr(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return match ? match[1] : null;
}

const RESOLVE_OPTIONS = {
  sourceSha: 'a'.repeat(40),
  siteUrl: 'https://example.test',
  knownModules: new Set(['branch-guard', 'dreaming']),
};

describe('diagram specs (structural)', () => {
  it('ships the five named diagrams from issue #24, with unique ids', () => {
    const ids = DIAGRAMS.map((spec) => spec.id);
    expect(ids).toEqual(['install-flow', 'module-anatomy', 'hook-gate', 'worktree-flow', 'memory-loop']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(DIAGRAMS.map((spec) => [spec.id, spec] as [string, DiagramSpec]))(
    '%s carries a title, a description, a summary, steps, nodes, edges, and traceability refs',
    (_id, spec) => {
      expect(spec.heading.length).toBeGreaterThan(0);
      expect(spec.title.length).toBeGreaterThan(0);
      expect(spec.desc.length).toBeGreaterThan(0);
      expect(spec.summary.length).toBeGreaterThan(0);
      expect(spec.steps.length).toBeGreaterThanOrEqual(3);
      expect(spec.steps.every((step) => step.trim().length > 0)).toBe(true);
      expect(spec.nodes.length).toBeGreaterThan(0);
      expect(spec.edges.length).toBeGreaterThan(0);
      expect(spec.refs.length).toBeGreaterThanOrEqual(3);
      expect(spec.width).toBeGreaterThan(0);
      expect(spec.height).toBeGreaterThan(0);
    },
  );

  it.each(DIAGRAMS.map((spec) => [spec.id, spec] as [string, DiagramSpec]))(
    '%s keeps every node, edge point, and caption inside its own viewBox',
    (_id, spec) => {
      const escaped: string[] = [];

      for (const node of spec.nodes) {
        if (node.x < 0 || node.y < 0 || node.x + node.w > spec.width || node.y + node.h > spec.height) {
          escaped.push(`node at ${node.x},${node.y} (${node.w}x${node.h})`);
        }
      }

      for (const edge of spec.edges) {
        expect(edge.points.length, `${spec.id}: an edge needs at least two points`).toBeGreaterThanOrEqual(2);
        for (const [x, y] of edge.points) {
          if (x < 0 || y < 0 || x > spec.width || y > spec.height) escaped.push(`edge point ${x},${y}`);
        }
      }

      for (const caption of spec.captions ?? []) {
        const width = estimateTextWidth(caption.text, META_FONT_SIZE, true);
        const anchor = caption.anchor ?? 'start';
        const left = anchor === 'start' ? caption.x : anchor === 'middle' ? caption.x - width / 2 : caption.x - width;
        if (left < 0 || left + width > spec.width || caption.y < 0 || caption.y > spec.height) {
          escaped.push(`caption "${caption.text}"`);
        }
      }

      expect(escaped, `${spec.id}: geometry outside the ${spec.width}x${spec.height} canvas`).toEqual([]);
    },
  );

  it.each(DIAGRAMS.map((spec) => [spec.id, spec] as [string, DiagramSpec]))(
    '%s never renders a label or a path wider than the box holding it',
    (_id, spec) => {
      const overflowing: string[] = [];

      for (const node of spec.nodes) {
        const available = node.w - NODE_PADDING_X;
        if (node.label && estimateTextWidth(node.label, LABEL_FONT_SIZE, false) > available) {
          overflowing.push(`label "${node.label}" in a ${node.w}-unit box`);
        }
        for (const sub of node.sub ?? []) {
          if (estimateTextWidth(sub, META_FONT_SIZE, true) > available) {
            overflowing.push(`sub "${sub}" in a ${node.w}-unit box`);
          }
        }
      }

      expect(overflowing, `${spec.id}: text overflows its own node`).toEqual([]);
    },
  );

  it('every traceability ref names a repo-relative path, never a URL or an escaping path', () => {
    const offenders: string[] = [];
    for (const spec of DIAGRAMS) {
      for (const ref of spec.refs) {
        if (ref.path.startsWith('/') || ref.path.includes('..') || /^[a-z][a-z0-9+.-]*:/i.test(ref.path)) {
          offenders.push(`${spec.id}: ${ref.path}`);
        }
        if (ref.role.trim().length === 0) offenders.push(`${spec.id}: ${ref.path} has no role`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('resolveRef', () => {
  it('links a path inside an ingested module to that module page on this site', () => {
    const resolved = resolveRef(
      { path: 'modules/branch-guard/hooks/branch-guard.py', role: 'x' },
      RESOLVE_OPTIONS,
    );
    expect(resolved.module).toBe('branch-guard');
    expect(resolved.href).toBe('/modules/branch-guard');
    expect(resolved.absoluteHref).toBe('https://example.test/modules/branch-guard.md');
  });

  it('links a repo-root path to a SHA-pinned GitHub blob', () => {
    const resolved = resolveRef({ path: 'lib/merge.sh', role: 'x' }, RESOLVE_OPTIONS);
    expect(resolved.module).toBeNull();
    expect(resolved.href).toBe(
      `https://github.com/lucasmccomb/ccgm/blob/${RESOLVE_OPTIONS.sourceSha}/lib/merge.sh`,
    );
    expect(resolved.absoluteHref).toBe(resolved.href);
  });

  it('falls back to the pinned blob when the named module is not in this build', () => {
    const resolved = resolveRef({ path: 'modules/renamed-away/rules/x.md', role: 'x' }, RESOLVE_OPTIONS);
    expect(resolved.module).toBeNull();
    expect(resolved.href).toContain(`/blob/${RESOLVE_OPTIONS.sourceSha}/modules/renamed-away/rules/x.md`);
  });

  it('resolves every ref of every diagram to a site-rooted or absolute link', () => {
    for (const spec of DIAGRAMS) {
      for (const ref of resolveRefs(spec.refs, RESOLVE_OPTIONS)) {
        expect(ref.href.startsWith('/') || ref.href.startsWith('https://')).toBe(true);
        expect(ref.absoluteHref.startsWith('https://')).toBe(true);
      }
    }
  });
});

describe('llms.txt Docs entry', () => {
  it('names the diagrams twin, absolute against SITE_URL', () => {
    const entry = defaultDocEntries(SITE_URL).find((doc) => doc.url.endsWith('/diagrams.md'));
    expect(entry, 'no /diagrams.md entry in the llms.txt Docs section').toBeDefined();
    expect(entry?.url).toBe(`${SITE_URL}/diagrams.md`);
    expect((entry?.description ?? '').length).toBeGreaterThan(0);
  });
});

describe('built diagrams page (dist-reading, never skipped when dist/ is missing)', () => {
  it('renders one inline SVG per diagram, each with role="img"', () => {
    const html = readDiagramsHtml();
    const tags = svgOpenTags(html);
    expect(tags.length).toBe(DIAGRAMS.length);
    for (const tag of tags) {
      expect(attr(tag, 'role'), `svg without role="img": ${tag}`).toBe('img');
    }
  });

  it('gives every SVG a non-empty accessible name via aria-labelledby -> <title>', () => {
    const html = readDiagramsHtml();
    const offenders: string[] = [];

    for (const tag of svgOpenTags(html)) {
      const labelledBy = attr(tag, 'aria-labelledby');
      if (!labelledBy) {
        offenders.push(`no aria-labelledby: ${tag}`);
        continue;
      }
      const [nameId] = labelledBy.trim().split(/\s+/);
      const titleMatch = new RegExp(`<title[^>]*\\bid="${nameId}"[^>]*>([\\s\\S]*?)</title>`).exec(html);
      if (!titleMatch || titleMatch[1].trim().length === 0) {
        offenders.push(`aria-labelledby="${labelledBy}" resolves to no non-empty <title>`);
      }
      for (const id of labelledBy.trim().split(/\s+/)) {
        expect(html.split(`id="${id}"`).length - 1, `id "${id}" is not unique in the page`).toBe(1);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('carries an image-free fallback: every diagram heading, summary, and step list is real text', () => {
    const html = readDiagramsHtml();
    for (const spec of DIAGRAMS) {
      expect(html).toContain(`data-diagram="${spec.id}"`);
      expect(html, `${spec.id}: heading missing`).toContain(spec.heading);
      for (const step of spec.steps) {
        // Step prose is escaped on the way into HTML; compare on a
        // punctuation-free prefix so entity encoding cannot fail this.
        const probe = step.split(/[<>&"']/)[0].slice(0, 40);
        expect(html, `${spec.id}: step fallback missing "${probe}"`).toContain(probe);
      }
    }
  });

  it('stays inside the 250 KB page-level inline budget', () => {
    const html = readDiagramsHtml();
    const bytes = Buffer.byteLength(html, 'utf-8');
    expect(bytes, `/diagrams is ${bytes} bytes`).toBeLessThan(PAGE_BUDGET_BYTES);
  });

  it('emits no inline <style> and no inline <script> of its own', () => {
    const html = readDiagramsHtml();
    expect(/<style[\s>]/i.test(html)).toBe(false);
    // ThemeInit's `?theme=` override is the site's one inline script; the
    // diagrams page must not add a second distinct body.
    const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
      .map((match) => match[1])
      .filter((body) => body.trim().length > 0);
    expect(new Set(inlineScripts).size).toBeLessThanOrEqual(1);
  });

  it('serves a .md twin carrying the shared preamble, the schemaVersion, and every diagram', () => {
    requireDist();
    const path = join(DIST_DIR, 'diagrams.md');
    expect(existsSync(path), 'dist/diagrams.md does not exist').toBe(true);

    const twin = readFileSync(path, 'utf-8');
    expect(twin).toMatch(/^---\nschemaVersion: 1\n/);
    expect(twin).toContain(AGENT_NOTICE);
    expect(twin).toContain(`# ${DIAGRAMS_HEADING}`);

    for (const spec of DIAGRAMS) {
      expect(twin, `${spec.id}: heading missing from the twin`).toContain(`## ${spec.heading}`);
      expect(twin, `${spec.id}: title missing from the twin`).toContain(spec.title);
      expect(twin, `${spec.id}: desc missing from the twin`).toContain(spec.desc);
      for (const ref of spec.refs) {
        expect(twin, `${spec.id}: ${ref.path} missing from the twin`).toContain(`\`${ref.path}\``);
      }
    }
  });

  it('names the diagrams twin in the built /llms.txt Docs section', () => {
    requireDist();
    const llms = readFileSync(join(DIST_DIR, 'llms.txt'), 'utf-8');
    expect(llms).toContain(`${SITE_URL}/diagrams.md`);
  });
});
