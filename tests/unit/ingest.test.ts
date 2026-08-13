import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildIndex, isSafeToRemoveCloneDir, type BuildIndexResult } from '../../scripts/ingest.ts';
import type { ModuleRecord } from '../../src/lib/schema.ts';

/**
 * Ingest pipeline over tests/fixtures/ccgm-mini (§5 E2, §8.1). Calls
 * buildIndex() directly -- the pure repo -> {index, presetsFile} builder
 * -- rather than spawning the CLI, so this suite never touches (or races
 * with) the real src/generated/ that `pnpm build` and the dist-reading
 * tests depend on.
 */

const FIXTURE_DIR = resolve(process.cwd(), 'tests', 'fixtures', 'ccgm-mini');
const FIXED_GENERATED_AT = '2026-01-01T00:00:00.000Z';

function ingestFixture(): BuildIndexResult {
  return buildIndex({
    repoDir: FIXTURE_DIR,
    sourceSha: 'fixturesha',
    hasOwnGit: false,
    siteSha: 'sitesha',
    generatedAt: FIXED_GENERATED_AT,
  });
}

function findModule(result: BuildIndexResult, name: string): ModuleRecord {
  const mod = result.index.modules.find((m) => m.name === name);
  if (!mod) throw new Error(`fixture module not found: ${name}`);
  return mod;
}

