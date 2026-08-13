/**
 * Per-module .md twin (§3.4). Under the per-module cap, inlines every
 * text file's full body grouped by type (merge fragments excepted -- see
 * module-twin.ts); over the cap, falls back to metadata + per-file links.
 * All of the actual decision logic lives in src/lib/module-twin.ts's
 * buildModuleTwin(), reused unchanged by the module detail page's
 * "copy entire module" button.
 */
import type { APIRoute, GetStaticPaths } from 'astro';
import { loadModulesIndex } from '../../lib/generated.ts';
import { buildModuleTwin } from '../../lib/module-twin.ts';
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

  const { text } = buildModuleTwin(mod, { siteUrl: SITE_URL, sourceSha: meta.sourceSha, frontMatter });

  return new Response(text, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
};
