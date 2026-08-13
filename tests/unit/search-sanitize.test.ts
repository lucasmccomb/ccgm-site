import { describe, expect, it } from 'vitest';
import { sanitizeExcerptHtml } from '../../src/lib/search-sanitize.ts';

describe('sanitizeExcerptHtml', () => {
  it('passes plain text through unchanged', () => {
    expect(sanitizeExcerptHtml('branch-guard hard-blocks edits on main')).toBe(
      'branch-guard hard-blocks edits on main',
    );
  });

  it('restores bare, attribute-free <mark> highlight tags', () => {
    expect(sanitizeExcerptHtml('the <mark>workflow-reminder</mark> stays advisory')).toBe(
      'the <mark>workflow-reminder</mark> stays advisory',
    );
  });

  it('neutralizes a script tag instead of letting it survive', () => {
    const input = 'ignore me <script>alert(1)</script> please';
    const output = sanitizeExcerptHtml(input);
    expect(output).not.toContain('<script>');
    expect(output).toContain('&lt;script&gt;');
  });

  it('neutralizes an attribute-bearing tag, including an event handler -- no unescaped "<" survives to open a real element', () => {
    const input = '<img src=x onerror=alert(1)>';
    const output = sanitizeExcerptHtml(input);
    // The whole tag is escaped to inert text: no unescaped "<" or ">" remains,
    // so the browser can never parse this as an element -- the onerror text
    // is still present, but as dead prose, not a live attribute.
    expect(output).not.toContain('<img');
    expect(output).not.toMatch(/<[a-zA-Z]/);
    expect(output).toBe('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('does not let an attribute smuggled onto <mark> survive as a live attribute', () => {
    const input = '<mark onclick="alert(1)">workflow-reminder</mark>';
    const output = sanitizeExcerptHtml(input);
    // The exact bare-mark shape is not present, so the whole tag stays escaped.
    expect(output).not.toContain('<mark onclick');
    expect(output).toContain('&lt;mark onclick');
  });

  it('is idempotent-safe against literal HTML-tag-like text from real module docs (branch-guard README\'s <workflow-reminder>)', () => {
    const input = 'stays as the advisory <workflow-reminder>';
    const output = sanitizeExcerptHtml(input);
    expect(output).toBe('stays as the advisory &lt;workflow-reminder&gt;');
    expect(output).not.toContain('<workflow-reminder>');
  });

  it('escapes a bare ampersand and quotes', () => {
    expect(sanitizeExcerptHtml('rules & permissions "quoted"')).toBe(
      'rules &amp; permissions &quot;quoted&quot;',
    );
  });

  it('handles mixed safe and unsafe content in the same excerpt', () => {
    const input = 'the <mark>verification</mark> module <script>alert(1)</script> covers rules';
    const output = sanitizeExcerptHtml(input);
    expect(output).toContain('<mark>verification</mark>');
    expect(output).not.toContain('<script>');
  });
});
