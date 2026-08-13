/**
 * "Copy entire module as markdown" bundle (§5 E5). Builds a genuinely
 * complete, pasteable text dump of a module: header/metadata + README +
 * every non-merge-fragment file's content grouped by type -- respecting
 * the same 250 KB / 64 KB inline budget (src/lib/inline-budget.ts) the
 * detail page itself uses to decide what renders inline, so the button
 * never silently promises content it isn't actually carrying (§3.4's fill
 * rule).
 *
 * Reuses E2's twin-building machinery rather than re-deriving it: the
 * header/metadata block is src/lib/module-twin.ts's shared
 * buildModuleMetadataLines(), and the leading notice is
 * markdown.ts's buildProvenancePreamble().
 *
 * Merge fragments (isMergeFragment) are ALWAYS excluded from this bundle
 * -- content and manifest mention alike. Copying a settings.json merge
 * fragment via a "grab everything" button is exactly the highest-
 * consequence copy hazard the merge-fragment treatment exists to prevent
 * (§5 E5). Each merge fragment stays individually copyable from its own
 * "copy fragment (for merging)" button in its own type section on the
 * page.
 */
import { buildProvenancePreamble } from './markdown.ts';
import { computeInlineBudget, type InlineBudgetResult } from './inline-budget.ts';
import { buildModuleMetadataLines } from './module-twin.ts';
import { FILE_TYPE_BUCKETS, type ModuleRecord } from './schema.ts';

export interface ModuleBundle {
  /** The exact text the "copy entire module" button copies. */
  text: string;
  /** True when at least one non-merge file's content was left out of the bundle for size reasons. */
  capped: boolean;
  /** Count of non-merge files represented as a link only, not embedded content. */
  linkedFileCount: number;
  /** The button label to render -- switches when `capped`. */
  label: string;
}

export const FULL_BUNDLE_LABEL = 'copy entire module as markdown';

export function cappedBundleLabel(linkedFileCount: number): string {
  return `copy module manifest (too large to inline — ${linkedFileCount} file${linkedFileCount === 1 ? '' : 's'} linked)`;
}

/** A fence at least one backtick longer than the longest backtick run already in the content, so nested ``` in file bodies never breaks the surrounding markdown. */
function fenceFor(content: string): string {
  const runs = content.match(/`+/g) ?? [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
}

export function buildModuleBundle(
  mod: ModuleRecord,
  siteUrl: string,
  sourceSha: string,
  budget?: InlineBudgetResult,
): ModuleBundle {
  const nonMergeFiles = mod.contentFiles.filter((file) => !file.isMergeFragment);
  const inlineResult = budget ?? computeInlineBudget(nonMergeFiles);
  const inlinedPaths = new Set(inlineResult.items.filter((item) => item.inlined).map((item) => item.file.path));

  const lines: string[] = [];
  lines.push(`# ${mod.displayName}`);
  lines.push('');
  lines.push(mod.description);
  lines.push('');
  lines.push(...buildModuleMetadataLines(mod, siteUrl));
  lines.push('');

  if (mod.readmeMd) {
    lines.push('## README');
    lines.push('');
    lines.push(mod.readmeMd);
    lines.push('');
  }

  for (const type of FILE_TYPE_BUCKETS) {
    const inGroup = nonMergeFiles.filter((file) => file.type === type);
    if (inGroup.length === 0) continue;

    lines.push(`## ${type}`);
    lines.push('');
    for (const file of inGroup) {
      lines.push(`### ${file.path}`);
      lines.push('');
      if (inlinedPaths.has(file.path)) {
        const fence = fenceFor(file.content);
        lines.push(fence);
        lines.push(file.content);
        lines.push(fence);
      } else {
        lines.push(`Too large to inline here -- fetch ${siteUrl}${file.rawUrl}.`);
      }
      lines.push('');
    }
  }

  const mergeFiles = mod.contentFiles.filter((file) => file.isMergeFragment);
  if (mergeFiles.length > 0) {
    lines.push('## Excluded: settings merge fragments');
    lines.push('');
    lines.push(
      'These files merge into `~/.claude/settings.json` rather than copying over it, so they are excluded ' +
        'from this bundle to avoid an accidental destructive paste. Copy each one individually from its own ' +
        '"copy fragment (for merging)" button on the module page:',
    );
    for (const file of mergeFiles) {
      lines.push(`- \`${file.path}\``);
    }
    lines.push('');
  }

  const body = lines.join('\n').trimEnd() + '\n';
  const preamble = buildProvenancePreamble({ siteUrl, sourceSha });
  const text = `${preamble}\n${body}`;

  const capped = inlineResult.remainderCount > 0;
  const label = capped ? cappedBundleLabel(inlineResult.remainderCount) : FULL_BUNDLE_LABEL;

  return { text, capped, linkedFileCount: inlineResult.remainderCount, label };
}
