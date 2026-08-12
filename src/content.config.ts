/**
 * Astro content collections over scripts/ingest.ts's output (§5 E2).
 *
 * Schemas are defined once in src/lib/schema.ts -- a plain module with no
 * `astro:content` import, so ingest.ts (which runs standalone under `tsx`,
 * outside Astro's Vite pipeline) can import and validate against the exact
 * same schema this file wires into Astro's content layer.
 */
import { file } from 'astro/loaders';
import { defineCollection } from 'astro:content';
import { moduleRecordSchema, presetRecordSchema } from './lib/schema.ts';

const modules = defineCollection({
  loader: file('src/generated/modules-index.json', {
    parser: (text) => (JSON.parse(text) as { modules: Record<string, unknown>[] }).modules,
  }),
  schema: moduleRecordSchema,
});

const presets = defineCollection({
  loader: file('src/generated/presets.json', {
    parser: (text) => (JSON.parse(text) as { presets: Record<string, unknown>[] }).presets,
  }),
  schema: presetRecordSchema,
});

export const collections = { modules, presets };
