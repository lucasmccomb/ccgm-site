/**
 * Census facts (§1.4 principle 13): properties of ccgm THIS WEEK, not of
 * the pipeline. Compared against a committed snapshot and reported as a
 * delta -- never asserted, never blocking. Shared by scripts/census-check.ts
 * and scripts/census-update.ts.
 */
import type { ModulesIndex, PresetsFile } from './schema.ts';

export interface Census {
  moduleCount: number;
  /** Σ per-module declared file count (emitted files[].length + that module's skippedFiles entries). */
  declaredFileCount: number;
  typeHistogram: Record<string, number>;
  statusDistribution: Record<string, number>;
  presetSizes: Record<string, number>;
  /** True iff every ingested module has marketplacePlugin === true. */
  marketplaceBijection: boolean;
  skippedFilesEmpty: boolean;
  sanitizedFilesEmpty: boolean;
  danglingDependenciesEmpty: boolean;
}

export function computeCensus(index: ModulesIndex, presetsFile: PresetsFile): Census {
  const typeHistogram: Record<string, number> = {};
  const statusDistribution: Record<string, number> = {};
  const moduleNames = new Set(index.modules.map((m) => m.name));
  let declaredFileCount = 0;
  let marketplaceTrueCount = 0;
  let danglingDependenciesEmpty = true;

  const skippedFilesByModule = new Map<string, number>();
  for (const skipped of index.meta.skippedFiles) {
    skippedFilesByModule.set(skipped.module, (skippedFilesByModule.get(skipped.module) ?? 0) + 1);
  }

  for (const mod of index.modules) {
    declaredFileCount += mod.files.length + (skippedFilesByModule.get(mod.name) ?? 0);

    for (const [type, count] of Object.entries(mod.inventory)) {
      typeHistogram[type] = (typeHistogram[type] ?? 0) + count;
    }

    const statusKey = mod.status ?? 'none';
    statusDistribution[statusKey] = (statusDistribution[statusKey] ?? 0) + 1;

    if (mod.marketplacePlugin) marketplaceTrueCount++;

    for (const dep of mod.dependencies) {
      if (!moduleNames.has(dep)) danglingDependenciesEmpty = false;
    }
  }

  const presetSizes: Record<string, number> = {};
  for (const preset of presetsFile.presets) {
    presetSizes[preset.name] = preset.modules.length;
  }

  return {
    moduleCount: index.modules.length,
    declaredFileCount,
    typeHistogram,
    statusDistribution,
    presetSizes,
    marketplaceBijection: marketplaceTrueCount === index.modules.length,
    skippedFilesEmpty: index.meta.skippedFiles.length === 0,
    sanitizedFilesEmpty: index.meta.sanitizedFiles.length === 0,
    danglingDependenciesEmpty,
  };
}

/** A human-readable delta report between a committed snapshot and the current census. Empty array means no delta. */
export function diffCensus(previous: Census, current: Census): string[] {
  const lines: string[] = [];

  if (previous.moduleCount !== current.moduleCount) {
    lines.push(`moduleCount: ${previous.moduleCount} -> ${current.moduleCount}`);
  }
  if (previous.declaredFileCount !== current.declaredFileCount) {
    lines.push(`declaredFileCount: ${previous.declaredFileCount} -> ${current.declaredFileCount}`);
  }

  diffRecord('typeHistogram', previous.typeHistogram, current.typeHistogram, lines);
  diffRecord('statusDistribution', previous.statusDistribution, current.statusDistribution, lines);
  diffRecord('presetSizes', previous.presetSizes, current.presetSizes, lines);

  if (previous.marketplaceBijection !== current.marketplaceBijection) {
    lines.push(`marketplaceBijection: ${previous.marketplaceBijection} -> ${current.marketplaceBijection}`);
  }
  if (previous.skippedFilesEmpty !== current.skippedFilesEmpty) {
    lines.push(`skippedFilesEmpty: ${previous.skippedFilesEmpty} -> ${current.skippedFilesEmpty}`);
  }
  if (previous.sanitizedFilesEmpty !== current.sanitizedFilesEmpty) {
    lines.push(`sanitizedFilesEmpty: ${previous.sanitizedFilesEmpty} -> ${current.sanitizedFilesEmpty}`);
  }
  if (previous.danglingDependenciesEmpty !== current.danglingDependenciesEmpty) {
    lines.push(`danglingDependenciesEmpty: ${previous.danglingDependenciesEmpty} -> ${current.danglingDependenciesEmpty}`);
  }

  return lines;
}

function diffRecord(label: string, previous: Record<string, number>, current: Record<string, number>, out: string[]): void {
  const keys = new Set([...Object.keys(previous), ...Object.keys(current)]);
  for (const key of [...keys].sort()) {
    const prevValue = previous[key] ?? 0;
    const currValue = current[key] ?? 0;
    if (prevValue !== currValue) {
      out.push(`${label}.${key}: ${prevValue} -> ${currValue}`);
    }
  }
}
