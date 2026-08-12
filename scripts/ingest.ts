#!/usr/bin/env tsx
/**
 * Content ingestion pipeline (§5 E2). Same CLI interface as the E1 contract
 * stub this replaces: `--repo-dir <path>` and `--force`.
 *
 * Default mode: clone-or-refresh `lucasmccomb/ccgm` into `.ccgm-src/` (or
 * `$CCGM_SRC_DIR`), parse every module manifest under `modules/` plus each
 * one's text files, every preset file under `presets/`,
 * `docs/preset-descriptions.json`, and `.claude-plugin/marketplace.json`,
 * and emit `src/generated/`.
 *
 * `--repo-dir <path>` mode: skip the clone entirely and parse the given
 * directory as-is (fixtures, offline dev). Per §5 E2 this flag must never
 * be wired to a Pages build-time env var -- the real build always clones.
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { AGENT_NOTICE, rewriteRelativeReferences } from '../src/lib/markdown.ts';
import { sanitizeText } from '../src/lib/sanitize.ts';
import { estimateTokens, summarize } from '../src/lib/site.ts';
import {
  KNOWN_FILE_TYPES,
  modulesIndexSchema,
  moduleRecordSchema,
  presetsFileSchema,
  type ConfigPrompt,
  type ContentFile,
  type FileEntry,
  type IndexMeta,
  type ModuleRecord,
  type ModulesIndex,
  type PostInstallFile,
  type PresetRecord,
  type PresetsFile,
  type PresetsMeta,
} from '../src/lib/schema.ts';

const CCGM_REMOTE = 'https://github.com/lucasmccomb/ccgm.git';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliOptions {
  repoDir: string | null;
  force: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  let repoDir: string | null = null;
  let force = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--repo-dir') {
      const next = argv[i + 1];
      if (!next) throw new Error('--repo-dir requires a path argument');
      repoDir = resolve(next);
      i++;
    } else if (arg === '--force') {
      force = true;
    }
  }

  return { repoDir, force };
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function runGit(args: string[], cwd?: string): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  if (result.status !== 0) {
    const stderr = (result.stderr ?? '').trim();
    throw new Error(
      `git ${args.join(' ')} failed${cwd ? ` (cwd=${cwd})` : ''}: ${stderr || result.error?.message || 'unknown error'}`,
    );
  }
  return (result.stdout ?? '').trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/** Retries a network-bound git operation with exponential backoff, then fails loudly naming network access as the cause. */
async function withNetworkRetry<T>(fn: () => T, label: string, attempts = 3, baseDelayMs = 1000): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return fn();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `ingest: network access to ${CCGM_REMOTE} failed after ${attempts} attempts while ${label} -- ${message}`,
  );
}

/**
 * Clone contract (§5 E2, adrev2-006): idempotent and re-runnable. Existing
 * clone with matching origin -> fetch + detach onto FETCH_HEAD. Absent, or
 * any inconsistency (wrong/missing origin) -> remove and re-clone.
 */
async function ensureCcgmClone(cloneDir: string): Promise<void> {
  const looksLikeGitRepo = existsSync(join(cloneDir, '.git'));
  let originMatches = false;

  if (looksLikeGitRepo) {
    try {
      originMatches = runGit(['remote', 'get-url', 'origin'], cloneDir) === CCGM_REMOTE;
    } catch {
      originMatches = false;
    }
  }

  if (looksLikeGitRepo && originMatches) {
    // Fetch `main` explicitly. A bare `git fetch origin` pulls every branch
    // the remote has, and FETCH_HEAD then resolves to whichever one was
    // listed first -- not necessarily main -- so `checkout --detach
    // FETCH_HEAD` after a bare fetch can silently land on a stale feature
    // branch instead of the tip this pipeline is meant to track.
    await withNetworkRetry(
      () => runGit(['fetch', '--filter=blob:none', 'origin', 'main'], cloneDir),
      'fetching ccgm main',
    );
    runGit(['checkout', '--detach', 'FETCH_HEAD'], cloneDir);
    return;
  }

  if (existsSync(cloneDir)) rmSync(cloneDir, { recursive: true, force: true });
  mkdirSync(dirname(cloneDir), { recursive: true });
  await withNetworkRetry(() => runGit(['clone', '--filter=blob:none', CCGM_REMOTE, cloneDir]), 'cloning ccgm');
}

