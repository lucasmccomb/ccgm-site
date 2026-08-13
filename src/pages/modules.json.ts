/**
 * Machine index: {meta, modules[]} -- all records minus bulky
 * contentFiles/readmeMd. files[] survives WITH its rawUrls (adrev3-003),
 * which is what makes "index -> file" two requests. schemaVersion lives
 * inside meta (§3.3's compatibility-contract carrier list), not as a
 * separate top-level field. Cap 1 MB (§3.4).
 */
import type { APIRoute } from 'astro';
import { loadModulesIndex } from '../lib/generated.ts';

export const prerender = true;

const MODULES_JSON_CAP_BYTES = 1024 * 1024;

export const GET: APIRoute = () => {
  const { meta, modules } = loadModulesIndex();
  const trimmed = modules.map(({ contentFiles: _contentFiles, readmeMd: _readmeMd, ...rest }) => rest);

  const body = JSON.stringify({ meta, modules: trimmed });
  const size = Buffer.byteLength(body, 'utf-8');
  if (size >= MODULES_JSON_CAP_BYTES) {
    throw new Error(`/modules.json exceeds its ${MODULES_JSON_CAP_BYTES}-byte cap (${size} bytes)`);
  }

  return new Response(body, { headers: { 'Content-Type': 'application/json' } });
};
