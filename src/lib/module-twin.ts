/**
 * Shared module .md-twin BODY builder (§5 E2/E5). Extracted from
 * src/pages/modules/[name].md.ts so the module detail page's
 * "copy entire module as markdown" button (E5, src/lib/module-bundle.ts)
 * reuses the exact same header/metadata rendering instead of re-deriving
 * it -- per the plan's "reuse E2's twin-building machinery for the string
 * -- do NOT re-render independently."
 *
 * renderModuleTwinBody's default behaviour (excludeMergeFragments: false)
 * is byte-for-byte what [name].md.ts always rendered: that machine
 * artifact legitimately lists every declared file, merge fragments
 * included, so an agent can still discover and fetch one via rawUrl.
 */
import { SITE_URL } from './site.ts';
import type { ModuleRecord } from './schema.ts';

export const PER_MODULE_TWIN_CAP_BYTES = 512 * 1024;

/** The metadata bullet list shared by the .md twin and the copy-entire-module bundle. */
export function buildModuleMetadataLines(mod: ModuleRecord, siteUrl: string): string[] {
  const lines: string[] = [];
  lines.push(`- Category: ${mod.category}`);
  lines.push(`- Status: ${mod.status ?? 'stable'}`);
  lines.push(`- Tags: ${mod.tags.length > 0 ? mod.tags.join(', ') : 'none'}`);
  lines.push(`- Dependencies: ${mod.dependencies.length > 0 ? mod.dependencies.join(', ') : 'none'}`);
  lines.push(`- Presets: ${mod.presets.length > 0 ? mod.presets.join(', ') : 'none'}`);
  lines.push(
    mod.contextCostTokens > 0
      ? `- Context cost: ~${mod.contextCostTokens} tokens (always-loaded rule files)`
      : '- Context cost: no always-loaded rules',
  );
  lines.push(`- Last updated: ${mod.lastUpdated ?? 'unknown'}`);
  if (mod.marketplacePlugin) lines.push('- Available as a native plugin marketplace entry');
  if (mod.postInstall) {
    lines.push(
      `- Manual follow-up required: ${mod.postInstall}` +
        (mod.postInstallFile ? ` (${siteUrl}${mod.postInstallFile.rawUrl})` : ''),
    );
  }
  return lines;
}

export interface RenderModuleTwinBodyOptions {
  inlineReadme: boolean;
  /** Omit merge-fragment entries from the "## Files" manifest list. Defaults to false (unchanged /modules/{name}.md behaviour). */
  excludeMergeFragments?: boolean;
}

export function renderModuleTwinBody(mod: ModuleRecord, options: RenderModuleTwinBodyOptions): string {
  const lines: string[] = [];

  lines.push(`# ${mod.displayName}`);
  lines.push('');
  lines.push(mod.description);
  lines.push('');
  lines.push(...buildModuleMetadataLines(mod, SITE_URL));
  lines.push('');

  if (mod.readmeMd) {
    lines.push('## README');
    lines.push('');
    if (options.inlineReadme) {
      lines.push(mod.readmeMd);
    } else {
      lines.push(`Full README available at ${mod.sourceUrl}.`);
    }
    lines.push('');
  }

  lines.push('## Files');
  lines.push('');
  for (const file of mod.files) {
    if (options.excludeMergeFragments && file.merge) continue;
    lines.push(`- \`${file.path}\` (${file.type}, ${file.bytes} bytes): ${SITE_URL}${file.rawUrl}`);
  }

  return lines.join('\n');
}
