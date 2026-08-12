#!/usr/bin/env tsx
/**
 * Regenerates tests/fixtures/repo-census.json from the current
 * src/generated/ ingest output (§1.4 principle 13). Requires `pnpm ingest`
 * (or `pnpm build`) to have already run against the real ccgm repo.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeCensus } from '../src/lib/census.ts';
import type { ModulesIndex, PresetsFile } from '../src/lib/schema.ts';

function main(): void {
  const scriptDir = fileURLToPath(new URL('.', import.meta.url));
  const repoRoot = resolve(scriptDir, '..');
  const indexPath = join(repoRoot, 'src', 'generated', 'modules-index.json');
  const presetsPath = join(repoRoot, 'src', 'generated', 'presets.json');
  const censusPath = join(repoRoot, 'tests', 'fixtures', 'repo-census.json');

  if (!existsSync(indexPath) || !existsSync(presetsPath)) {
    throw new Error('census:update -- src/generated/ not found; run `pnpm ingest` (against the real repo, not --repo-dir) first.');
  }

  const index = JSON.parse(readFileSync(indexPath, 'utf-8')) as ModulesIndex;
  const presetsFile = JSON.parse(readFileSync(presetsPath, 'utf-8')) as PresetsFile;

  if (index.meta.sourceSha === 'fixture') {
    throw new Error('census:update -- src/generated/ was produced with --repo-dir (fixture mode); run a real `pnpm ingest` first.');
  }

  const census = computeCensus(index, presetsFile);
  writeFileSync(censusPath, JSON.stringify(census, null, 2) + '\n');
  console.log(`census:update -- wrote ${censusPath} from ccgm@${index.meta.sourceSha.slice(0, 7)}`);
}

main();
