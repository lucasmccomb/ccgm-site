/**
 * Prose constants and small deterministic formatting helpers for the
 * /rules surface (#22). Its own file, alongside src/lib/pagecopy.ts (the
 * landing/install/agents pages) and src/lib/modulepagecopy.ts (the module
 * catalog and detail pages) -- one copy file per surface family.
 *
 * Same rule as both of those: facts that come from the ingested repo (rule
 * counts, module names, file paths) are never hand-authored here. They are
 * read from the generated data at the call site and passed in as
 * parameters. This file owns sentence structure, not census data (§1.4
 * principle 2).
 */

export const RULES_TITLE = 'Rules -- CCGM';
export const RULES_DESCRIPTION =
  'Every rule file across every CCGM module, grouped by category, each readable and copyable on its own page.';
export const RULES_HEADING = 'Rules';

export const RULES_INTRO =
  'A rule is the always-loaded part of a module: a markdown file installed into ~/.claude/rules/ and read into context at the start of every session. Every rule below is shown exactly as it ships, with a copy button that reproduces the installed file byte for byte.';

export function rulesStatsLine(ruleCount: number, moduleCount: number, categoryCount: number): string {
  return `${ruleCount} rule${ruleCount === 1 ? '' : 's'} from ${moduleCount} module${
    moduleCount === 1 ? '' : 's'
  }, grouped across ${categoryCount} categories.`;
}

export const RULES_EMPTY_CATEGORY_TEXT = 'No rules in this category.';

// ---------------------------------------------------------------------------
// Rule detail page (/rules/{module}/{slug})
// ---------------------------------------------------------------------------

export const RULE_BODY_HEADING = 'Rule text';
export const RULES_INDEX_LINK_LABEL = 'All rules';

export function ruleModuleLinkText(moduleDisplayName: string): string {
  return `from ${moduleDisplayName}`;
}

export function ruleInstallsToText(target: string): string {
  return `installs to ~/.claude/${target}`;
}

/** Matches the module detail page's own non-inlined raw link wording. */
export function ruleRawLinkLabel(bytes: number): string {
  return `View raw (${bytes} bytes)`;
}

export function ruleTooLargeToInlineText(bytes: number): string {
  return `This rule is ${bytes} bytes -- over the per-file inline budget, so only the opening is shown here. The copy button and the raw link below both serve the whole file.`;
}
