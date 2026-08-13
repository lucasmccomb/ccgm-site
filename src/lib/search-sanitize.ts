/**
 * Renders a Pagefind result excerpt as safe HTML (§5 E6: "verify Pagefind's
 * result-snippet rendering does not reintroduce unsanitized innerHTML of
 * module content"). Pagefind's excerpt generator only ever indexes plain
 * text (its own indexer strips markup before storing content) and wraps
 * matched terms in a bare `<mark>...</mark>`, so its excerpts are already
 * expected to be safe to inject via innerHTML -- this function does not
 * trust that alone. It is defense-in-depth, independent of Pagefind's own
 * escaping (systematic-debugging's "defense in depth" pattern): every
 * character is HTML-escaped first, and only the exact, attribute-free
 * `<mark>`/`</mark>` sequence is ever restored afterward. A malformed tag,
 * an attribute injected onto `<mark>`, or any other tag -- even if it
 * somehow reached this function unescaped -- renders as inert text, never
 * as a live element.
 */
const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);
}

export function sanitizeExcerptHtml(excerpt: string): string {
  const escaped = escapeHtml(excerpt);
  // Restore only the bare, attribute-free mark tags Pagefind emits for
  // highlighting -- matched case-insensitively (Pagefind lowercases its own
  // output, but this stays robust to a future casing change) and only this
  // exact shape; `&lt;mark class="x"&gt;` or `&lt;marker&gt;` stay escaped.
  return escaped.replace(/&lt;(\/?)mark&gt;/gi, '<$1mark>');
}
