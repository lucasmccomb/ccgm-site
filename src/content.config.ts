/**
 * Content collection glue for the generated module index.
 *
 * Schema matches scripts/ingest.ts's EmittedModule shape exactly -- this is
 * the E1 contract stub's output shape. E2 replaces ingest.ts's body (not
 * its interface) with the real clone-and-parse pipeline and extends this
 * schema for the fuller §3.3 ModuleRecord (contentFiles, readmeMd
 * rewriting, marketplacePlugin detection, etc.) as that data becomes real.
 */
import { defineCollection, z } from 'astro:content';
import { file } from 'astro/loaders';

const fileEntrySchema = z.object({
  path: z.string(),
  target: z.string(),
  type: z.string(),
  template: z.boolean(),
  merge: z.boolean(),
  bytes: z.number(),
  isText: z.boolean(),
  rawUrl: z.string(),
});

const configPromptSchema = z.object({
  key: z.string(),
  prompt: z.string(),
  default: z.string().optional(),
  options: z.array(z.string()).optional(),
});

const moduleSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string(),
  description: z.string(),
  summary: z.string(),
  category: z.enum(['core', 'workflow', 'commands', 'patterns', 'tech-specific']),
  scope: z.array(z.string()),
  dependencies: z.array(z.string()),
  tags: z.array(z.string()),
  status: z.string().optional(),
  postInstall: z.string().optional(),
  configPrompts: z.array(configPromptSchema),
  files: z.array(fileEntrySchema),
  inventory: z.record(z.string(), z.number()),
  contextCostTokens: z.number(),
  lastUpdated: z.string().nullable(),
  lastUpdatedSource: z.enum(['git', 'unavailable']),
  presets: z.array(z.string()),
  marketplacePlugin: z.boolean(),
  readmeMd: z.string(),
  sourceUrl: z.string(),
});

const modules = defineCollection({
  loader: file('src/generated/modules-index.json', {
    parser: (text) =>
      (JSON.parse(text) as { modules: Record<string, unknown>[] }).modules,
  }),
  schema: moduleSchema,
});

export const collections = { modules };
