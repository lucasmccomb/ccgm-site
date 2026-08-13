/**
 * Module .md-twin builder (§3.4, §5 E2/E5, decisions.md clarification).
 *
 * §3.4's module-twin row says twins OVER the per-module cap "inline
 * metadata + per-file links instead of full bodies" -- the qualifier means
 * UNDER-cap twins inline full text-file bodies. This is the single place
 * that decides, per module, whether the emitted /modules/{name}.md fits
 * that under-cap shape (full bodies, grouped by type) or falls back to the
 * over-cap links-only shape -- and the module detail page's "copy entire
 * module" button reuses this SAME computation (via buildModuleTwin) rather
 * than re-deriving a separate bundle, per the plan's "reuse E2's
 * twin-building machinery -- do NOT re-render independently."
 *
 * Merge fragments (files[].merge) are NEVER inlined as a body, regardless
 * of the module's overall cap state: a naive paste of the twin must never
 * be able to overwrite someone's settings.json. Each merge fragment always
 * renders as an annotated link instead, so an installing agent still has
 * the rawUrl.
 */
import { buildMarkdownTwin } from './markdown.ts';
import { SITE_URL } from './site.ts';
import { FILE_TYPE_BUCKETS, type FileEntry, type ModuleRecord } from './schema.ts';

export const PER_MODULE_TWIN_CAP_BYTES = 512 * 1024;

export const FULL_TWIN_LABEL = 'copy entire module as markdown';

export function cappedTwinLabel(linkedFileCount: number): string {
  return `copy module manifest (too large to inline — ${linkedFileCount} file${linkedFileCount === 1 ? '' : 's'} linked)`;
}

/** The metadata bullet list shared by every twin variant. */
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

/** A fence at least one backtick longer than the longest backtick run already in the content, so a nested ``` in a file body never breaks the surrounding markdown. */
function fenceFor(content: string): string {
  const runs = content.match(/`+/g) ?? [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
}

function mergeFragmentTwinNote(file: FileEntry, siteUrl: string): string {
  return `merge fragment — merged into ~/.claude/settings.json, never copied over it; fetch raw: ${siteUrl}${file.rawUrl}`;
}

/** Group `files` by the real type vocabulary, FILE_TYPE_BUCKETS order, each group's files in their existing (already-declared) order. */
function groupFilesByType(files: FileEntry[]): Array<{ type: string; files: FileEntry[] }> {
  const groups: Array<{ type: string; files: FileEntry[] }> = [];
  for (const type of FILE_TYPE_BUCKETS) {
    const inGroup = files.filter((file) => file.type === type);
    if (inGroup.length > 0) groups.push({ type, files: inGroup });
  }
  return groups;
}

export interface RenderModuleTwinBodyOptions {
  inlineReadme: boolean;
  /**
   * Inline every non-merge text file's full body, grouped by type
   * (FILE_TYPE_BUCKETS order). Merge fragments always render as an
   * annotated link regardless of this flag. When false, every file
   * (merge fragments included) renders as the original flat link line --
   * unchanged from before this option existed, byte-for-byte.
   */
  inlineFileBodies: boolean;
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

  if (!options.inlineFileBodies) {
    for (const file of mod.files) {
      lines.push(`- \`${file.path}\` (${file.type}, ${file.bytes} bytes): ${SITE_URL}${file.rawUrl}`);
    }
    return lines.join('\n');
  }

  const contentByPath = new Map(mod.contentFiles.map((file) => [file.path, file]));

  for (const group of groupFilesByType(mod.files)) {
    lines.push(`### ${group.type}`);
    lines.push('');
    for (const file of group.files) {
      lines.push(`#### ${file.path}`);
      lines.push('');
      if (file.merge) {
        lines.push(mergeFragmentTwinNote(file, SITE_URL));
      } else {
        const contentFile = contentByPath.get(file.path);
        if (contentFile) {
          const fence = fenceFor(contentFile.content);
          lines.push(fence);
          lines.push(contentFile.content);
          lines.push(fence);
        } else {
          // Declared but not text (binary/skipped) -- no body to inline.
          lines.push(`Binary content -- fetch ${SITE_URL}${file.rawUrl}.`);
        }
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

export interface BuildModuleTwinOptions {
  siteUrl: string;
  sourceSha: string;
  frontMatter: Record<string, string | number | boolean | null>;
}

export interface ModuleTwinResult {
  /** The exact served/copied text: front matter + provenance preamble + body. */
  text: string;
  /** True when the full-body twin exceeded the per-module cap and fell back to a links-only body. */
  capped: boolean;
  /** Count of non-merge files rendered as a link only. 0 when not capped. */
  linkedFileCount: number;
}

/**
 * The single computation both /modules/{name}.md (src/pages/modules/[name].md.ts)
 * and the detail page's "copy entire module" button (src/pages/modules/[name].astro)
 * call -- so the button copies exactly what the twin endpoint serves, byte-exact,
 * with no separate rendering path to drift out of sync.
 */
export function buildModuleTwin(mod: ModuleRecord, options: BuildModuleTwinOptions): ModuleTwinResult {
  const { siteUrl, sourceSha, frontMatter } = options;

  const fullTwin = buildMarkdownTwin(renderModuleTwinBody(mod, { inlineReadme: true, inlineFileBodies: true }), {
    siteUrl,
    sourceSha,
    frontMatter,
  });
  if (Buffer.byteLength(fullTwin, 'utf-8') <= PER_MODULE_TWIN_CAP_BYTES) {
    return { text: fullTwin, capped: false, linkedFileCount: 0 };
  }

  // Over cap: fall back to the original links-only body (unchanged from
  // before body-inlining existed), still preferring an inlined README if
  // that alone fits.
  const linkedFileCount = mod.files.filter((file) => !file.merge).length;

  const linksOnlyReadmeIn = buildMarkdownTwin(
    renderModuleTwinBody(mod, { inlineReadme: true, inlineFileBodies: false }),
    { siteUrl, sourceSha, frontMatter },
  );
  if (Buffer.byteLength(linksOnlyReadmeIn, 'utf-8') <= PER_MODULE_TWIN_CAP_BYTES) {
    return { text: linksOnlyReadmeIn, capped: true, linkedFileCount };
  }

  const linksOnlyReadmeOut = buildMarkdownTwin(
    renderModuleTwinBody(mod, { inlineReadme: false, inlineFileBodies: false }),
    { siteUrl, sourceSha, frontMatter },
  );
  return { text: linksOnlyReadmeOut, capped: true, linkedFileCount };
}
