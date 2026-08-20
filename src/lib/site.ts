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

export const THEMES = ['mono', 'ascii', 'minimal', 'serif'] as const;
export type Theme = (typeof THEMES)[number];

/**
 * The shipped theme (#21). Rendered statically into `<html data-theme>` by
 * Base.astro, so the default look survives with JavaScript disabled; the
 * other entries in THEMES stay available as `?theme=` review options.
 *
 * Typed as `Theme` rather than a literal so build-time branches on the
 * value (the landing hero's wordmark-vs-ASCII-banner choice) type-check
 * against every theme name, not just the one shipping today.
 */
export const DEFAULT_THEME: Theme = 'mono';

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
 * How much of a file body a bounded preview shows when the page's inline
 * budget left it out (§3.4's fill rule, src/lib/inline-budget.ts decides
 * which files those are).
 */
export const PREVIEW_CHARS = 800;

/**
 * The bounded preview itself. One definition shared by every surface that
 * renders a non-inlined file body -- the module detail page's per-file
 * sections (src/components/ModuleFileSection.astro) and the rule detail
 * page (src/pages/rules/[module]/[slug].astro) -- so the two previews
 * cannot drift into different truncations of the same bytes.
 */
export function previewOf(content: string, maxChars = PREVIEW_CHARS): string {
  return content.length <= maxChars ? content : `${content.slice(0, maxChars)}…`;
}

/**
 * A GitHub blob URL for one file inside a module, derived from that
 * module's own `sourceUrl` (a `/tree/` link at the pinned SHA) rather than
 * from a second hardcoded copy of the repo URL. Shared by every surface
 * that links a single file on GitHub: the module detail page's postInstall
 * callout and the rule detail page's source link.
 */
export function blobUrlFor(moduleSourceUrl: string, filePath: string): string {
  return `${moduleSourceUrl.replace('/tree/', '/blob/')}/${filePath}`;
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
