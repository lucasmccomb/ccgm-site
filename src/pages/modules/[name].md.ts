/**
 * Per-module .md twin (§3.4). Over the per-module cap, inlines metadata +
 * per-file links instead of full bodies -- reusing the same 512 KB
 * threshold as the JSON record's contentTruncated rule (§3.4).
 */
import type { APIRoute, GetStaticPaths } from 'astro';
import { loadModulesIndex } from '../../lib/generated.ts';
import { buildMarkdownTwin } from '../../lib/markdown.ts';
import { SITE_URL } from '../../lib/site.ts';
import type { ModuleRecord } from '../../lib/schema.ts';

export const prerender = true;

const PER_MODULE_TWIN_CAP_BYTES = 512 * 1024;

export const getStaticPaths: GetStaticPaths = () => {
  const { modules } = loadModulesIndex();
  return modules.map((mod) => ({ params: { name: mod.name } }));
};

function renderBody(mod: ModuleRecord, options: { inlineReadme: boolean }): string {
  const lines: string[] = [];

  lines.push(`# ${mod.displayName}`);
  lines.push('');
  lines.push(mod.description);
  lines.push('');
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
        (mod.postInstallFile ? ` (${SITE_URL}${mod.postInstallFile.rawUrl})` : ''),
    );
  }
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
    lines.push(`- \`${file.path}\` (${file.type}, ${file.bytes} bytes): ${SITE_URL}${file.rawUrl}`);
  }

  return lines.join('\n');
}

export const GET: APIRoute = ({ params }) => {
  const { meta, modules } = loadModulesIndex();
  const mod = modules.find((m) => m.name === params.name);
  if (!mod) return new Response('Not found', { status: 404 });

  const frontMatter = {
    schemaVersion: meta.schemaVersion,
    module: mod.name,
    sourceSha: meta.sourceSha,
    generatedAt: meta.generatedAt,
  };

  let twin = buildMarkdownTwin(renderBody(mod, { inlineReadme: true }), {
    siteUrl: SITE_URL,
    sourceSha: meta.sourceSha,
    frontMatter,
  });

  if (Buffer.byteLength(twin, 'utf-8') > PER_MODULE_TWIN_CAP_BYTES) {
    twin = buildMarkdownTwin(renderBody(mod, { inlineReadme: false }), {
      siteUrl: SITE_URL,
      sourceSha: meta.sourceSha,
      frontMatter,
    });
  }

  return new Response(twin, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
};