/** True iff `dir` is itself a git repository's toplevel -- false when it is merely nested inside one (e.g. a fixture dir inside ccgm-site's own repo). */
function isOwnGitRepo(dir: string): boolean {
  try {
    const toplevel = runGit(['rev-parse', '--show-toplevel'], dir);
    return resolve(toplevel) === resolve(dir);
  } catch {
    return false;
  }
}

function resolveLastUpdated(
  repoDir: string,
  moduleDirName: string,
): { lastUpdated: string | null; lastUpdatedSource: 'git' | 'unavailable' } {
  try {
    const out = runGit(['log', '-1', '--format=%cI', '--', `modules/${moduleDirName}`], repoDir);
    return out ? { lastUpdated: out, lastUpdatedSource: 'git' } : { lastUpdated: null, lastUpdatedSource: 'unavailable' };
  } catch {
    return { lastUpdated: null, lastUpdatedSource: 'unavailable' };
  }
}

function resolveSiteSha(siteRepoRoot: string): string {
  try {
    return runGit(['rev-parse', 'HEAD'], siteRepoRoot);
  } catch {
    return 'unknown';
  }
}

function resolveCloneDir(siteRepoRoot: string): string {
  return process.env.CCGM_SRC_DIR ? resolve(process.env.CCGM_SRC_DIR) : join(siteRepoRoot, '.ccgm-src');
}

