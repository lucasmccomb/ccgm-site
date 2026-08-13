/**
 * Site-wide constants and small deterministic helpers.
 *
 * SITE_URL is the single source of every absolute URL this site emits
 * (llms.txt links, twin preambles, rawUrl, sourceUrl, discovery headers).
 * astro.config.mjs derives `site` from this same value.
 */

/** Resolution order: explicit SITE_URL, then Cloudflare Pages' own URL, then localhost. */
export const SITE_URL: string =
  process.env.SITE_URL ?? process.env.CF_PAGES_URL ?? 'http://localhost:4321';

/** The default shipped theme until HE3's pick lands (§3.5). */
export const DEFAULT_THEME = 'ascii' as const;

export const THEMES = ['ascii', 'minimal', 'serif'] as const;
export type Theme = (typeof THEMES)[number];

/**
 * Routes reserved for the future ccgm-desktop-app plan (§3.4). Never claim
 * these from ccgm-site. A unit test asserts nothing in dist/ matches them.
 */
export const RESERVED_ROUTES: readonly string[] = [
  '/download',
  '/api/latest',
  '/appcast.xml',
  '/latest.json',
  '/install.sh',
];

/**
 * Coarse token estimate (chars / 4). Deterministic, no tokenizer dependency,
 * suitable for a rough "context cost" display -- not billing-accurate.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Reduce a description to an llms.txt-safe summary line.
 *
 * Rules (all unit-tested over the 78 real ccgm descriptions in E2):
 *  - collapse whitespace
 *  - prefer the first sentence
 *  - hard cap at 120 chars total, cutting on a word boundary with a
 *    trailing ellipsis when truncated
 *  - never split a markdown link ([text](url)) or a backtick code span
 */
export function summarize(description: string, maxLength = 120): string {
  const collapsed = description.trim().replace(/\s+/g, ' ');

  if (collapsed.length <= maxLength) {
    return collapsed;
  }

  const ellipsis = '…';
  const budget = maxLength - ellipsis.length;

  // Never cut inside a markdown link [text](url) or a `code` span: find the
  // last "safe" boundary at or before the budget that is not inside either.
  let cut = findSafeCut(collapsed, budget);

  // Prefer cutting at a word boundary within the safe cut.
  const lastSpace = collapsed.lastIndexOf(' ', cut);
  if (lastSpace > 0) {
    cut = lastSpace;
  }

  return collapsed.slice(0, cut).trimEnd() + ellipsis;
}

/**
 * Walk the string tracking whether we're inside a markdown link span
 * `[...](...)` or a backtick code span `` `...` ``. Returns the largest
 * index <= budget that is not inside either span.
 */
function findSafeCut(text: string, budget: number): number {
  let inBacktick = false;
  let linkDepth = 0; // 0 = outside, 1 = inside [text], 2 = inside (url)
  let lastSafe = 0;

  for (let i = 0; i < text.length && i <= budget; i++) {
    const ch = text[i];

    if (ch === '`') {
      inBacktick = !inBacktick;
    } else if (!inBacktick) {
      if (ch === '[') {
        linkDepth = 1;
      } else if (ch === ']' && linkDepth === 1) {
        // Only a real markdown link continues into the URL span; a `[` that
        // never reaches `](` (e.g. a "[DEPRECATED]" tag) is plain text --
        // close the span here instead of stalling the tracker at depth 1.
        linkDepth = text[i + 1] === '(' ? 2 : 0;
      } else if (ch === ')' && linkDepth === 2) {
        linkDepth = 0;
      }
    }

    if (!inBacktick && linkDepth === 0) {
      lastSafe = i + 1;
    }
  }

  return Math.min(lastSafe, budget);
}
