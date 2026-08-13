#!/usr/bin/env tsx
/**
 * Nightly rebuild decision logic (§5 E7, §3.6 point 4). Called by
 * .github/workflows/nightly-rebuild.yml, and directly for local/test
 * invocations.
 *
 * Real nightly run (no --repo-dir): ingests real ccgm main, then runs the
 * full build and unit suite -- matching ci.yml's own ingest -> build ->
 * unit-tests order exactly. A failure anywhere in that chain means the
 * pipeline itself is broken (structural_failure): the workflow opens an
 * ingest-drift issue and skips the rebuild -- never deploy on top of a
 * broken pipeline. Otherwise `pnpm census:check` runs against the committed
 * tests/fixtures/repo-census.json snapshot: a non-empty delta is content,
 * not breakage (§1.4 principle 13) -- census_delta is reported but the
 * rebuild proceeds. No delta at all is `clean`.
 *
 * --repo-dir <path> is a LOCAL/TEST-ONLY affordance, forwarded to
 * `pnpm ingest -- --repo-dir <path>` -- the real nightly run never passes
 * it (adrev3-006's "the real build always clones" applies here the same
 * way it applies to scripts/ingest.ts itself). Because --repo-dir mode
 * never creates the managed clone at .ccgm-src/, the handful of
 * repo-invariants.test.ts assertions that require a REAL clone (that
 * file's second describe block, "E2 structural invariants (ingest
 * pipeline...)") cannot pass by construction in this mode -- so --repo-dir
 * mode scopes the unit-test step to the clone-independent first describe
 * block ("repo invariants (structural, hard-asserted, never loosened)")
 * only. This makes --repo-dir tests/fixtures/ccgm-mini exercise the
 * census_delta path for free (ccgm-mini's 4-module census differs wildly
 * from the real 78-module snapshot), and --repo-dir <a nonexistent path>
 * exercise the structural_failure path deterministically (ingest itself
 * refuses with a clear error). See tests/unit/nightly-check.test.ts for
 * the three-path decision-logic unit tests, and the E7 verification notes
 * for the ad hoc CLI runs that exercised all three paths against real
 * fixtures.
 */
import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export type NightlyStatus = 'structural_failure' | 'census_delta' | 'clean';

export interface NightlyResult {
  status: NightlyStatus;
  message: string;
}

/**
 * Pure decision function -- no subprocess, no filesystem. Unit-tested
 * directly for all three statuses (tests/unit/nightly-check.test.ts).
 *
 * censusCheckOk is `pnpm census:check`'s own exit code, separate from
 * censusDeltaLines: census-check always exits 0 when it *reports* a delta
 * (§1.4 principle 13 -- content, not breakage), so a nonzero exit means the
 * script itself crashed (uncaught exception, unparseable src/generated/
 * output, etc). A crash folds into structural_failure -- the pipeline could
 * not be trusted, so the nightly must not silently read "no delta" off a
 * command that never ran to completion and deploy over it.
 */
export function decideStatus(
  structuralOk: boolean,
  censusCheckOk: boolean,
  censusDeltaLines: string[],
): NightlyResult {
  if (!structuralOk) {
    return {
      status: 'structural_failure',
      message: 'ingest/build/unit-test pipeline failed -- rebuild skipped, see the workflow log for the failing step',
    };
  }
  if (!censusCheckOk) {
    return {
      status: 'structural_failure',
      message: 'pnpm census:check crashed (nonzero exit) -- rebuild skipped, see the workflow log for the failing step',
    };
  }
  if (censusDeltaLines.length > 0) {
    return {
      status: 'census_delta',
      message: censusDeltaLines.join('\n'),
    };
  }
  return { status: 'clean', message: 'no census delta' };
}

/** Extracts the per-line delta bullets from `pnpm census:check`'s stdout, or []. */
export function parseCensusDelta(censusCheckOutput: string): string[] {
  if (!/\d+ delta\(s\) against/.test(censusCheckOutput)) return [];
  return censusCheckOutput
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '));
}

function run(command: string, args: string[]): boolean {
  console.log(`nightly-check: $ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { stdio: 'inherit' });
  return result.status === 0;
}

function runCapture(command: string, args: string[]): { output: string; ok: boolean } {
  const result = spawnSync(command, args, { encoding: 'utf-8' });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  process.stdout.write(output);
  return { output, ok: result.status === 0 };
}

function parseRepoDir(argv: string[]): string | null {
  const idx = argv.indexOf('--repo-dir');
  if (idx === -1) return null;
  const value = argv[idx + 1];
  if (!value) throw new Error('nightly-check: --repo-dir requires a path');
  return value;
}

function runStructuralCheck(repoDir: string | null): boolean {
  if (repoDir) {
    console.log(`nightly-check: --repo-dir set (${repoDir}) -- local/test mode, scoping the unit suite to the clone-independent structural invariants`);
    return (
      run('pnpm', ['ingest', '--', '--repo-dir', repoDir]) &&
      run('pnpm', ['fonts:sync']) &&
      run('pnpm', ['banner']) &&
      run('pnpm', ['exec', 'astro', 'build']) &&
      run('pnpm', ['gen:headers']) &&
      run('pnpm', ['exec', 'pagefind', '--site', 'dist']) &&
      run('pnpm', ['exec', 'vitest', 'run', '-t', 'repo invariants \\(structural, hard-asserted, never loosened\\)'])
    );
  }

  console.log('nightly-check: real mode -- ingesting ccgm main, matching ci.yml order (ingest -> build -> test)');
  return run('pnpm', ['ingest']) && run('pnpm', ['build']) && run('pnpm', ['test']);
}

function writeGithubOutput(result: NightlyResult): void {
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (!githubOutput) return;
  appendFileSync(githubOutput, `status=${result.status}\n`);
  appendFileSync(githubOutput, `delta<<NIGHTLY_DELTA_EOF\n${result.message}\nNIGHTLY_DELTA_EOF\n`);
}

function main(): void {
  const repoDir = parseRepoDir(process.argv.slice(2));

  const structuralOk = runStructuralCheck(repoDir);

  let censusCheckOk = true;
  let censusDeltaLines: string[] = [];
  if (structuralOk) {
    console.log('nightly-check: checking census...');
    const { output: censusOutput, ok } = runCapture('pnpm', ['census:check']);
    censusCheckOk = ok;
    censusDeltaLines = parseCensusDelta(censusOutput);
  }

  const result = decideStatus(structuralOk, censusCheckOk, censusDeltaLines);
  console.log(`NIGHTLY_STATUS=${result.status}`);
  writeGithubOutput(result);

  process.exitCode = result.status === 'structural_failure' ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
