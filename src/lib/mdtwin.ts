/**
 * Maps an HTML page's pathname to its Markdown twin URL (§5 E6: "view as
 * Markdown" link on every page). Pure and deterministic -- Base.astro is
 * the one caller, deriving the current page's path from `Astro.url.pathname`
 * rather than threading a prop through every page.
 *
 * Every twin this site serves is produced by a `.md.ts` endpoint at the
 * exact paths enumerated below
 * (src/pages/{index,install,agents,examples,diagrams}.md.ts,
 * src/pages/modules/index.md.ts, src/pages/modules/[name].md.ts,
 * src/pages/rules/index.md.ts, src/pages/rules/[module]/[slug].md.ts) --
 * this function only encodes the mapping, it does not generate or validate
 * the twin itself. A path with no known twin (404, or anything
 * unrecognized) returns null so the caller omits the link rather than
 * pointing at a 404.
 */
export function mdTwinUrlFor(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, '') || '/';

  if (path === '/') return '/index.md';
  if (path === '/install') return '/install.md';
  if (path === '/agents') return '/agents.md';
  if (path === '/examples') return '/examples.md';
  if (path === '/diagrams') return '/diagrams.md';
  if (path === '/modules') return '/modules/index.md';
  if (path === '/rules') return '/rules/index.md';

  const moduleMatch = /^\/modules\/([^/]+)$/.exec(path);
  if (moduleMatch) return `/modules/${moduleMatch[1]}.md`;

  // Rule pages are module-scoped, so their twin path is two segments deep
  // (see ruleSlug() in src/lib/rules.ts for why the module scope exists).
  const ruleMatch = /^\/rules\/([^/]+)\/([^/]+)$/.exec(path);
  if (ruleMatch) return `/rules/${ruleMatch[1]}/${ruleMatch[2]}.md`;

  return null;
}
