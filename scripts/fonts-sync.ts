#!/usr/bin/env tsx
/**
 * Idempotently copies the latin-subset woff2 files this site actually uses
 * (plus each source package's OFL LICENSE) from the pinned @fontsource*
 * devDependencies into public/fonts/. The result is committed --
 * public/fonts/ is NOT gitignored -- and this script is chained into
 * `build` so a missing or stale copy self-heals (§2).
 *
 * Kept lean per §2: latin subset only, variable weights where the package
 * ships them (Inter, Newsreader), and just the 400/700 static weights for
 * JetBrains Mono.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface FontSource {
  package: string;
  files: string[];
}

const FONT_SOURCES: FontSource[] = [
  {
    package: '@fontsource/jetbrains-mono',
    files: ['jetbrains-mono-latin-400-normal.woff2', 'jetbrains-mono-latin-700-normal.woff2'],
  },
  {
    package: '@fontsource-variable/inter',
    files: ['inter-latin-wght-normal.woff2'],
  },
  {
    package: '@fontsource-variable/newsreader',
    files: ['newsreader-latin-wght-normal.woff2'],
  },
];

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(scriptDir, '..');
const fontsOutDir = join(repoRoot, 'public', 'fonts');
const licensesOutDir = join(fontsOutDir, 'licenses');

function main(): void {
  mkdirSync(fontsOutDir, { recursive: true });
  mkdirSync(licensesOutDir, { recursive: true });

  for (const source of FONT_SOURCES) {
    const packageDir = join(repoRoot, 'node_modules', source.package);
    if (!existsSync(packageDir)) {
      throw new Error(`fonts:sync -- ${source.package} is not installed`);
    }

    for (const file of source.files) {
      const src = join(packageDir, 'files', file);
      if (!existsSync(src)) {
        throw new Error(`fonts:sync -- expected file missing in ${source.package}: ${file}`);
      }
      copyFileSync(src, join(fontsOutDir, file));
    }

    const licenseSrc = join(packageDir, 'LICENSE');
    if (existsSync(licenseSrc)) {
      const shortName = source.package.split('/').pop();
      const licenseText = readFileSync(licenseSrc, 'utf-8');
      writeFileSync(join(licensesOutDir, `${shortName}-LICENSE.txt`), licenseText);
    }
  }

  console.log(`fonts:sync -- synced ${FONT_SOURCES.length} font source(s) into public/fonts/`);
}

main();
