/**
 * Markdown twin of the landing page (E4, wired via E2's `markdown.ts`
 * machinery). Body is built from the exact same `pagecopy.ts` constants
 * and generated data (`modules-index.json` meta, the ingested `modules`
 * collection) that `index.astro` renders -- never a re-authored summary.
 */
import type { APIRoute } from 'astro';
import { loadModulesIndex } from '../lib/generated.ts';
import { buildMarkdownTwin } from '../lib/markdown.ts';
import { SITE_URL } from '../lib/site.ts';
import {
  HERO_TAGLINE,
  INSTALL_COMMAND,
  INSTALL_PATHS_OVERVIEW,
  WHAT_IS_EXAMPLE_LEAD,
  WHAT_IS_HEADING,
  WHAT_IS_INTRO,
  WHAT_IS_MODULE_EXPLANATION,
} from '../lib/pagecopy.ts';

export const prerender = true;

export const GET: APIRoute = () => {
  const { meta, modules } = loadModulesIndex();
  const [exampleModule] = [...modules].sort((a, b) => a.name.localeCompare(b.name));

  const lines: string[] = [];

  lines.push('# CCGM -- Claude Code God Mode');
  lines.push('');
  lines.push(HERO_TAGLINE);
  lines.push('');
  lines.push('```');
  lines.push(INSTALL_COMMAND);
  lines.push('```');
  lines.push('');
  lines.push(
    `${meta.moduleCount} modules across ${Object.keys(meta.categories).length} categories.`,
  );
  lines.push('');
  lines.push(`## ${WHAT_IS_HEADING}`);
  lines.push('');
  lines.push(WHAT_IS_INTRO);
  lines.push('');
  lines.push(WHAT_IS_MODULE_EXPLANATION);
  lines.push('');
  for (const path of INSTALL_PATHS_OVERVIEW) {
    lines.push(`- [${path.name}](${SITE_URL}${path.href}): ${path.description}`);
  }
  lines.push('');

  if (exampleModule) {
    lines.push(WHAT_IS_EXAMPLE_LEAD);
    lines.push('');
    lines.push(`**${exampleModule.displayName}** -- ${exampleModule.summary}`);
    lines.push('');
  }

  const twin = buildMarkdownTwin(lines.join('\n'), {
    siteUrl: SITE_URL,
    sourceSha: meta.sourceSha,
    frontMatter: { schemaVersion: meta.schemaVersion, page: 'index', generatedAt: meta.generatedAt },
  });

  return new Response(twin, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
};
