/**
 * Full single-module record. schemaVersion is a top-level field here
 * (§3.3's compatibility-contract carrier list: "each /modules/{name}.json
 * (top level)") -- ModuleRecord itself does not carry it; this endpoint
 * adds it when assembling the wire response.
 *
 * Records whose serialized size exceeds 512 KB (§3.4 -- today
 * commands-extra at 958 KB source content) omit contentFiles[].content and
 * keep rawUrl + bytes, with contentTruncated: true, so the artifact stays
 * fetchable and an agent follows the per-file rawUrls instead.
 */
import type { APIRoute, GetStaticPaths } from 'astro';
import { loadModulesIndex } from '../../lib/generated.ts';

export const prerender = true;

const PER_MODULE_JSON_CAP_BYTES = 512 * 1024;

export const getStaticPaths: GetStaticPaths = () => {
  const { modules } = loadModulesIndex();
  return modules.map((mod) => ({ params: { name: mod.name } }));
};

export const GET: APIRoute = ({ params }) => {
  const { meta, modules } = loadModulesIndex();
  const mod = modules.find((m) => m.name === params.name);
  if (!mod) return new Response('Not found', { status: 404 });

  const full = { schemaVersion: meta.schemaVersion, ...mod };
  const fullBody = JSON.stringify(full);

  if (Buffer.byteLength(fullBody, 'utf-8') <= PER_MODULE_JSON_CAP_BYTES) {
    return new Response(fullBody, { headers: { 'Content-Type': 'application/json' } });
  }

  const truncatedContentFiles = mod.contentFiles.map(({ content: _content, ...rest }) => rest);
  const truncated = {
    schemaVersion: meta.schemaVersion,
    ...mod,
    contentFiles: truncatedContentFiles,
    contentTruncated: true,
  };
  const truncatedBody = JSON.stringify(truncated);

  if (Buffer.byteLength(truncatedBody, 'utf-8') > PER_MODULE_JSON_CAP_BYTES) {
    throw new Error(
      `/modules/${mod.name}.json still exceeds its ${PER_MODULE_JSON_CAP_BYTES}-byte cap after dropping ` +
        'contentFiles[].content -- the manifest/metadata alone is oversized.',
    );
  }

  return new Response(truncatedBody, { headers: { 'Content-Type': 'application/json' } });
};
