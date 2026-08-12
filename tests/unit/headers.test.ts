import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildHeadersFile, findInlineScriptHash } from '../../scripts/gen-headers.ts';

const DIST_DIR = join(process.cwd(), 'dist');

describe('dist/_headers (built output)', () => {
  it('exists and contains the expected directives after `pnpm build`', () => {
    if (!existsSync(DIST_DIR)) {
      throw new Error(
        'dist/ does not exist -- run `pnpm build` before `pnpm test` (dist-reading tests never skip)',
      );
    }

    const headersPath = join(DIST_DIR, '_headers');
    if (!existsSync(headersPath)) {
      throw new Error('dist/_headers does not exist -- scripts/gen-headers.ts did not run');
    }

    const content = readFileSync(headersPath, 'utf-8');

    expect(content).toContain('/*');
    expect(content).toContain("Content-Security-Policy: default-src 'self';");
    expect(content).toContain("'wasm-unsafe-eval'");
    expect(content).toContain('X-Content-Type-Options: nosniff');
    expect(content).toContain('Referrer-Policy: strict-origin-when-cross-origin');
    expect(content).toContain('Permissions-Policy: camera=(), microphone=(), geolocation=()');
    expect(content).toContain('X-Llms-Txt:');
    expect(content).toContain('rel="llms-txt"');
    expect(content).toContain('/llms.txt');
    expect(content).toContain('/llms-full.txt');
    expect(content).toContain('/*.md');
    expect(content).toContain('X-Robots-Tag: noindex, nofollow');
  });

  it('has no committed public/_headers -- gen-headers.ts is the sole producer', () => {
    const publicHeadersPath = join(process.cwd(), 'public', '_headers');
    expect(existsSync(publicHeadersPath)).toBe(false);
  });
});

describe('findInlineScriptHash', () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns null when there are zero inline scripts (E1 -- ThemeInit is a placeholder)', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ccgm-site-headers-'));
    writeFileSync(join(tempDir, 'index.html'), '<html><body>no scripts here</body></html>');
    expect(findInlineScriptHash(tempDir)).toBeNull();
  });

  it('ignores scripts with a src attribute (external scripts are not inline)', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ccgm-site-headers-'));
    writeFileSync(join(tempDir, 'index.html'), '<script src="/foo.js"></script>');
    expect(findInlineScriptHash(tempDir)).toBeNull();
  });

  it('hashes the one distinct inline script body found across pages', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ccgm-site-headers-'));
    const body = "console.log('theme-init')";
    writeFileSync(join(tempDir, 'index.html'), `<script>${body}</script>`);
    mkdirSync(join(tempDir, 'install'));
    writeFileSync(join(tempDir, 'install', 'index.html'), `<script>${body}</script>`);

    const hash = findInlineScriptHash(tempDir);
    expect(hash).toMatch(/^sha256-/);
  });

  it('throws when more than one distinct inline script body exists', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ccgm-site-headers-'));
    writeFileSync(join(tempDir, 'index.html'), '<script>console.log(1)</script>');
    writeFileSync(join(tempDir, 'other.html'), '<script>console.log(2)</script>');
    expect(() => findInlineScriptHash(tempDir)).toThrow();
  });
});

describe('buildHeadersFile', () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('omits the sha256 token gracefully when there are zero inline scripts', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ccgm-site-headers-'));
    writeFileSync(join(tempDir, 'index.html'), '<html><body>no scripts</body></html>');

    const content = buildHeadersFile(tempDir, 'https://ccgm.dev');
    expect(content).not.toContain('sha256-');
    expect(content).toContain(
      "script-src 'self' 'wasm-unsafe-eval' https://static.cloudflareinsights.com;",
    );
  });

  it('includes the sha256 token when exactly one inline script exists', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ccgm-site-headers-'));
    writeFileSync(join(tempDir, 'index.html'), "<script>console.log('x')</script>");

    const content = buildHeadersFile(tempDir, 'https://ccgm.dev');
    expect(content).toMatch(/'sha256-[A-Za-z0-9+/=]+'/);
  });

  it('derives discovery headers from the passed SITE_URL', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ccgm-site-headers-'));
    writeFileSync(join(tempDir, 'index.html'), '<html></html>');

    const content = buildHeadersFile(tempDir, 'https://example.test');
    expect(content).toContain('X-Llms-Txt: https://example.test/llms.txt');
    expect(content).toContain('Link: <https://example.test/llms.txt>; rel="llms-txt"');
  });
});
