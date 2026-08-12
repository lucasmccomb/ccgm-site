#!/usr/bin/env tsx
/**
 * The ONLY producer of dist/_headers. Runs AFTER `astro build` (see the
 * `build` script in package.json) because the CSP's inline-script hash is
 * computed from BUILT output, not source (§5 E1). There is deliberately no
 * public/_headers -- Astro copies public/ over dist/ after emptying outDir,
 * so a committed literal there would silently overwrite this generated file.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_URL } from '../src/lib/site.ts';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const distDir = join(scriptDir, '..', 'dist');

function walkHtmlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walkHtmlFiles(full));
    } else if (entry.endsWith('.html')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Scan every built HTML page for inline <script> elements (no src attribute)
 * and return the sha256/base64 CSP token of the one distinct script body
 * found. Returns null when zero inline scripts exist -- true today, because
 * ThemeInit.astro is still an E1 placeholder that E3 fills in.
 */
export function findInlineScriptHash(rootDir: string): string | null {
  const htmlFiles = walkHtmlFiles(rootDir);
  const bodies = new Set<string>();

  const scriptTagPattern = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;

  for (const file of htmlFiles) {
    const html = readFileSync(file, 'utf-8');
    let match: RegExpExecArray | null;
    while ((match = scriptTagPattern.exec(html)) !== null) {
      const body = match[1].trim();
      if (body.length > 0) {
        bodies.add(body);
      }
    }
  }

  if (bodies.size === 0) return null;
  if (bodies.size > 1) {
    throw new Error(
      `gen-headers: expected at most one distinct inline <script> body, found ${bodies.size}`,
    );
  }

  const [body] = bodies;
  const hash = createHash('sha256').update(body, 'utf-8').digest('base64');
  return `sha256-${hash}`;
}

export function buildHeadersFile(rootDir: string, siteUrl: string): string {
  const inlineScriptHash = findInlineScriptHash(rootDir);
  const scriptSrcTokens = [
    "'self'",
    "'wasm-unsafe-eval'",
    'https://static.cloudflareinsights.com',
    ...(inlineScriptHash ? [`'${inlineScriptHash}'`] : []),
  ];

  const csp = [
    "default-src 'self'",
    `script-src ${scriptSrcTokens.join(' ')}`,
    "connect-src 'self' https://cloudflareinsights.com",
    "style-src 'self'",
    "img-src 'self'",
    "font-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');

  const lines = [
    '/*',
    `  Content-Security-Policy: ${csp}`,
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
    `  X-Llms-Txt: ${siteUrl}/llms.txt`,
    `  Link: <${siteUrl}/llms.txt>; rel="llms-txt"`,
    '/llms.txt',
    '  Content-Type: text/plain; charset=utf-8',
    '/llms-full.txt',
    '  Content-Type: text/plain; charset=utf-8',
    '/*.md',
    '  Content-Type: text/markdown; charset=utf-8',
    '  X-Robots-Tag: noindex, nofollow',
    '',
  ];

  return lines.join('\n');
}

function main(): void {
  if (!existsSync(distDir)) {
    throw new Error('gen-headers: dist/ does not exist -- run `astro build` first');
  }

  const headersPath = join(distDir, '_headers');
  writeFileSync(headersPath, buildHeadersFile(distDir, SITE_URL));
  console.log(`gen-headers: wrote ${headersPath}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
