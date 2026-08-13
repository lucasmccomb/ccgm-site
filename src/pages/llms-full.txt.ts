import type { APIRoute } from 'astro';
import { loadModulesIndex } from '../lib/generated.ts';
import { buildLlmsFullTxt } from '../lib/llms.ts';
import { SITE_URL } from '../lib/site.ts';

export const prerender = true;

export const GET: APIRoute = () => {
  const { modules } = loadModulesIndex();
  const body = buildLlmsFullTxt({ siteUrl: SITE_URL, modules });
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
