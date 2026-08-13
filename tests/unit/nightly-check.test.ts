import { describe, expect, it } from 'vitest';
import { decideStatus, parseCensusDelta } from '../../scripts/nightly-check.ts';

/**
 * The nightly-rebuild decision logic (§5 E7), tested in isolation from any
 * subprocess or filesystem access -- fast, deterministic, and exercises
 * all three branches the workflow can take (structural_failure /
 * census_delta / clean). See scripts/nightly-check.ts's header comment for
 * how the equivalent CLI behavior was additionally exercised ad hoc
 * against real --repo-dir fixtures.
 */

describe('decideStatus', () => {
  it('reports structural_failure when the pipeline itself failed, regardless of census delta', () => {
    const result = decideStatus(false, ['moduleCount: 78 -> 79']);
    expect(result.status).toBe('structural_failure');
  });

  it('reports structural_failure when the pipeline failed and there is no delta either', () => {
    const result = decideStatus(false, []);
    expect(result.status).toBe('structural_failure');
  });

  it('reports census_delta when the pipeline passed but the census snapshot diverged', () => {
    const result = decideStatus(true, ['moduleCount: 78 -> 79']);
    expect(result.status).toBe('census_delta');
    expect(result.message).toContain('moduleCount: 78 -> 79');
  });

  it('joins multiple delta lines in the reported message', () => {
    const result = decideStatus(true, ['moduleCount: 78 -> 79', 'presetSizes.standard: 16 -> 17']);
    expect(result.message).toBe('moduleCount: 78 -> 79\npresetSizes.standard: 16 -> 17');
  });

  it('reports clean when the pipeline passed and there is no census delta', () => {
    const result = decideStatus(true, []);
    expect(result.status).toBe('clean');
  });
});

describe('parseCensusDelta', () => {
  it('extracts delta bullet lines from a real census:check delta report', () => {
    const output = [
      'census:check -- 2 delta(s) against tests/fixtures/repo-census.json (non-blocking):',
      '  - moduleCount: 78 -> 79',
      '  - presetSizes.standard: 16 -> 17',
      'Run `pnpm census:update` to refresh the snapshot, and correct the §1.4 fact block in the same PR.',
    ].join('\n');

    expect(parseCensusDelta(output)).toEqual(['- moduleCount: 78 -> 79', '- presetSizes.standard: 16 -> 17']);
  });

  it('returns an empty array for a clean census:check report', () => {
    const output = 'census:check -- no delta against tests/fixtures/repo-census.json.';
    expect(parseCensusDelta(output)).toEqual([]);
  });

  it('returns an empty array when src/generated/ has not been built yet', () => {
    const output = 'census:check -- src/generated/ not found; run `pnpm ingest` or `pnpm build` first. Skipping (non-blocking).';
    expect(parseCensusDelta(output)).toEqual([]);
  });
});