describe('ingest over ccgm-mini', () => {
  it('produces one record per valid fixture module and skips the malformed one with a reason', () => {
    const result = ingestFixture();
    const names = result.index.modules.map((m) => m.name).sort();
    expect(names).toEqual(['sample-core', 'sample-hazards', 'sample-tech', 'sample-workflow']);

    const malformed = result.index.meta.skippedModules.find((s) => s.name === 'sample-malformed');
    expect(malformed).toBeDefined();
    expect(malformed?.reason).toBeTruthy();

    // F3: syntactically valid JSON whose 'files' key is missing must
    // collect-and-skip with this exact reason, never throw an unhandled
    // TypeError from Object.entries(undefined).
    const filesMissing = result.index.meta.skippedModules.find((s) => s.name === 'sample-files-missing');
    expect(filesMissing?.reason).toBe("module.json 'files' is missing or not an object");
  });

  it('is deterministic apart from injected generatedAt/siteBuiltAt (byte-identical modules array across two runs)', () => {
    const a = ingestFixture();
    const b = ingestFixture();
    expect(a.index.modules).toEqual(b.index.modules);
    expect(a.index.meta.skippedModules).toEqual(b.index.meta.skippedModules);
    expect(a.presetsFile.presets).toEqual(b.presetsFile.presets);
  });

  it('sets lastUpdatedSource to "unavailable" for every module (the fixture tree is not its own git repo)', () => {
    const result = ingestFixture();
    for (const mod of result.index.modules) {
      expect(mod.lastUpdatedSource).toBe('unavailable');
      expect(mod.lastUpdated).toBeNull();
    }
  });

  it('flags placeholder.md (template:true + __VAR__) as hasSubstitutionPlaceholders', () => {
    const mod = findModule(ingestFixture(), 'sample-hazards');
    const file = mod.contentFiles.find((f) => f.path === 'templates/placeholder.md');
    expect(file?.hasSubstitutionPlaceholders).toBe(true);
  });

  it('does NOT flag scaffold.md (template:true, no placeholder text)', () => {
    const mod = findModule(ingestFixture(), 'sample-hazards');
    const file = mod.contentFiles.find((f) => f.path === 'templates/scaffold.md');
    expect(file?.hasSubstitutionPlaceholders).toBe(false);
  });

  it('does NOT flag a runtime-placeholder file (template:false + __VAR__ -- the conjunction, not content alone)', () => {
    const mod = findModule(ingestFixture(), 'sample-hazards');
    const file = mod.contentFiles.find((f) => f.path === 'lib/runtime-placeholder.sh');
    expect(file?.content).toContain('__RUNTIME_VAR__');
    expect(file?.hasSubstitutionPlaceholders).toBe(false);
  });

  it('flags the settings.partial.json merge fragment as isMergeFragment', () => {
    const mod = findModule(ingestFixture(), 'sample-hazards');
    const declared = mod.files.find((f) => f.path === 'settings.partial.json');
    const content = mod.contentFiles.find((f) => f.path === 'settings.partial.json');
    expect(declared?.merge).toBe(true);
    expect(content?.isMergeFragment).toBe(true);
  });

  it('emits the extension-less bin/sample-tool via content sniff, never dropping it for lacking an extension', () => {
    const mod = findModule(ingestFixture(), 'sample-hazards');
    const file = mod.contentFiles.find((f) => f.path === 'bin/sample-tool');
    expect(file).toBeDefined();
    expect(file?.content).toContain('sample-tool ran');
  });

  it('omits the binary asset from contentFiles and records it in skippedFiles', () => {
    const result = ingestFixture();
    const mod = findModule(result, 'sample-hazards');
    expect(mod.contentFiles.find((f) => f.path === 'assets/logo.png')).toBeUndefined();

    const declared = mod.files.find((f) => f.path === 'assets/logo.png');
    expect(declared?.isText).toBe(false);

    const skipped = result.index.meta.skippedFiles.find(
      (s) => s.module === 'sample-hazards' && s.path === 'assets/logo.png',
    );
    expect(skipped?.reason).toMatch(/binary/i);
  });

  it('refuses the out-of-clone symlink into skippedFiles and never emits it', () => {
    const result = ingestFixture();
    const mod = findModule(result, 'sample-hazards');
    expect(mod.files.find((f) => f.path === 'lib/escaped-symlink.sh')).toBeUndefined();

    const skipped = result.index.meta.skippedFiles.find(
      (s) => s.module === 'sample-hazards' && s.path === 'lib/escaped-symlink.sh',
    );
    expect(skipped?.reason).toMatch(/outside the repository clone root/);
  });

  it('emits the in-repo symlink that escapes its own module dir, flagged resolvedOutsideModule', () => {
    const mod = findModule(ingestFixture(), 'sample-hazards');
    const declared = mod.files.find((f) => f.path === 'lib/in-repo-symlink.sh');
    expect(declared?.resolvedOutsideModule).toBe(true);

    const content = mod.contentFiles.find((f) => f.path === 'lib/in-repo-symlink.sh');
    // Reads THROUGH the symlink -- the real content of sample-core's rule file.
    expect(content?.content).toContain('Sample Core Rule');
  });

  it('collapses an unrecognized declared type ("widget") to "other" in inventory and surfaces the drift on the file entry', () => {
    const mod = findModule(ingestFixture(), 'sample-hazards');
    const declared = mod.files.find((f) => f.path === 'lib/mystery.xyz');
    expect(declared?.type).toBe('widget');
    expect(mod.inventory.other).toBe(1);
  });

  it('has zero "rule"-type files for sample-tech (the zero-rule-files case)', () => {
    const mod = findModule(ingestFixture(), 'sample-tech');
    expect(mod.inventory.rule ?? 0).toBe(0);
    expect(mod.contextCostTokens).toBe(0);
  });

  it('ingests postInstall.postInstall-outside.sh even though it is not declared in files[]', () => {
    const mod = findModule(ingestFixture(), 'sample-hazards');
    expect(mod.postInstall).toBe('postInstall-outside.sh');
    expect(mod.files.find((f) => f.path === 'postInstall-outside.sh')).toBeUndefined();
    expect(mod.postInstallFile?.path).toBe('postInstall-outside.sh');
    expect(mod.postInstallFile?.content).toContain('manual follow-up step');
  });

  it('rewrites a relative link to a DECLARED file to a pinned-SHA GitHub blob URL', () => {
    const mod = findModule(ingestFixture(), 'sample-hazards');
    expect(mod.readmeMd).toContain(
      'https://github.com/lucasmccomb/ccgm/blob/fixturesha/modules/sample-hazards/lib/mystery.xyz',
    );
  });

  it('rewrites a relative link to an UNDECLARED file (mirroring dreaming/README.md) to a pinned-SHA GitHub blob URL', () => {
    const mod = findModule(ingestFixture(), 'sample-hazards');
    expect(mod.readmeMd).toContain(
      'https://github.com/lucasmccomb/ccgm/blob/fixturesha/modules/sample-hazards/docs/undeclared-note.md',
    );

    // No bare-relative (scheme-less, non-anchor) markdown link survives.
    // The one remaining non-rewritten link target is the XSS fixture's
    // `javascript:` payload -- it already carries a scheme (just a
    // dangerous one), so it is correctly left untouched by the relative-
    // reference rewrite; markdown-it's own link validator neutralizes it
    // at render time instead (see sanitize.test.ts).
    const linkTargets = [...mod.readmeMd.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]);
    const bareRelative = linkTargets.filter((url) => !/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith('#'));
    expect(bareRelative).toEqual([]);
  });

  it('strips zero-width and bidi codepoints from the XSS/bidi README and records the hit exactly once in sanitizedFiles', () => {
    const result = ingestFixture();
    const mod = findModule(result, 'sample-hazards');
    expect(mod.readmeMd).not.toMatch(/[\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069]/);

    const hits = result.index.meta.sanitizedFiles.filter(
      (s) => s.module === 'sample-hazards' && s.path === 'README.md',
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].codepoints.sort()).toEqual(['U+200B', 'U+202E']);
  });

  it('never double-processes README.md when it is also declared in files[] (readmeMd reuses the contentFiles entry)', () => {
    const mod = findModule(ingestFixture(), 'sample-hazards');
    const contentFilesReadme = mod.contentFiles.find((f) => f.path === 'README.md');
    expect(contentFilesReadme?.content).toBe(mod.readmeMd);
  });

  it('refuses presets/bad-preset.json (a non-array JSON file) into skippedModules and never treats it as a preset', () => {
    const result = ingestFixture();
    expect(result.presetsFile.presets.find((p) => p.name === 'bad-preset')).toBeUndefined();
    const skipped = result.index.meta.skippedModules.find((s) => s.name === 'preset:bad-preset');
    expect(skipped?.reason).toMatch(/bare array/);
  });

  it('resolves the dependency graph and preset membership across fixture modules', () => {
    const result = ingestFixture();
    const workflow = findModule(result, 'sample-workflow');
    expect(workflow.dependencies).toEqual(['sample-core']);

    const core = findModule(result, 'sample-core');
    expect(core.presets).toEqual(['sample']);
    expect(workflow.presets).toEqual(['sample']);
  });

  it('sums contextCostTokens over "rule"-type files only', () => {
    const core = findModule(ingestFixture(), 'sample-core');
    expect(core.contextCostTokens).toBeGreaterThan(0);
  });

  it('every emitted record validates with zero zod errors (buildIndex already asserts this; re-confirm the shape here)', () => {
    const result = ingestFixture();
    for (const mod of result.index.modules) {
      expect(mod.id).toBe(mod.name);
      expect(Array.isArray(mod.files)).toBe(true);
      expect(Array.isArray(mod.contentFiles)).toBe(true);
    }
  });
});

