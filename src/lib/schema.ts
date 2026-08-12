/**
 * The ModuleRecord/PresetRecord zod schemas (§3.3) and their inferred TS
 * types -- the single source of truth shared by:
 *  - scripts/ingest.ts (validates every constructed record; a record that
 *    fails validation is collected into meta.skippedModules, never fatal)
 *  - src/content.config.ts (wires these schemas into Astro content
 *    collections for page consumers)
 *  - the machine-surface page endpoints (validate before serving)
 *
 * Deliberately a plain module with no `astro:content` import: ingest.ts
 * runs standalone under `tsx`, outside Astro's Vite pipeline, where the
 * `astro:content` virtual module does not resolve.
 */
import { z } from 'zod';

/** The real module.json file-type vocabulary (§1.4 source-data facts) -- 12 values. */
export const KNOWN_FILE_TYPES = [
  'rule',
  'command',
  'hook',
  'skill',
  'agent',
  'lib',
  'script',
  'doc',
  'config',
  'settings',
  'content',
  'skill-reference',
] as const;

/** Known types plus the drift-catchall (§3.3: "the zod schema accepts unknown values as 'other'"). */
export const FILE_TYPE_BUCKETS = [...KNOWN_FILE_TYPES, 'other'] as const;

export const CATEGORY_VALUES = ['core', 'workflow', 'commands', 'patterns', 'tech-specific'] as const;

export const fileEntrySchema = z.object({
  path: z.string(),
  target: z.string(),
  type: z.string(),
  template: z.boolean(),
  merge: z.boolean(),
  bytes: z.number(),
  isText: z.boolean(),
  rawUrl: z.string(),
  /** True when this file's declared path resolves (e.g. via symlink) outside its own module dir but still inside the repo. */
  resolvedOutsideModule: z.boolean(),
});
export type FileEntry = z.infer<typeof fileEntrySchema>;

export const configPromptSchema = z.object({
  key: z.string(),
  prompt: z.string(),
  default: z.string().optional(),
  options: z.array(z.string()).optional(),
});
export type ConfigPrompt = z.infer<typeof configPromptSchema>;

export const contentFileSchema = z.object({
  path: z.string(),
  content: z.string(),
  type: z.string(),
  hasSubstitutionPlaceholders: z.boolean(),
  isMergeFragment: z.boolean(),
  rawUrl: z.string(),
  bytes: z.number(),
});
export type ContentFile = z.infer<typeof contentFileSchema>;

export const postInstallFileSchema = z.object({
  path: z.string(),
  content: z.string(),
  rawUrl: z.string(),
});
export type PostInstallFile = z.infer<typeof postInstallFileSchema>;

/**
 * inventory's keys are restricted to the 13-value FileType bucket set
 * (12 known + 'other'). Ingest is what collapses an unrecognized raw type
 * into 'other' when building this record -- the schema's job is simply to
 * refuse to validate anything that slipped through uncollapsed.
 */
export const inventorySchema = z.record(z.enum(FILE_TYPE_BUCKETS), z.number());

export const moduleRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string(),
  description: z.string(),
  summary: z.string(),
  category: z.enum(CATEGORY_VALUES),
  scope: z.array(z.string()),
  dependencies: z.array(z.string()),
  tags: z.array(z.string()),
  status: z.string().optional(),
  postInstall: z.string().optional(),
  configPrompts: z.array(configPromptSchema),
  files: z.array(fileEntrySchema),
  inventory: inventorySchema,
  contextCostTokens: z.number(),
  lastUpdated: z.string().nullable(),
  lastUpdatedSource: z.enum(['git', 'unavailable']),
  presets: z.array(z.string()),
  marketplacePlugin: z.boolean(),
  readmeMd: z.string(),
  postInstallFile: postInstallFileSchema.optional(),
  contentFiles: z.array(contentFileSchema),
  sourceUrl: z.string(),
});
export type ModuleRecord = z.infer<typeof moduleRecordSchema>;

export const presetRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  modules: z.array(z.string()),
});
export type PresetRecord = z.infer<typeof presetRecordSchema>;

export const skippedEntrySchema = z.object({ name: z.string(), reason: z.string() });
export const skippedFileSchema = z.object({ module: z.string(), path: z.string(), reason: z.string() });
export const sanitizedFileSchema = z.object({
  module: z.string(),
  path: z.string(),
  codepoints: z.array(z.string()),
});

export const indexMetaSchema = z.object({
  schemaVersion: z.literal(1),
  sourceSha: z.string(),
  sourceRef: z.literal('main'),
  siteSha: z.string(),
  siteBuiltAt: z.string(),
  generatedAt: z.string(),
  moduleCount: z.number(),
  categories: z.record(z.string(), z.number()),
  skippedModules: z.array(skippedEntrySchema),
  skippedFiles: z.array(skippedFileSchema),
  sanitizedFiles: z.array(sanitizedFileSchema),
  notice: z.string(),
});
export type IndexMeta = z.infer<typeof indexMetaSchema>;

export const modulesIndexSchema = z.object({
  meta: indexMetaSchema,
  modules: z.array(moduleRecordSchema),
});
export type ModulesIndex = z.infer<typeof modulesIndexSchema>;

export const presetsMetaSchema = z.object({
  schemaVersion: z.literal(1),
  sourceSha: z.string(),
  generatedAt: z.string(),
  notice: z.string(),
});
export type PresetsMeta = z.infer<typeof presetsMetaSchema>;

export const presetsFileSchema = z.object({
  meta: presetsMetaSchema,
  presets: z.array(presetRecordSchema),
});
export type PresetsFile = z.infer<typeof presetsFileSchema>;