function readExistingSourceSha(indexPath: string): string | null {
  if (!existsSync(indexPath)) return null;
  try {
    const data = JSON.parse(readFileSync(indexPath, 'utf-8')) as { meta?: { sourceSha?: string } };
    return data.meta?.sourceSha ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

/** Content sniff: text iff no NUL byte and it decodes cleanly as UTF-8. Extension is never used to decide text/binary (7 declared files have no extension at all). */
function isTextBuffer(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

type ContainmentResult =
  | { ok: true; absPath: string; resolvedOutsideModule: boolean }
  | { ok: false; reason: string };

/** Resolve a declared path with realpath and require it stay inside the clone root (not just the module dir -- a legitimate symlink can point at repo-root lib/). */
function checkContainment(
  moduleDir: string,
  moduleDirReal: string,
  repoRootReal: string,
  declaredKey: string,
): ContainmentResult {
  const declaredAbs = join(moduleDir, declaredKey);
  if (!existsSync(declaredAbs)) {
    return { ok: false, reason: 'declared file does not exist on disk' };
  }

  let real: string;
  try {
    real = realpathSync(declaredAbs);
  } catch (error) {
    return { ok: false, reason: `realpath failed: ${error instanceof Error ? error.message : String(error)}` };
  }

  const relToRepo = relative(repoRootReal, real);
  if (relToRepo.startsWith('..') || isAbsolute(relToRepo)) {
    return { ok: false, reason: 'resolves outside the repository clone root' };
  }

  const relToModule = relative(moduleDirReal, real);
  const resolvedOutsideModule = relToModule.startsWith('..') || isAbsolute(relToModule);
  return { ok: true, absPath: real, resolvedOutsideModule };
}

// ---------------------------------------------------------------------------
// Raw module.json shape
// ---------------------------------------------------------------------------

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
  configPrompts: ConfigPrompt[];
  status?: string;
  postInstall?: string;
}

// ---------------------------------------------------------------------------
// Presets + marketplace
// ---------------------------------------------------------------------------

function loadPresetDescriptions(repoDir: string): Map<string, string> {
  const path = join(repoDir, 'docs', 'preset-descriptions.json');
  if (!existsSync(path)) return new Map();
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, string>;
    return new Map(Object.entries(data));
  } catch {
    return new Map();
  }
}

function loadMarketplaceModuleNames(repoDir: string): Set<string> {
  const path = join(repoDir, '.claude-plugin', 'marketplace.json');
  if (!existsSync(path)) return new Set();
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8')) as { plugins?: Array<{ source?: string }> };
    const names = (data.plugins ?? [])
      .map((p) => p.source)
      .filter((s): s is string => typeof s === 'string')
      .map((s) => s.replace(/^\.\//, ''));
    return new Set(names);
  } catch {
    return new Set();
  }
}

interface PresetIngestResult {
  membership: Map<string, string[]>;
  records: PresetRecord[];
  skipped: Array<{ name: string; reason: string }>;
}

/** presets/*.json are bare arrays of module-name strings (§1.4 principle 14). Anything else is refused, never treated as a preset. */
function ingestPresets(repoDir: string, descriptions: Map<string, string>): PresetIngestResult {
  const presetsDir = join(repoDir, 'presets');
  const membership = new Map<string, string[]>();
  const records: PresetRecord[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];

  if (!existsSync(presetsDir)) return { membership, records, skipped };

  const presetFiles = readdirSync(presetsDir)
    .filter((f) => f.endsWith('.json'))
    .sort();

  for (const file of presetFiles) {
    const name = file.replace(/\.json$/, '');
    const raw = readFileSync(join(presetsDir, file), 'utf-8');

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      skipped.push({
        name: `preset:${name}`,
        reason: `invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === 'string')) {
      skipped.push({
        name: `preset:${name}`,
        reason: 'presets/*.json must parse as a bare array of module-name strings',
      });
      continue;
    }

    for (const moduleName of parsed) {
      const existing = membership.get(moduleName) ?? [];
      existing.push(name);
      membership.set(moduleName, existing);
    }

    records.push({ id: name, name, description: descriptions.get(name) ?? null, modules: parsed as string[] });
  }

  return { membership, records, skipped };
}

// ---------------------------------------------------------------------------
// Module ingestion
// ---------------------------------------------------------------------------

interface IngestContext {
  sourceSha: string;
  hasOwnGit: boolean;
  presetMembership: Map<string, string[]>;
  marketplaceModuleNames: Set<string>;
}

interface IngestModuleResult {
  record: Omit<ModuleRecord, never>;
  skippedFiles: Array<{ module: string; path: string; reason: string }>;
  sanitizedFiles: Array<{ module: string; path: string; codepoints: string[] }>;
}

function ingestModule(repoDir: string, repoRootReal: string, moduleDirName: string, ctx: IngestContext): IngestModuleResult {
  const moduleDir = join(repoDir, 'modules', moduleDirName);
  const manifestPath = join(moduleDir, 'module.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as RawModuleManifest;
  const moduleName = manifest.name;
  const moduleDirReal = realpathSync(moduleDir);

  const skippedFiles: Array<{ module: string; path: string; reason: string }> = [];
  const sanitizedFiles: Array<{ module: string; path: string; codepoints: string[] }> = [];

  const files: FileEntry[] = [];
  const contentFiles: ContentFile[] = [];
  const inventory: Record<string, number> = {};
  let contextCostTokens = 0;

  for (const [path, entry] of Object.entries(manifest.files)) {
    const containment = checkContainment(moduleDir, moduleDirReal, repoRootReal, path);
    if (!containment.ok) {
      skippedFiles.push({ module: moduleName, path, reason: containment.reason });
      continue;
    }

    const buffer = readFileSync(containment.absPath);
    const isText = isTextBuffer(buffer);
    const merge = entry.merge ?? false;
    const inventoryBucket = (KNOWN_FILE_TYPES as readonly string[]).includes(entry.type) ? entry.type : 'other';
    inventory[inventoryBucket] = (inventory[inventoryBucket] ?? 0) + 1;

    const rawUrl = `/modules/${moduleName}/files/${path}.txt`;

    files.push({
      path,
      target: entry.target,
      type: entry.type,
      template: entry.template,
      merge,
      bytes: buffer.byteLength,
      isText,
      rawUrl,
      resolvedOutsideModule: containment.resolvedOutsideModule,
    });

    if (!isText) {
      skippedFiles.push({ module: moduleName, path, reason: 'binary content -- omitted from contentFiles' });
      continue;
    }

    if (entry.type === 'rule') {
      contextCostTokens += estimateTokens(buffer.toString('utf-8'));
    }

    const sanitized = sanitizeText(buffer.toString('utf-8'));
    if (sanitized.codepoints.length > 0) {
      sanitizedFiles.push({ module: moduleName, path, codepoints: sanitized.codepoints });
    }

    let content = sanitized.text;
    if (path.endsWith('.md')) {
      content = rewriteRelativeReferences(content, { sourceSha: ctx.sourceSha, moduleName, filePathInModule: path });
    }

    const hasSubstitutionPlaceholders = entry.template === true && /__[A-Z][A-Z0-9_]*__/.test(content);

    contentFiles.push({
      path,
      content,
      type: entry.type,
      hasSubstitutionPlaceholders,
      isMergeFragment: merge,
      rawUrl,
      bytes: buffer.byteLength,
    });
  }

  // README.md is not required to appear in files{} (0/78 real modules
  // declare it there today), but nothing forbids it either. When it IS
  // also a declared file, reuse the contentFiles entry already produced
  // above instead of re-reading/re-sanitizing/re-rewriting the same bytes
  // a second time -- doing both would also double-record the same hit in
  // sanitizedFiles.
  let readmeMd = '';
  const alreadyIngestedReadme = contentFiles.find((f) => f.path === 'README.md');
  if (alreadyIngestedReadme) {
    readmeMd = alreadyIngestedReadme.content;
  } else {
    const readmePath = join(moduleDir, 'README.md');
    if (existsSync(readmePath)) {
      const raw = readFileSync(readmePath, 'utf-8');
      const sanitized = sanitizeText(raw);
      if (sanitized.codepoints.length > 0) {
        sanitizedFiles.push({ module: moduleName, path: 'README.md', codepoints: sanitized.codepoints });
      }
      readmeMd = rewriteRelativeReferences(sanitized.text, {
        sourceSha: ctx.sourceSha,
        moduleName,
        filePathInModule: 'README.md',
      });
    }
  }

  // postInstall names a path that may or may not be declared in files[]
  // (agent-manager/postInstall.sh is not, per §1.4). Ingest it either way
  // so a callout can show and link it instead of a dead reference.
  let postInstallFile: PostInstallFile | undefined;
  if (manifest.postInstall) {
    const alreadyDeclared = Object.prototype.hasOwnProperty.call(manifest.files, manifest.postInstall);
    if (alreadyDeclared) {
      const declared = files.find((f) => f.path === manifest.postInstall);
      const declaredContent = contentFiles.find((f) => f.path === manifest.postInstall);
      if (declared) {
        postInstallFile = { path: declared.path, content: declaredContent?.content ?? '', rawUrl: declared.rawUrl };
      }
    } else {
      const containment = checkContainment(moduleDir, moduleDirReal, repoRootReal, manifest.postInstall);
      if (containment.ok) {
        const buffer = readFileSync(containment.absPath);
        if (isTextBuffer(buffer)) {
          const sanitized = sanitizeText(buffer.toString('utf-8'));
          if (sanitized.codepoints.length > 0) {
            sanitizedFiles.push({ module: moduleName, path: manifest.postInstall, codepoints: sanitized.codepoints });
          }
          postInstallFile = {
            path: manifest.postInstall,
            content: sanitized.text,
            rawUrl: `/modules/${moduleName}/files/${manifest.postInstall}.txt`,
          };
        }
      } else {
        skippedFiles.push({ module: moduleName, path: manifest.postInstall, reason: containment.reason });
      }
    }
  }

  const lastUpdate = ctx.hasOwnGit
    ? resolveLastUpdated(repoDir, moduleDirName)
    : ({ lastUpdated: null, lastUpdatedSource: 'unavailable' } as const);

  const record: ModuleRecord = {
    id: moduleName,
    name: moduleName,
    displayName: manifest.displayName,
    description: manifest.description,
    summary: summarize(manifest.description),
    category: manifest.category as ModuleRecord['category'],
    scope: manifest.scope,
    dependencies: manifest.dependencies,
    tags: manifest.tags,
    status: manifest.status,
    postInstall: manifest.postInstall,
    configPrompts: manifest.configPrompts,
    files,
    inventory,
    contextCostTokens,
    lastUpdated: lastUpdate.lastUpdated,
    lastUpdatedSource: lastUpdate.lastUpdatedSource,
    presets: ctx.presetMembership.get(moduleName) ?? [],
    marketplacePlugin: ctx.marketplaceModuleNames.has(moduleName),
    readmeMd,
    postInstallFile,
    contentFiles,
    sourceUrl: `https://github.com/lucasmccomb/ccgm/tree/${ctx.sourceSha}/modules/${moduleName}`,
  };

  return { record, skippedFiles, sanitizedFiles };
}

function formatZodError(error: ZodError): string {
  return `schema validation failed: ${error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`;
}

// ---------------------------------------------------------------------------
// Pure repo -> {index, presetsFile} builder. No filesystem writes, no
// network, no clone management -- takes an already-resolved directory and
// returns the assembled, schema-validated output. This is what both main()
// (which adds the CLI/clone/write shell) and tests/unit/ingest.test.ts
// (which must never clobber the real src/generated/ another test or the
// build depends on) call directly.
// ---------------------------------------------------------------------------

export interface BuildIndexOptions {
  repoDir: string;
  sourceSha: string;
  hasOwnGit: boolean;
  siteSha: string;
  generatedAt: string;
}

export interface BuildIndexResult {
  index: ModulesIndex;
  presetsFile: PresetsFile;
}

export function buildIndex(options: BuildIndexOptions): BuildIndexResult {
  const { repoDir, sourceSha, hasOwnGit, siteSha, generatedAt } = options;

  const repoRootReal = realpathSync(repoDir);
  const modulesDir = join(repoDir, 'modules');
  const moduleDirNames = readdirSync(modulesDir)
    .filter((name) => statSync(join(modulesDir, name)).isDirectory())
    .sort();

  const marketplaceModuleNames = loadMarketplaceModuleNames(repoDir);
  const presetDescriptions = loadPresetDescriptions(repoDir);
  const {
    membership: presetMembership,
    records: presetRecords,
    skipped: presetSkipped,
  } = ingestPresets(repoDir, presetDescriptions);

  const modules: ModuleRecord[] = [];
  const skippedModules: Array<{ name: string; reason: string }> = [...presetSkipped];
  const allSkippedFiles: Array<{ module: string; path: string; reason: string }> = [];
  const allSanitizedFiles: Array<{ module: string; path: string; codepoints: string[] }> = [];

  for (const moduleDirName of moduleDirNames) {
    try {
      const { record, skippedFiles, sanitizedFiles } = ingestModule(repoDir, repoRootReal, moduleDirName, {
        sourceSha,
        hasOwnGit,
        presetMembership,
        marketplaceModuleNames,
      });
      const validated = moduleRecordSchema.parse(record);
      modules.push(validated);
      allSkippedFiles.push(...skippedFiles);
      allSanitizedFiles.push(...sanitizedFiles);
    } catch (error) {
      skippedModules.push({
        name: moduleDirName,
        reason:
          error instanceof ZodError
            ? formatZodError(error)
            : error instanceof Error
              ? error.message
              : String(error),
      });
    }
  }

  const categories: Record<string, number> = {};
  for (const mod of modules) {
    categories[mod.category] = (categories[mod.category] ?? 0) + 1;
  }

  const meta: IndexMeta = {
    schemaVersion: 1,
    sourceSha,
    sourceRef: 'main',
    siteSha,
    siteBuiltAt: generatedAt,
    generatedAt,
    moduleCount: modules.length,
    categories,
    skippedModules,
    skippedFiles: allSkippedFiles,
    sanitizedFiles: allSanitizedFiles,
    notice: AGENT_NOTICE,
  };

  const index: ModulesIndex = modulesIndexSchema.parse({ meta, modules });

  const presetsMeta: PresetsMeta = { schemaVersion: 1, sourceSha, generatedAt, notice: AGENT_NOTICE };
  const presetsFile: PresetsFile = presetsFileSchema.parse({ meta: presetsMeta, presets: presetRecords });

  return { index, presetsFile };
}

// ---------------------------------------------------------------------------
// Main (CLI shell: args, clone management, no-op short-circuit, file writes)
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { repoDir: repoDirArg, force } = parseArgs(process.argv.slice(2));

  const scriptDir = fileURLToPath(new URL('.', import.meta.url));
  const siteRepoRoot = resolve(scriptDir, '..');
  const outDir = resolve(siteRepoRoot, 'src', 'generated');
  const modulesOutDir = join(outDir, 'modules');
  const indexPath = join(outDir, 'modules-index.json');

  let repoDir: string;
  let managedClone = false;

  if (repoDirArg) {
    repoDir = repoDirArg;
    if (!existsSync(repoDir)) {
      throw new Error(`ingest: --repo-dir does not exist: ${repoDir}`);
    }
  } else {
    managedClone = true;
    repoDir = resolveCloneDir(siteRepoRoot);
    await ensureCcgmClone(repoDir);
  }

  const hasOwnGit = isOwnGitRepo(repoDir);
  const sourceSha = hasOwnGit ? runGit(['rev-parse', 'HEAD'], repoDir) : 'fixture';

  if (managedClone && !force) {
    const existingSha = readExistingSourceSha(indexPath);
    if (existingSha && existingSha === sourceSha) {
      console.log(`ingest: no-op -- src/generated/ already reflects ccgm@${sourceSha.slice(0, 7)}`);
      return;
    }
  }

  mkdirSync(modulesOutDir, { recursive: true });

  const generatedAt = new Date().toISOString();
  const siteSha = process.env.CF_PAGES_COMMIT_SHA ?? resolveSiteSha(siteRepoRoot);

  const { index, presetsFile } = buildIndex({ repoDir, sourceSha, hasOwnGit, siteSha, generatedAt });

  writeFileSync(indexPath, JSON.stringify(index, null, 2));
  for (const mod of index.modules) {
    writeFileSync(join(modulesOutDir, `${mod.name}.json`), JSON.stringify(mod, null, 2));
  }
  writeFileSync(join(outDir, 'presets.json'), JSON.stringify(presetsFile, null, 2));

  const { moduleCount, skippedModules } = index.meta;
  console.log(
    `ingest: wrote ${moduleCount} module(s), ${presetsFile.presets.length} preset(s) from ccgm@${sourceSha.slice(0, 7)}` +
      `${skippedModules.length ? ` (${skippedModules.length} skipped)` : ''}${force ? ' (forced)' : ''}`,
  );
}

// Only run when this file is executed directly (`tsx scripts/ingest.ts`),
// never when imported -- tests import buildIndex() and every other
// exported helper without triggering a clone or a src/generated/ write.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
