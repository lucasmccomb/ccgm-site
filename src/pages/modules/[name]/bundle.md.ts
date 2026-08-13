/**
 * Per-module "copy entire module as markdown" bundle body (§5 E5). A
 * same-origin fetch target for the detail page's CopyButton (sourceUrl
 * mode, see CopyButton.astro) -- deliberately NOT embedded in the page's
 * own HTML. The bundle can carry up to ~250 KB of inlined file content
 * (the same page-level inline budget the detail page itself applies), and
 * embedding it a second time as a hidden DOM node just to make one button
 * work would double a large module's page weight for no reason.
 */
import type { APIRoute, GetStaticPaths } from 'astro';
import { loadModulesIndex } from '../../../lib/generated.ts';
import { buildModuleBundle } from '../../../lib/module-bundle.ts';
import { SITE_URL } from '../../../lib/site.ts';

export const prerender = true;

// Defensive only: the 250 KB inline-content budget plus bounded manifest
// overhead should make this unreachable today. A future outlier (e.g. a
// much larger README, which is not itself budget-constrained) throws
// loudly here rather than silently shipping an unbounded artifact.
const BUNDLE_CAP_BYTES = 512 * 1024;

export const getStaticPaths: GetStaticPaths = () => {
  const { modules } = loadModulesIndex();
  return modules.map((mod) => ({ params: { name: mod.name } }));
};

export const GET: APIRoute = ({ params }) => {
  const { meta, modules } = loadModulesIndex();
  const mod = modules.find((m) => m.name === params.name);
  if (!mod) return new Response('Not found', { status: 404 });

  const bundle = buildModuleBundle(mod, SITE_URL, meta.sourceSha);
  const size = Buffer.byteLength(bundle.text, 'utf-8');
  if (size > BUNDLE_CAP_BYTES) {
    throw new Error(
      `/modules/${mod.name}/bundle.md exceeds its ${BUNDLE_CAP_BYTES}-byte defensive cap (${size} bytes) -- ` +
        'the 250 KB inline budget should make this unreachable; investigate README size or manifest overhead.',
    );
  }

  return new Response(bundle.text, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
};
