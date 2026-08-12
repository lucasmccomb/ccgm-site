#!/usr/bin/env tsx
/**
 * Content ingestion pipeline -- E1 CONTRACT STUB.
 *
 * This does not clone or touch the network. It reads a fixture directory
 * (tests/fixtures/ccgm-mini by default, or --repo-dir <path>) shaped like
 * the real lucasmccomb/ccgm repo and emits schema-valid src/generated/
 * output, so `pnpm build` has something to build from starting in wave 1.
 *
 * E2 replaces this file's BODY with the real clone-and-parse pipeline
 * (git clone --filter=blob:none, per-module.json parsing, sanitization,
 * relative-link rewriting, etc.) but keeps this exact CLI interface:
 * `--repo-dir <path>` and `--force`.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { estimateTokens, summarize } from '../src/lib/site.ts';

interface CliOptions {
  repoDir: string;
  force: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const scriptDir = fileURLToPath(new URL('.', import.meta.url));
  const defaultRepoDir = resolve(scriptDir, '..', 'tests', 'fixtures', 'ccgm-mini');

  let repoDir = defaultRepoDir;
  let force = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--repo-dir') {
      const next = argv[i + 1];
      if (!next) {
        throw new Error('--repo-dir requires a path argument');
      }
      repoDir = resolve(next);
      i++;
    } else if (arg === '--force') {
      force = true;
    }
  }

  return { repoDir, force };
}

interface RawFileEntry {
  target: string;
  type: string;
  template: boolean;
  merge?: boolean;
}

interface RawModuleManifest {
  name: string;
  displayName: string;
  description: string;
  category: string;
  scope: string[];
  dependencies: string[];
  files: Record<string, RawFileEntry>;
  tags: string[];
  configPrompts: Array<{ key: string; prompt: string; default?: string; options?: string[] }>;
  status?: string;
  postInstall?: string;
}

interface EmittedFile {
  path: string;
  target: string;
  type: string;
  template: boolean;
  merge: boolean;
  bytes: number;
  isText: boolean;
  rawUrl: string;
}

interface EmittedModule {
  id: string;
  name: string;
  displayName: string;
  description: string;
  summary: string;
  category: string;
  scope: string[];
  dependencies: string[];
  tags: string[];
  status?: string;
  postInstall?: string;
  configPrompts: Array<{ key: string; prompt: string; default?: string; options?: string[] }>;
  files: EmittedFile[];
  inventory: Record<string, number>;
  contextCostTokens: number;
  lastUpdated: string | null;
  lastUpdatedSource: 'git' | 'unavailable';
  presets: string[];
  marketplacePlugin: boolean;
  readmeMd: string;
  sourceUrl: string;
}

/** Content sniff: a file is text if it decodes cleanly and has no NUL byte. */
function isTextFile(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

function loadPresetMembership(repoDir: string): Map<string, string[]> {
  const presetsDir = join(repoDir, 'presets');
  const membership = new Map<string, string[]>();

  if (!existsSync(presetsDir)) return membership;

  const presetFiles = readdirSync(presetsDir).filter((f) => f.endsWith('.json'));
  for (const file of presetFiles) {
    const presetName = file.replace(/\.json$/, '');
    const raw = readFileSync(join(presetsDir, file), 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) continue; // non-array preset files are skipped (E2 hardens this)

    for (const moduleName of parsed) {
      if (typeof moduleName !== 'string') continue;
      const existing = membership.get(moduleName) ?? [];
      existing.push(presetName);
      membership.set(moduleName, existing);
    }
  }

  return membership;
}

function ingestModule(
  repoDir: string,
  moduleDirName: string,
  presetMembership: Map<string, string[]>,
): EmittedModule {
  const moduleDir = join(repoDir, 'modules', moduleDirName);
  const manifestPath = join(moduleDir, 'module.json');
  const manifest: RawModuleManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

  const inventory: Record<string, number> = {};
  const files: EmittedFile[] = [];
  let contextCostTokens = 0;

  for (const [path, entry] of Object.entries(manifest.files)) {
    const absPath = join(moduleDir, path);
    const buffer = existsSync(absPath) ? readFileSync(absPath) : Buffer.alloc(0);
    const isText = isTextFile(buffer);
    const merge = entry.merge ?? false;

    inventory[entry.type] = (inventory[entry.type] ?? 0) + 1;

    if (entry.type === 'rule' && isText) {
      contextCostTokens += estimateTokens(buffer.toString('utf-8'));
    }

    files.push({
      path,
      target: entry.target,
      type: entry.type,
      template: entry.template,
      merge,
      bytes: buffer.byteLength,
      isText,
      rawUrl: `/modules/${manifest.name}/files/${path}.txt`,
    });
  }

  const readmePath = join(moduleDir, 'README.md');
  const readmeMd = existsSync(readmePath) ? readFileSync(readmePath, 'utf-8') : '';

  return {
    id: manifest.name,
    name: manifest.name,
    displayName: manifest.displayName,
    description: manifest.description,
    summary: summarize(manifest.description),
    category: manifest.category,
    scope: manifest.scope,
    dependencies: manifest.dependencies,
    tags: manifest.tags,
    status: manifest.status,
    postInstall: manifest.postInstall,
    configPrompts: manifest.configPrompts,
    files,
    inventory,
    contextCostTokens,
    // The fixture tree is not its own git repo, so per-module git history is
    // never available here -- always 'unavailable' for stub-ingested data.
    // This also keeps fixture snapshots deterministic (§3.3).
    lastUpdated: null,
    lastUpdatedSource: 'unavailable',
    presets: presetMembership.get(manifest.name) ?? [],
    // Real marketplace-bijection detection is E2 scope (reads
    // .claude-plugin/marketplace.json from the real clone).
    marketplacePlugin: false,
    readmeMd,
    sourceUrl: `https://github.com/lucasmccomb/ccgm/tree/stub/modules/${manifest.name}`,
  };
}

function main(): void {
  const { repoDir, force } = parseArgs(process.argv.slice(2));

  if (!existsSync(repoDir)) {
    throw new Error(`ingest: --repo-dir does not exist: ${repoDir}`);
  }

  const scriptDir = fileURLToPath(new URL('.', import.meta.url));
  const outDir = resolve(scriptDir, '..', 'src', 'generated');
  const modulesOutDir = join(outDir, 'modules');
  mkdirSync(modulesOutDir, { recursive: true });

  const indexPath = join(outDir, 'modules-index.json');
  if (!force && existsSync(indexPath)) {
    const existing = JSON.parse(readFileSync(indexPath, 'utf-8'));
    if (existing?.meta?.repoDir === repoDir) {
      // Already ingested this exact source with nothing forcing a re-run.
      // The stub still re-runs cheaply (no network cost), but honoring
      // --force's absence here keeps parity with E2's idempotency contract.
    }
  }

  const modulesDir = join(repoDir, 'modules');
  const moduleDirNames = readdirSync(modulesDir).filter((name) =>
    statSync(join(modulesDir, name)).isDirectory(),
  );

  const presetMembership = loadPresetMembership(repoDir);

  const modules: EmittedModule[] = [];
  const skippedModules: Array<{ name: string; reason: string }> = [];

  for (const moduleDirName of moduleDirNames.sort()) {
    try {
      const record = ingestModule(repoDir, moduleDirName, presetMembership);
      modules.push(record);
      writeFileSync(join(modulesOutDir, `${record.name}.json`), JSON.stringify(record, null, 2));
    } catch (error) {
      skippedModules.push({
        name: moduleDirName,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const categories: Record<string, number> = {};
  for (const mod of modules) {
    categories[mod.category] = (categories[mod.category] ?? 0) + 1;
  }

  const generatedAt = new Date().toISOString();

  const index = {
    meta: {
      schemaVersion: 1,
      sourceSha: 'stub',
      sourceRef: 'main',
      generatedAt,
      moduleCount: modules.length,
      categories,
      skippedModules,
      repoDir,
    },
    modules,
  };

  writeFileSync(indexPath, JSON.stringify(index, null, 2));

  const presetsDir = join(repoDir, 'presets');
  const presets: Array<{ name: string; description: string | null; modules: string[] }> = [];
  if (existsSync(presetsDir)) {
    for (const file of readdirSync(presetsDir).filter((f) => f.endsWith('.json')).sort()) {
      const name = file.replace(/\.json$/, '');
      const raw = readFileSync(join(presetsDir, file), 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) continue;
      presets.push({ name, description: null, modules: parsed as string[] });
    }
  }

  writeFileSync(
    join(outDir, 'presets.json'),
    JSON.stringify({ meta: { schemaVersion: 1, sourceSha: 'stub', generatedAt }, presets }, null, 2),
  );

  console.log(
    `ingest: wrote ${modules.length} module(s), ${presets.length} preset(s) from ${repoDir}${force ? ' (forced)' : ''}`,
  );
}

main();
