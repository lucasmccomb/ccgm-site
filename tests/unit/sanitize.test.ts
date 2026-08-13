import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildIndex } from '../../scripts/ingest.ts';
import { renderMarkdownToHtml } from '../../src/lib/markdown.ts';
import { sanitizeText } from '../../src/lib/sanitize.ts';

describe('sanitizeText', () => {
  it('leaves clean ASCII text untouched', () => {
    const result = sanitizeText('Hello, world.');
    expect(result.text).toBe('Hello, world.');
    expect(result.codepoints).toEqual([]);
  });

  it('strips a zero-width space (U+200B)', () => {
    const result = sanitizeText('hidden​space');
    expect(result.text).toBe('hiddenspace');
    expect(result.codepoints).toEqual(['U+200B']);
  });

  it('strips a zero-width joiner/non-joiner and BOM', () => {
    const result = sanitizeText('a‌b‍c﻿d');
    expect(result.text).toBe('abcd');
    expect(result.codepoints.sort()).toEqual(['U+200C', 'U+200D', 'U+FEFF']);
  });

  it('strips bidi embedding/override controls (U+202A-U+202E)', () => {
    const result = sanitizeText('text‮reversed');
    expect(result.text).toBe('textreversed');
    expect(result.codepoints).toEqual(['U+202E']);
  });

  it('strips bidi isolate controls (U+2066-U+2069)', () => {
    const result = sanitizeText('text⁦isolated⁩end');
    expect(result.text).toBe('textisolatedend');
    expect(result.codepoints.sort()).toEqual(['U+2066', 'U+2069']);
  });

  it('records distinct codepoints once each, sorted, even with repeats', () => {
    const result = sanitizeText('​​‮​');
    expect(result.codepoints).toEqual(['U+200B', 'U+202E']);
  });

  it('returns the identical string reference-equal-in-content when nothing was stripped', () => {
    const input = 'no hazards here';
    const result = sanitizeText(input);
    expect(result.text).toBe(input);
  });
});

describe('renderMarkdownToHtml (sanitizing renderer, html:false)', () => {
  it('escapes a raw <script> tag as inert text, never as a live element', () => {
    const html = renderMarkdownToHtml("<script>alert('xss')</script>");
    expect(html).not.toMatch(/<script[\s>]/i);
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes an onerror handler as inert text, never as a live attribute', () => {
    const html = renderMarkdownToHtml('<img src="x" onerror="alert(1)">');
    expect(html).not.toMatch(/<img[^>]*\bonerror=/i);
    expect(html).toContain('&lt;img');
  });

  it('refuses to turn a javascript: URL into a live link', () => {
    const html = renderMarkdownToHtml("[click me](javascript:alert('xss'))");
    expect(html).not.toMatch(/<a[^>]*href=["']javascript:/i);
  });

  it('renders an ordinary markdown link as a real <a> element', () => {
    const html = renderMarkdownToHtml('[CCGM](https://github.com/lucasmccomb/ccgm)');
    expect(html).toContain('<a href="https://github.com/lucasmccomb/ccgm">CCGM</a>');
  });
});

describe('sanitization end-to-end over the ccgm-mini XSS/bidi fixture', () => {
  const FIXTURE_DIR = resolve(process.cwd(), 'tests', 'fixtures', 'ccgm-mini');

  it('strips hidden Unicode from the ingested README AND renders its XSS payloads inert', () => {
    const { index } = buildIndex({
      repoDir: FIXTURE_DIR,
      sourceSha: 'fixturesha',
      hasOwnGit: false,
      siteSha: 'sitesha',
      generatedAt: '2026-01-01T00:00:00.000Z',
    });
    const mod = index.modules.find((m) => m.name === 'sample-hazards');
    if (!mod) throw new Error('sample-hazards fixture module not found');

    // Ingest-time: hidden Unicode is gone from the stored record.
    expect(mod.readmeMd).not.toContain('​');
    expect(mod.readmeMd).not.toContain('‮');

    // Render-time: the stored (still markdown-syntax) XSS payloads render inert.
    const html = renderMarkdownToHtml(mod.readmeMd);
    expect(html).not.toMatch(/<script[\s>]/i);
    expect(html).not.toMatch(/<img[^>]*\bonerror=/i);
    expect(html).not.toMatch(/<a[^>]*href=["']javascript:/i);
  });
});