describe('isSafeToRemoveCloneDir (F1 -- guard against a CCGM_SRC_DIR typo)', () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('refuses "/" -- not named .ccgm-src, not empty, and no matching .git', () => {
    expect(isSafeToRemoveCloneDir('/')).toBe(false);
  });

  it('refuses a populated directory standing in for a mistyped $HOME', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ccgm-site-guard-home-'));
    writeFileSync(join(tempDir, '.zshrc'), 'export PATH=$PATH');
    mkdirSync(join(tempDir, 'Documents'));
    expect(isSafeToRemoveCloneDir(tempDir)).toBe(false);
  });

  it('allows an empty directory -- there is nothing to lose', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ccgm-site-guard-empty-'));
    expect(isSafeToRemoveCloneDir(tempDir)).toBe(true);
  });

  it('allows any directory named .ccgm-src regardless of contents', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ccgm-site-guard-parent-'));
    const ccgmSrcDir = join(tempDir, '.ccgm-src');
    mkdirSync(ccgmSrcDir);
    writeFileSync(join(ccgmSrcDir, 'stray-file.txt'), 'leftover from a prior run');
    expect(isSafeToRemoveCloneDir(ccgmSrcDir)).toBe(true);
  });

  it('allows a directory that already contains a matching ccgm clone', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ccgm-site-guard-clone-'));
    spawnSync('git', ['init', '--quiet'], { cwd: tempDir });
    spawnSync('git', ['remote', 'add', 'origin', 'https://github.com/lucasmccomb/ccgm.git'], { cwd: tempDir });
    expect(isSafeToRemoveCloneDir(tempDir)).toBe(true);
  });

  it('refuses a git repo whose origin points somewhere other than ccgm', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ccgm-site-guard-wrong-origin-'));
    spawnSync('git', ['init', '--quiet'], { cwd: tempDir });
    spawnSync('git', ['remote', 'add', 'origin', 'https://github.com/someone-else/not-ccgm.git'], { cwd: tempDir });
    expect(isSafeToRemoveCloneDir(tempDir)).toBe(false);
  });
});
