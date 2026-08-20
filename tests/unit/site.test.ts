import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PREVIEW_CHARS,
  RESERVED_ROUTES,
  blobUrlFor,
  estimateTokens,
  previewOf,
  summarize,
} from '../../src/lib/site.ts';

describe('previewOf', () => {
  it('returns content shorter than the budget unchanged, with no ellipsis', () => {
    expect(previewOf('short body')).toBe('short body');
    expect(previewOf('x'.repeat(PREVIEW_CHARS))).toBe('x'.repeat(PREVIEW_CHARS));
  });

  it('truncates at the budget and marks the cut', () => {
    const result = previewOf('x'.repeat(PREVIEW_CHARS + 50));
    expect(result).toBe(`${'x'.repeat(PREVIEW_CHARS)}…`);
  });
});

describe('blobUrlFor', () => {
  it('turns a module tree URL into a blob URL for one file, keeping the pinned SHA', () => {
    expect(blobUrlFor('https://github.com/lucasmccomb/ccgm/tree/abc123/modules/verification', 'rules/verification.md')).toBe(
      'https://github.com/lucasmccomb/ccgm/blob/abc123/modules/verification/rules/verification.md',
    );
  });

  it('rewrites only the /tree/ path segment, not a later occurrence of the word', () => {
    expect(blobUrlFor('https://github.com/o/r/tree/sha/modules/tree-sitter', 'rules/tree.md')).toBe(
      'https://github.com/o/r/blob/sha/modules/tree-sitter/rules/tree.md',
    );
  });
});

describe('estimateTokens', () => {
  it('approximates chars / 4, rounded up', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });
});

describe('summarize', () => {
  it('returns short descriptions unchanged', () => {
    expect(summarize('Short description.')).toBe('Short description.');
  });

  it('collapses whitespace', () => {
    expect(summarize('  multiple   spaces \n here  ')).toBe('multiple spaces here');
  });

  it('caps at 120 chars and cuts on a word boundary, never mid-word', () => {
    const long = 'word '.repeat(40).trim(); // well over 120 chars
    const result = summarize(long);

    expect(result.length).toBeLessThanOrEqual(120);
    expect(result.endsWith('…')).toBe(true);

    const withoutEllipsis = result.slice(0, -1);
    expect(long.startsWith(withoutEllipsis)).toBe(true);
    // the character immediately after the cut in the source must be a
    // word boundary (space), never mid-word
    expect(long[withoutEllipsis.length]).toBe(' ');
  });

  it('never splits a markdown link when the cut would otherwise land inside it', () => {
    const prefix = 'a'.repeat(100);
    const link = '[a fairly long link label](https://example.com/some/path)';
    const description = `${prefix} ${link} trailing text that will not fit`;

    const result = summarize(description, 120);

    // The natural word-boundary cut falls inside the link span; the
    // safe-cut logic must back off before the '[' entirely rather than
    // emit a dangling, unterminated link.
    expect(result).not.toContain('[');
    expect(result.startsWith(prefix.slice(0, result.length - 1))).toBe(true);
  });

  it('does not stall on a `[` that never becomes a real markdown link', () => {
    // Regression: a leading "[TAG]" with no "](" following it used to pin
    // the safe-cut tracker at linkDepth 1 forever, degenerating the whole
    // summary to a bare ellipsis (real case: agent-manager's description).
    const description =
      '[DEPRECATED] Go-based terminal UI for managing Claude Code agent processes via tmux panes. ' +
      'Unmaintained and no longer offered for new installs; a GUI-based replacement is being pursued instead. ' +
      'Kept in-repo for existing users.';

    const result = summarize(description);

    expect(result.length).toBeLessThanOrEqual(120);
    expect(result).not.toBe('…');
    expect(result.startsWith('[DEPRECATED] Go-based terminal UI')).toBe(true);
    expect(result.endsWith('…')).toBe(true);
  });

  it('never splits a backtick code span', () => {
    const prefix = 'x'.repeat(105);
    const description = `${prefix} \`a-long-code-span-token\` more text after it`;

    const result = summarize(description, 120);
    const backtickCount = (result.match(/`/g) ?? []).length;
    expect(backtickCount % 2).toBe(0);
  });

  it('stays within budget across a range of description shapes', () => {
    const samples = ['A'.repeat(200), 'word '.repeat(50), 'Short.', ''];
    for (const sample of samples) {
      expect(summarize(sample).length).toBeLessThanOrEqual(120);
    }
  });
});

describe('RESERVED_ROUTES', () => {
  it('contains exactly the desktop-app reserved paths (§3.4)', () => {
    expect(RESERVED_ROUTES).toEqual([
      '/download',
      '/api/latest',
      '/appcast.xml',
      '/latest.json',
      '/install.sh',
    ]);
  });
});

describe('SITE_URL resolution order', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('falls back to localhost:4321 when nothing is set', async () => {
    delete process.env.SITE_URL;
    delete process.env.CF_PAGES_URL;
    const { SITE_URL } = await import('../../src/lib/site.ts');
    expect(SITE_URL).toBe('http://localhost:4321');
  });

  it('prefers CF_PAGES_URL over the localhost fallback', async () => {
    delete process.env.SITE_URL;
    process.env.CF_PAGES_URL = 'https://ccgm-site.pages.dev';
    const { SITE_URL } = await import('../../src/lib/site.ts');
    expect(SITE_URL).toBe('https://ccgm-site.pages.dev');
  });

  it('prefers SITE_URL over CF_PAGES_URL', async () => {
    process.env.SITE_URL = 'https://ccgm.dev';
    process.env.CF_PAGES_URL = 'https://ccgm-site.pages.dev';
    const { SITE_URL } = await import('../../src/lib/site.ts');
    expect(SITE_URL).toBe('https://ccgm.dev');
  });
});
