/**
 * Maps an HTML page's pathname to its Markdown twin URL (§5 E6: "view as
 * Markdown" link on every page). Pure and deterministic -- Base.astro is
 * the one caller, deriving the current page's path from `Astro.url.pathname`
 * rather than threading a prop through every page.
 *
 * Every twin this site serves is produced by an E2/E4 `.md.ts` endpoint at
 * the exact paths enumerated below (src/pages/{index,install,agents}.md.ts,
 * src/pages/modules/index.md.ts, src/pages/modules/[name].md.ts) -- this
 * function only encodes the mapping, it does not generate or validate the
 * twin itself. A path with no known twin (404, or anything unrecognized)
 * returns null so the caller omits the link rather than pointing at a 404.
 */
export function mdTwinUrlFor(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, '') || '/';

  if (path === '/') return '/index.md';
  if (path === '/install') return '/install.md';
  if (path === '/agents') return '/agents.md';
  if (path === '/modules') return '/modules/index.md';

  const moduleMatch = /^\/modules\/([^/]+)$/.exec(path);
  if (moduleMatch) return `/modules/${moduleMatch[1]}.md`;

  return null;
}
