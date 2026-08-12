#!/usr/bin/env tsx
/**
 * Placeholder for the E2 census-snapshot refresh (§1.4 principle 13):
 * regenerates tests/fixtures/repo-census.json from a real ingest run.
 *
 * E1 ships this as a no-op notice so `pnpm census:update` exists and is
 * runnable before the real ingest pipeline lands.
 */
console.log('census:update -- census implemented in E2 (no-op in E1)');
process.exit(0);
