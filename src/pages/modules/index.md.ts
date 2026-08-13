/**
 * Twin of the module catalog. Built directly from ingested data (not from
 * rendering the /modules HTML page, which does not exist yet -- that page
 * is E4 scope; this data-driven twin is E2's).
 */
import type { APIRoute } from 'astro';
import { loadModulesIndex } from '../../lib/generated.ts';
import { buildMarkdownTwin } from '../../lib/markdown.ts';
import { SITE_URL } from '../../lib/site.ts';
import type { ModuleRecord } from '../../lib/schema.ts';

export const prerender = true;

export const GET: APIRoute = () => {
  const { meta, modules } = loadModulesIndex();

  const byCategory = new Map<string, ModuleRecord[]>();
  for (const mod of modules) {
    const list = byCategory.get(mod.category) ?? [];
    list.push(mod);
    byCategory.set(mod.category, list);
  }

  const lines: string[] = [];
  lines.push('# Module Catalog');
  lines.push('');
  lines.push(`${modules.length} modules across ${byCategory.size} categories.`);
  lines.push('');

  for (const [category, mods] of [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`## ${category}`);
    lines.push('');
    for (const mod of [...mods].sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`- [${mod.displayName}](${SITE_URL}/modules/${mod.name}.md): ${mod.summary}`);
    }
    lines.push('');
  }

  const twin = buildMarkdownTwin(lines.join('\n'), {
    siteUrl: SITE_URL,
    sourceSha: meta.sourceSha,
    frontMatter: { schemaVersion: meta.schemaVersion, generatedAt: meta.generatedAt, moduleCount: modules.length },
  });

  return new Response(twin, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
};
