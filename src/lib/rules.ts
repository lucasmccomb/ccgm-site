/**
 * Data layer for the /rules surface (#22): collect every rule-type file
 * across every ingested module, derive its on-site URL, title and cost,
 * group it for display, and build its `.md` twin.
 *
 * Sourced from `ModuleRecord.contentFiles` -- the same array the module
 * detail page's file sections render from
 * (src/pages/modules/[name].astro). A declared rule file ingest could not
 * read as text never reaches contentFiles and is already accounted for in
 * `meta.skippedFiles`, exactly as it is on the module page; this surface
 * adds no second explanation path of its own.
 *
 * Nothing here is hand-authored. Every field is derived from the ingested
 * record at the pinned SHA (§1.4 principle 2), so the rule count, the
 * grouping, and every body track ccgm's main branch on their own.
 */
import { buildMarkdownTwin } from './markdown.ts';
import { fenceFor, mergeFragmentTwinNote, PER_MODULE_TWIN_CAP_BYTES } from './module-twin.ts';
import { blobUrlFor, estimateTokens } from './site.ts';
import { CATEGORY_VALUES, type ModuleRecord } from './schema.ts';

/** The `module.json` file `type` this surface indexes. One of KNOWN_FILE_TYPES. */
export const RULE_FILE_TYPE = 'rule';

export interface RuleRecord {
  moduleName: string;
  moduleDisplayName: string;
  /** The module's own category -- the axis /rules groups by. */
  category: string;
  /** Declared path inside the module, e.g. "rules/verification.md". */
  path: string;
  /** Install target inside ~/.claude/, from the module's files[] entry. */
  target: string;
  /** URL-safe, module-scoped slug. See ruleSlug(). */
  slug: string;
  title: string;
  content: string;
  bytes: number;
  /** Coarse always-loaded context cost, same estimator ingest sums per module. */
  tokens: number;
  isMergeFragment: boolean;
  hasSubstitutionPlaceholders: boolean;
  /** This site's byte-exact raw endpoint for the same file. */
  rawUrl: string;
  /** GitHub blob URL at the pinned SHA. */
  sourceUrl: string;
  /** On-site HTML page. */
  url: string;
  /** On-site Markdown twin. */
  twinUrl: string;
}

/**
 * A rule file's slug inside its own module: the declared path with a
 * leading `rules/` directory and the `.md` extension dropped, everything
 * else folded to a URL-safe token.
 *
 * The URL is module-scoped (`/rules/{module}/{slug}`) rather than a bare
 * `/rules/{slug}` on purpose. Every rule basename in ccgm happens to be
 * globally unique today, but that is a census fact, not a structural one:
 * module names are unique by construction, so scoping by module is what
 * makes the route collide-proof for any input ccgm could produce.
 */
