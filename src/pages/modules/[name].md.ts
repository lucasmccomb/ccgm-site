/**
 * Per-module .md twin (§3.4). Over the per-module cap, inlines metadata +
 * per-file links instead of full bodies -- reusing the same 512 KB
 * threshold as the JSON record's contentTruncated rule (§3.4).
 *
 * Body rendering lives in src/lib/module-twin.ts (extracted in §5 E5) so
 * the module detail page's "copy entire module as markdown" button can
 * reuse the same machinery instead of re-deriving it.
 */
import type { APIRoute, GetStaticPaths } from 'astro';
import { loadModulesIndex } from '../../lib/generated.ts';
import { buildMarkdownTwin } from '../../lib/markdown.ts';
import { PER_MODULE_TWIN_CAP_BYTES, renderModuleTwinBody } from '../../lib/module-twin.ts';
import { SITE_URL } from '../../lib/site.ts';

export const prerender = true;

export const getStaticPaths: GetStaticPaths = () => {
  const { modules } = loadModulesIndex();
  return modules.map((mod) => ({ params: { name: mod.name } }));
};

export const GET: APIRoute = ({ params }) => {
  const { meta, modules } = loadModulesIndex();
  const mod = modules.find((m) => m.name === params.name);
  if (!mod) return new Response('Not found', { status: 404 });

  const frontMatter = {
    schemaVersion: meta.schemaVersion,
    module: mod.name,
    sourceSha: meta.sourceSha,
    generatedAt: meta.generatedAt,
  };

  let twin = buildMarkdownTwin(renderModuleTwinBody(mod, { inlineReadme: true }), {
    siteUrl: SITE_URL,
    sourceSha: meta.sourceSha,
    frontMatter,
  });

  if (Buffer.byteLength(twin, 'utf-8') > PER_MODULE_TWIN_CAP_BYTES) {
    twin = buildMarkdownTwin(renderModuleTwinBody(mod, { inlineReadme: false }), {
      siteUrl: SITE_URL,
      sourceSha: meta.sourceSha,
      frontMatter,
    });
  }

  return new Response(twin, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
};
