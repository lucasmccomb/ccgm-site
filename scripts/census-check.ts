#!/usr/bin/env tsx
/**
 * Placeholder for the E2 census-facts comparison (§1.4 principle 13):
 * module count, file count, type/status histograms, preset names/sizes,
 * marketplace bijection, compared against a committed
 * tests/fixtures/repo-census.json snapshot and reported as a delta, never
 * failing the gate.
 *
 * E1 ships this as a no-op notice so `pnpm census:check` exists and is
 * runnable (CI's non-blocking step) before the real ingest pipeline lands.
 */
console.log('census:check -- census implemented in E2 (no-op in E1)');
process.exit(0);