export function ruleSlug(path: string): string {
  const slug = path
    .replace(/^rules\//, '')
    .replace(/\.md$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'rule';
}

/**
 * A rule's display title: its own first markdown H1, or its file name when
 * it has none.
 *
 * Two regions are skipped before scanning, because a `#` inside either is
 * not a heading and would otherwise become the rule's `<h1>`, its
 * `<title>`, its index-row label and its twin heading:
 *
 *  - a leading `---` YAML front-matter block, where `# note` is a comment
 *    (systematic-debugging/rules/debugging.md already ships front matter);
 *  - fenced code regions, where `# note` is usually a shell comment.
 */
export function ruleTitle(content: string, path: string): string {
  const lines = content.split('\n');
  let index = 0;

  if (lines[0]?.trim() === '---') {
    const close = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
    // No closing marker means that `---` was a horizontal rule, not front
    // matter -- scan from the top rather than swallowing the whole file.
    if (close !== -1) index = close + 1;
  }

  // A fence closes only on the same marker character, at least as long as
  // the one that opened it (CommonMark), so a shorter run inside a block
  // cannot end it early -- the same rule fenceFor() relies on when it
  // escalates a twin's fence.
  let openFence: string | null = null;

  for (; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];

    if (fence) {
      if (openFence === null) {
        openFence = fence;
      } else if (fence[0] === openFence[0] && fence.length >= openFence.length) {
        openFence = null;
      }
      continue;
    }

    if (openFence === null && /^#\s+\S/.test(line)) {
      return line.replace(/^#\s+/, '').trim();
    }
  }

  return path.replace(/^rules\//, '').replace(/\.md$/i, '');
}

export function rulePageUrl(moduleName: string, slug: string): string {
  return `/rules/${moduleName}/${slug}`;
}

export function ruleTwinUrl(moduleName: string, slug: string): string {
  return `${rulePageUrl(moduleName, slug)}.md`;
}

/**
 * Every rule file across every module, ordered by module name then
 * declared path.
 *
 * Throws when two rule files inside ONE module derive the same slug --
 * that would silently serve two different rules at one URL, so it fails
 * the build loudly instead (the same posture llms.ts takes on a blown cap
 * and [name].astro takes on a getStaticPaths/lookup drift).
 */
export function collectRules(modules: ModuleRecord[]): RuleRecord[] {
  const rules: RuleRecord[] = [];

  for (const mod of [...modules].sort((a, b) => a.name.localeCompare(b.name))) {
    const targetByPath = new Map(mod.files.map((file) => [file.path, file.target]));
    const slugOwner = new Map<string, string>();

    const ruleFiles = mod.contentFiles
      .filter((file) => file.type === RULE_FILE_TYPE)
      .sort((a, b) => a.path.localeCompare(b.path));

    for (const file of ruleFiles) {
      const slug = ruleSlug(file.path);
      const clash = slugOwner.get(slug);
      if (clash) {
        throw new Error(
          `rules: module "${mod.name}" derives the same /rules slug "${slug}" from both "${clash}" and ` +
            `"${file.path}" -- two rules cannot share one URL. Disambiguate ruleSlug() before shipping.`,
        );
      }
      slugOwner.set(slug, file.path);

      rules.push({
        moduleName: mod.name,
        moduleDisplayName: mod.displayName,
        category: mod.category,
        path: file.path,
        target: targetByPath.get(file.path) ?? file.path,
        slug,
        title: ruleTitle(file.content, file.path),
        content: file.content,
        bytes: file.bytes,
        tokens: estimateTokens(file.content),
        isMergeFragment: file.isMergeFragment,
        hasSubstitutionPlaceholders: file.hasSubstitutionPlaceholders,
        rawUrl: file.rawUrl,
        sourceUrl: blobUrlFor(mod.sourceUrl, file.path),
        url: rulePageUrl(mod.name, slug),
        twinUrl: ruleTwinUrl(mod.name, slug),
      });
    }
  }

  return rules;
}

export interface RuleCategoryGroup {
  category: string;
  rules: RuleRecord[];
}

/**
 * Group rules by their module's category. Every one of the five
 * CATEGORY_VALUES is always returned, including a category with no rules
 * today -- the same structural guarantee the module catalog makes about
 * its own category sections, rather than a shape that depends on this
 * week's census.
 */
export function groupRulesByCategory(rules: RuleRecord[]): RuleCategoryGroup[] {
  return CATEGORY_VALUES.map((category) => ({
    category,
    rules: rules.filter((rule) => rule.category === category),
  }));
}

export interface RenderRuleTwinBodyOptions {
  siteUrl: string;
  /**
   * Inline the rule's full body in a fenced block. A merge fragment is
   * never inlined regardless of this flag -- a naive paste of the twin
   * must not be able to overwrite someone's settings.json, exactly as in
   * module-twin.ts.
   */
  inlineBody: boolean;
}

export function renderRuleTwinBody(rule: RuleRecord, options: RenderRuleTwinBodyOptions): string {
  const { siteUrl } = options;
  const lines: string[] = [];

  lines.push(`# ${rule.title}`);
  lines.push('');
  lines.push(`- Module: ${rule.moduleDisplayName} (${siteUrl}/modules/${rule.moduleName}.md)`);
  lines.push(`- Category: ${rule.category}`);
  lines.push(`- Declared path: \`${rule.path}\``);
  // The install destination, not a repeat of the declared path above it:
  // `target` is module-relative, so the ~/.claude/ prefix is what makes
  // this line answer "where does this file land". Inlined here rather than
  // imported from rulespagecopy.ts, the same way mergeFragmentTwinNote()
  // inlines ~/.claude/settings.json (see the '## Rule text' note below).
  lines.push(`- Installs to: \`~/.claude/${rule.target}\``);
  lines.push(`- Size: ${rule.bytes} bytes (~${rule.tokens} tokens, always loaded)`);
  lines.push(`- Raw: ${siteUrl}${rule.rawUrl}`);
  lines.push(`- Source: ${rule.sourceUrl}`);
  lines.push('');

  // Hardcoded here rather than imported from rulespagecopy.ts, matching
  // how module-twin.ts writes its own '## Files' heading: a twin builder
  // owns its document structure, the page copy file owns the page's.
  lines.push('## Rule text');
  lines.push('');

  if (rule.isMergeFragment) {
    lines.push(mergeFragmentTwinNote(rule, siteUrl));
  } else if (options.inlineBody) {
    const fence = fenceFor(rule.content);
    lines.push(fence);
    lines.push(rule.content);
    lines.push(fence);
  } else {
    lines.push(`Body too large to inline -- fetch ${siteUrl}${rule.rawUrl}.`);
  }

  return lines.join('\n');
}

export interface BuildRuleTwinOptions {
  siteUrl: string;
  sourceSha: string;
  frontMatter: Record<string, string | number | boolean | null>;
}

export interface RuleTwinResult {
  /** The exact served/copied text: front matter + provenance preamble + body. */
  text: string;
  /** True when the full-body twin exceeded the cap and fell back to a link. */
  capped: boolean;
}

/**
 * The single computation /rules/{module}/{slug}.md serves. Same cap and
 * same fallback shape as a module twin (module-twin.ts): inline the body
 * when the assembled twin fits under PER_MODULE_TWIN_CAP_BYTES, otherwise
 * fall back to the raw-endpoint link.
 */
export function buildRuleTwin(rule: RuleRecord, options: BuildRuleTwinOptions): RuleTwinResult {
  const { siteUrl, sourceSha, frontMatter } = options;

  const full = buildMarkdownTwin(renderRuleTwinBody(rule, { siteUrl, inlineBody: true }), {
    siteUrl,
    sourceSha,
    frontMatter,
  });
  if (Buffer.byteLength(full, 'utf-8') <= PER_MODULE_TWIN_CAP_BYTES) {
    return { text: full, capped: false };
  }

  const linksOnly = buildMarkdownTwin(renderRuleTwinBody(rule, { siteUrl, inlineBody: false }), {
    siteUrl,
    sourceSha,
    frontMatter,
  });
  return { text: linksOnly, capped: true };
}
