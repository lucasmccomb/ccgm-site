#!/usr/bin/env tsx
/**
 * Census-facts comparison (§1.4 principle 13): module count, file count,
 * type/status histograms, preset names/sizes, marketplace bijection,
 * emptiness of skippedFiles/sanitizedFiles/dangling-deps -- compared
 * against a committed tests/fixtures/repo-census.json snapshot and
 * REPORTED as a delta, never failing the gate. Requires `pnpm ingest` (or
 * `pnpm build`) to have already run.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeCensus, diffCensus, type Census } from '../src/lib/census.ts';
import type { ModulesIndex, PresetsFile } from '../src/lib/schema.ts';

function main(): void {
  const scriptDir = fileURLToPath(new URL('.', import.meta.url));
  const repoRoot = resolve(scriptDir, '..');
  const indexPath = join(repoRoot, 'src', 'generated', 'modules-index.json');
  const presetsPath = join(repoRoot, 'src', 'generated', 'presets.json');
  const censusPath = join(repoRoot, 'tests', 'fixtures', 'repo-census.json');

  if (!existsSync(indexPath) || !existsSync(presetsPath)) {
    console.log('census:check -- src/generated/ not found; run `pnpm ingest` or `pnpm build` first. Skipping (non-blocking).');
    process.exit(0);
  }

  const index = JSON.parse(readFileSync(indexPath, 'utf-8')) as ModulesIndex;
  const presetsFile = JSON.parse(readFileSync(presetsPath, 'utf-8')) as PresetsFile;
  const current = computeCensus(index, presetsFile);

  if (!existsSync(censusPath)) {
    console.log('census:check -- no committed tests/fixtures/repo-census.json yet; run `pnpm census:update` to create it.');
    process.exit(0);
  }

  const previous = JSON.parse(readFileSync(censusPath, 'utf-8')) as Census;
  const delta = diffCensus(previous, current);

  if (delta.length === 0) {
    console.log('census:check -- no delta against tests/fixtures/repo-census.json.');
  } else {
    console.log(`census:check -- ${delta.length} delta(s) against tests/fixtures/repo-census.json (non-blocking):`);
    for (const line of delta) console.log(`  - ${line}`);
    console.log('Run `pnpm census:update` to refresh the snapshot, and correct the §1.4 fact block in the same PR.');
  }

  // Always exit 0: a census delta reports, it never blocks (§1.4 principle 13).
  process.exit(0);
}

main();
