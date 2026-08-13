/**
 * Reads and validates scripts/ingest.ts's output (src/generated/*.json).
 * Shared by content.config.ts (Astro content collections) and by every
 * page endpoint that needs the full ModuleRecord/PresetRecord data or the
 * index meta (schemaVersion, sourceSha, skippedModules, ...).
 *
 * src/generated/ is gitignored and only exists after `pnpm ingest` has run
 * -- callers that need it MUST run after ingest (every dist-reading test
 * and every build step already does, per §8.4's CI order).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { modulesIndexSchema, presetsFileSchema, type ModulesIndex, type PresetsFile } from './schema.ts';

// Resolved against process.cwd(), NOT import.meta.url: Astro/Vite bundles
// this module into dist/chunks/ during `astro build`, which makes an
// import.meta.url-relative path resolve against the bundle's OUTPUT
// location instead of this file's source location. process.cwd() is the
// same repo-root assumption every dist-reading test and script already
// makes (pnpm always runs scripts from the package root).
const REPO_ROOT = process.cwd();
const MODULES_INDEX_PATH = join(REPO_ROOT, 'src', 'generated', 'modules-index.json');
const PRESETS_PATH = join(REPO_ROOT, 'src', 'generated', 'presets.json');

let modulesIndexCache: ModulesIndex | null = null;
let presetsCache: PresetsFile | null = null;

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/** The full ingested module index, validated against the ModuleRecord schema. Memoized. */
export function loadModulesIndex(): ModulesIndex {
  if (!modulesIndexCache) {
    modulesIndexCache = modulesIndexSchema.parse(readJson(MODULES_INDEX_PATH));
  }
  return modulesIndexCache;
}

/** The full ingested preset index, validated against the PresetRecord schema. Memoized. */
export function loadPresets(): PresetsFile {
  if (!presetsCache) {
    presetsCache = presetsFileSchema.parse(readJson(PRESETS_PATH));
  }
  return presetsCache;
}
