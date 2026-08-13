/**
 * {meta: {schemaVersion, sourceSha, generatedAt}, presets: [{name,
 * description, modules[]}]} -- an envelope, not a bare array (adrev3-004):
 * a bare array cannot carry schemaVersion.
 */
import type { APIRoute } from 'astro';
import { loadPresets } from '../lib/generated.ts';

export const prerender = true;

export const GET: APIRoute = () => {
  const presetsFile = loadPresets();
  return new Response(JSON.stringify(presetsFile), { headers: { 'Content-Type': 'application/json' } });
};
