import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildIndex } from '../../scripts/ingest.ts';
import {
  CATEGORY_VALUES,
  FILE_TYPE_BUCKETS,
  indexMetaSchema,
  KNOWN_FILE_TYPES,
  moduleRecordSchema,
  modulesIndexSchema,
  presetRecordSchema,
  presetsFileSchema,
} from '../../src/lib/schema.ts';

const FIXTURE_DIR = resolve(process.cwd(), 'tests', 'fixtures', 'ccgm-mini');

function ingestFixture() {
  return buildIndex({
    repoDir: FIXTURE_DIR,
    sourceSha: 'fixturesha',
    hasOwnGit: false,
    siteSha: 'sitesha',
    generatedAt: '2026-01-01T00:00:00.000Z',
  });
}

describe('KNOWN_FILE_TYPES / FILE_TYPE_BUCKETS', () => {
  it('is the real 12-value module.json type vocabulary', () => {
    expect([...KNOWN_FILE_TYPES].sort()).toEqual(
      [
        'agent',
        'command',
        'config',
        'content',
        'doc',
        'hook',
        'lib',
        'rule',
        'script',
        'settings',
        'skill',
        'skill-reference',
      ].sort(),
    );
  });

  it('FILE_TYPE_BUCKETS is KNOWN_FILE_TYPES plus the "other" drift catchall', () => {
    expect(FILE_TYPE_BUCKETS).toEqual([...KNOWN_FILE_TYPES, 'other']);
  });
});

describe('ModuleRecord schema', () => {
  it('accepts every record ingest produces from the real fixture corpus with zero errors', () => {
    const { index } = ingestFixture();
    for (const mod of index.modules) {
      expect(() => moduleRecordSchema.parse(mod)).not.toThrow();
    }
  });

  it('accepts a record with status and postInstall present', () => {
    const { index } = ingestFixture();
    const mod = index.modules.find((m) => m.name === 'sample-hazards');
    expect(mod?.postInstall).toBeDefined();
    expect(() => moduleRecordSchema.parse(mod)).not.toThrow();
  });

  it('accepts status/postInstall absent (undefined, not null)', () => {
    const { index } = ingestFixture();
    const mod = index.modules.find((m) => m.name === 'sample-core');
    expect(mod?.status).toBeUndefined();
    expect(mod?.postInstall).toBeUndefined();
    expect(() => moduleRecordSchema.parse(mod)).not.toThrow();
  });

  it('rejects a category outside the known 5-value enum', () => {
    const { index } = ingestFixture();
    const mod = index.modules[0];
    expect(() => moduleRecordSchema.parse({ ...mod, category: 'not-a-real-category' })).toThrow();
  });

  it('CATEGORY_VALUES matches the real repo categories (§1.4 fact block)', () => {
    expect([...CATEGORY_VALUES].sort()).toEqual(['commands', 'core', 'patterns', 'tech-specific', 'workflow']);
  });

  it("inventory keys are restricted to the 13-bucket FileType enum (an uncollapsed unknown type is rejected)", () => {
    const { index } = ingestFixture();
    const mod = index.modules.find((m) => m.name === 'sample-hazards');
    expect(() =>
      moduleRecordSchema.parse({ ...mod, inventory: { ...mod?.inventory, 'not-a-bucket': 1 } }),
    ).toThrow();
  });
});

describe('PresetRecord schema', () => {
  it('accepts description: null (before the ccgm PR merges) and a real description string', () => {
    expect(() => presetRecordSchema.parse({ id: 'x', name: 'x', description: null, modules: [] })).not.toThrow();
    expect(() =>
      presetRecordSchema.parse({ id: 'x', name: 'x', description: 'a real description', modules: [] }),
    ).not.toThrow();
  });

  it('accepts every preset ingest produces from the real fixture corpus', () => {
    const { presetsFile } = ingestFixture();
    for (const preset of presetsFile.presets) {
      expect(() => presetRecordSchema.parse(preset)).not.toThrow();
    }
  });
});

describe('index meta / envelope schemas', () => {
  it('modulesIndexSchema validates the full fixture index', () => {
    const { index } = ingestFixture();
    expect(() => modulesIndexSchema.parse(index)).not.toThrow();
  });

  it('presetsFileSchema validates the full fixture presets file', () => {
    const { presetsFile } = ingestFixture();
    expect(() => presetsFileSchema.parse(presetsFile)).not.toThrow();
  });

  it('indexMetaSchema requires schemaVersion === 1 and sourceRef === "main"', () => {
    const { index } = ingestFixture();
    expect(() => indexMetaSchema.parse({ ...index.meta, schemaVersion: 2 })).toThrow();
    expect(() => indexMetaSchema.parse({ ...index.meta, sourceRef: 'develop' })).toThrow();
  });

  it('every machine artifact carries schemaVersion and the data-not-instructions notice', () => {
    const { index, presetsFile } = ingestFixture();
    expect(index.meta.schemaVersion).toBe(1);
    expect(index.meta.notice.length).toBeGreaterThan(0);
    expect(presetsFile.meta.schemaVersion).toBe(1);
    expect(presetsFile.meta.notice.length).toBeGreaterThan(0);
  });
});
