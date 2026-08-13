/**
 * Prose constants and small deterministic formatting helpers for the
 * module catalog and detail pages (§5 E5). Kept in its own file, separate
 * from src/lib/pagecopy.ts (E4-owned; not edited by this epic -- see the
 * plan's E5 constraints: "module-page strings can live in the module page
 * or a new module-page constants file").
 *
 * Same rule as pagecopy.ts: facts that come from the ingested repo (module
 * names, file lists, counts) are never hand-authored here -- they are read
 * from the generated data at the call site and passed in as parameters.
 * This file owns sentence structure and small format functions, not
 * census data (§1.4 principle 2).
 */
import { FILE_TYPE_BUCKETS } from './schema.ts';

// ---------------------------------------------------------------------------
// Catalog (/modules)
// ---------------------------------------------------------------------------

export const CATALOG_TITLE = 'Modules -- CCGM';
export const CATALOG_DESCRIPTION =
  'Browse every CCGM module by category, filter by tag, and open a module to copy its files or install it.';
export const CATALOG_HEADING = 'Modules';

export function catalogStatsLine(moduleCount: number, categoryCount: number): string {
  return `${moduleCount} modules across ${categoryCount} categories.`;
}

export function categoryHeading(category: string, count: number): string {
  return `${category} (${count})`;
}

export const TAG_FILTER_LABEL = 'Filter by tag';
export const TAG_FILTER_CLEAR_LABEL = 'Clear filter';
export const TAG_FILTER_NO_JS_NOTE =
  'These chips filter the list below when JavaScript is available. Without it, every module is already listed by category above.';
export const CATALOG_EMPTY_STATE_TEXT = 'No modules match the selected tags.';

// ---------------------------------------------------------------------------
// ModuleCard badges
// ---------------------------------------------------------------------------

export const ZERO_COST_BADGE_TEXT = 'no always-loaded rules -- loads on demand';

export function tokenCostBadgeText(tokens: number): string {
  return `~${tokens} tokens`;
}

export function contextCostBadgeText(tokens: number): string {
  return tokens > 0 ? tokenCostBadgeText(tokens) : ZERO_COST_BADGE_TEXT;
}

export function formatLastUpdated(lastUpdated: string | null): string {
  return lastUpdated ? lastUpdated.slice(0, 10) : 'unknown';
}

/**
 * A short, distinct label per file type for the card's inventory row.
 * FILE_TYPE_BUCKETS is the exhaustive real vocabulary (§1.4); a value
 * outside it can only mean the schema itself changed, so the fallback is
 * a generic truncation rather than a silent gap.
 */
const INVENTORY_GLYPHS: Record<(typeof FILE_TYPE_BUCKETS)[number], string> = {
  rule: 'RUL',
  command: 'CMD',
  hook: 'HOK',
  skill: 'SKL',
  agent: 'AGT',
  lib: 'LIB',
  script: 'SCR',
  doc: 'DOC',
  config: 'CFG',
  settings: 'SET',
  content: 'CNT',
  'skill-reference': 'SKR',
  other: 'OTH',
};

export function inventoryGlyph(type: string): string {
  return (INVENTORY_GLYPHS as Record<string, string | undefined>)[type] ?? type.slice(0, 3).toUpperCase();
}

export function inventoryItemLabel(type: string, count: number): string {
  return `${count} ${type} file${count === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------------------
// Module detail page: section headings
// ---------------------------------------------------------------------------

export const README_HEADING = 'README';
export const WILL_INSTALL_HEADING = 'Will install';
export const WILL_INSTALL_PATH_COLUMN = 'Path';
export const WILL_INSTALL_ACTION_COLUMN = 'Action';
export const WILL_INSTALL_TARGET_COLUMN = 'Target';
export const WILL_INSTALL_TYPE_COLUMN = 'Type';
export const WILL_INSTALL_MERGE_ACTION = 'merge';
export const WILL_INSTALL_COPY_ACTION = '→'; // "->"

export const DEPENDENCIES_HEADING = 'Dependencies';
export const NO_DEPENDENCIES_TEXT = 'No dependencies.';
export const REQUIRED_BY_HEADING = 'Required by';
export const NO_REQUIRED_BY_TEXT = 'No other module depends on this one.';
export const CONFIG_PROMPTS_HEADING = 'Asks during install';
export const PRESETS_HEADING = 'Included in presets';
export const NO_PRESETS_TEXT = 'Not included in any preset.';
export const TAGS_HEADING = 'Tags';
export const SOURCE_LINK_LABEL = 'View source on GitHub';
export const FILES_HEADING = 'Files';
export const COPY_ENTIRE_MODULE_LABEL_ID = 'copy-entire-module';

// ---------------------------------------------------------------------------
// Merge-fragment treatment
// ---------------------------------------------------------------------------

export const MERGE_FRAGMENT_ANNOTATION =
  'Merged into ~/.claude/settings.json -- a fragment, not a replacement.';
export const MERGE_FRAGMENT_COPY_LABEL = 'copy fragment (for merging)';

// ---------------------------------------------------------------------------
// Placeholder-substitution treatment
// ---------------------------------------------------------------------------

export const PLACEHOLDER_ANNOTATION =
  'Uses installer-substituted placeholders -- install via the bash installer, or fill in the __VARS__ after copying.';

// ---------------------------------------------------------------------------
// Deprecated-status treatment
// ---------------------------------------------------------------------------

export const DEPRECATED_BANNER_HEADING = 'Unmaintained module';
export const DEPRECATED_BANNER_TEXT =
  'This module is unmaintained and is not offered for new installs. Its files remain available for reference below.';
export const DEPRECATED_INSTALL_SUMMARY = 'Install anyway';

// ---------------------------------------------------------------------------
// postInstall callout
// ---------------------------------------------------------------------------

export const POST_INSTALL_HEADING = 'Manual step after install';

export function postInstallCalloutText(postInstallPath: string): string {
  return `This module requires a manual follow-up step after installing: run ${postInstallPath}.`;
}

// ---------------------------------------------------------------------------
// Install strip (three co-equal options)
// ---------------------------------------------------------------------------

export function agentPromptInstallThisModule(siteUrl: string, moduleName: string): string {
  return `Fetch ${siteUrl}/modules/${moduleName}.md and install this module into my Claude Code setup.`;
}

export function marketplaceInstallCommand(moduleName: string): string {
  return `claude plugin install ${moduleName}@ccgm`;
}

export const INSTALL_STRIP_HEADING = 'Install this module';

export const INSTALL_OPTION_AGENT_LABEL = 'Agent prompt';
export const INSTALL_OPTION_AGENT_ANNOTATION =
  'Recommended for agent users -- hands the whole install off to your assistant.';

export const INSTALL_OPTION_MARKETPLACE_LABEL = 'Native plugin marketplace';
export const INSTALL_OPTION_MARKETPLACE_ANNOTATION =
  'One command via the native plugin marketplace -- additive, does not merge settings.json.';

export const INSTALL_OPTION_MANUAL_LABEL = 'Manual, per file';
export const INSTALL_OPTION_MANUAL_ANNOTATION =
  'Full control -- copy exactly the files you want from the sections below.';

// ---------------------------------------------------------------------------
// Fill-rule remainder note
// ---------------------------------------------------------------------------

export function remainderNoteText(remainderCount: number): string {
  return `${remainderCount} further file${remainderCount === 1 ? ' is' : 's are'} available as raw text.`;
}
