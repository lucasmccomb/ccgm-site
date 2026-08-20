/**
 * Twin of the rules index (#22). Same shape as the module catalog's twin
 * (src/pages/modules/index.md.ts): grouped links to the per-item twins,
 * never inlined bodies -- a rule's body lives in its own
 * /rules/{module}/{slug}.md, under the same cap a module twin uses.
 */
import type { APIRoute } from 'astro';
import { loadModulesIndex } from '../../lib/generated.ts';
import { buildMarkdownTwin } from '../../lib/markdown.ts';
import { collectRules, groupRulesByCategory } from '../../lib/rules.ts';
import { RULES_HEADING, RULES_INTRO, rulesStatsLine } from '../../lib/rulespagecopy.ts';
import { SITE_URL } from '../../lib/site.ts';

export const prerender = true;

export const GET: APIRoute = () => {
  const { meta, modules } = loadModulesIndex();
  const rules = collectRules(modules);
  const groups = groupRulesByCategory(rules);
  const moduleCount = new Set(rules.map((rule) => rule.moduleName)).size;

  const lines: string[] = [];
  lines.push(`# ${RULES_HEADING}`);
  lines.push('');
  lines.push(RULES_INTRO);
  lines.push('');
  lines.push(rulesStatsLine(rules.length, moduleCount, groups.length));
  lines.push('');

  for (const group of groups) {
    lines.push(`## ${group.category}`);
    lines.push('');
    for (const rule of group.rules) {
      lines.push(
        `- [${rule.title}](${SITE_URL}${rule.twinUrl}): ${rule.moduleDisplayName} -- \`${rule.path}\`, ~${rule.tokens} tokens`,
      );
    }
    lines.push('');
  }

  const twin = buildMarkdownTwin(lines.join('\n'), {
    siteUrl: SITE_URL,
    sourceSha: meta.sourceSha,
    frontMatter: {
      schemaVersion: meta.schemaVersion,
      page: 'rules',
      generatedAt: meta.generatedAt,
      ruleCount: rules.length,
    },
  });

  return new Response(twin, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
};
