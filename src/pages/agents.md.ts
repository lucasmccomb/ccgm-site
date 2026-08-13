/**
 * Markdown twin of the agents page (E4, wired via E2's `markdown.ts`
 * machinery). The zero-cost module percentage is computed from the same
 * ingested collection `agents.astro` reads -- never a hardcoded number.
 */
import type { APIRoute } from 'astro';
import { loadModulesIndex } from '../lib/generated.ts';
import { buildMarkdownTwin } from '../lib/markdown.ts';
import { SITE_URL } from '../lib/site.ts';
import {
  AGENTS_INTRO,
  AGENT_URL_SURFACE,
  DISCOVERY_HEADERS_TEXT,
  MD_TWIN_CONVENTION,
  SCHEMA_VERSION_POLICY,
  SIZE_CONTRACT,
  SIZE_CONTRACT_FOLLOWUP,
  TRUST_FRAMING,
  URL_IMPERMANENCE,
  agentPrompts,
  costMethodologyNote,
} from '../lib/pagecopy.ts';

export const prerender = true;

export const GET: APIRoute = () => {
  const { meta, modules } = loadModulesIndex();
  const zeroCostCount = modules.filter((mod) => mod.contextCostTokens === 0).length;
  const zeroCostPercent = modules.length > 0 ? Math.round((zeroCostCount / modules.length) * 100) : 0;
  const prompts = agentPrompts(SITE_URL);

  const lines: string[] = [];

  lines.push('# For agents');
  lines.push('');
  lines.push(AGENTS_INTRO);
  lines.push('');

  lines.push('## URL surface');
  lines.push('');
  lines.push('| Pattern | Content type | Purpose |');
  lines.push('| --- | --- | --- |');
  for (const row of AGENT_URL_SURFACE) {
    lines.push(`| \`${row.pattern}\` | ${row.contentType} | ${row.purpose} |`);
  }
  lines.push('');

  lines.push('## Markdown twins');
  lines.push('');
  lines.push(MD_TWIN_CONVENTION);
  lines.push('');

  lines.push('## Discovery headers');
  lines.push('');
  lines.push(DISCOVERY_HEADERS_TEXT);
  lines.push('');

  lines.push('## Size contract');
  lines.push('');
  lines.push('| Artifact | Cap | When exceeded |');
  lines.push('| --- | --- | --- |');
  for (const row of SIZE_CONTRACT) {
    lines.push(`| \`${row.artifact}\` | ${row.cap} | ${row.whenExceeded} |`);
  }
  lines.push('');
  lines.push(SIZE_CONTRACT_FOLLOWUP);
  lines.push('');

  lines.push('## Stability promises');
  lines.push('');
  lines.push('### schemaVersion policy');
  lines.push('');
  lines.push(SCHEMA_VERSION_POLICY);
  lines.push('');
  lines.push('### URL impermanence');
  lines.push('');
  lines.push(URL_IMPERMANENCE);
  lines.push('');

  lines.push('## Trust framing');
  lines.push('');
  for (const sentence of TRUST_FRAMING) {
    lines.push(sentence);
    lines.push('');
  }

  lines.push('## Cost methodology');
  lines.push('');
  lines.push(costMethodologyNote(zeroCostPercent));
  lines.push('');

  lines.push('## Copyable prompts');
  lines.push('');
  for (const prompt of prompts) {
    lines.push(`### ${prompt.label}`);
    lines.push('');
    lines.push('```');
    lines.push(prompt.text);
    lines.push('```');
    lines.push('');
  }

  const twin = buildMarkdownTwin(lines.join('\n'), {
    siteUrl: SITE_URL,
    sourceSha: meta.sourceSha,
    frontMatter: { schemaVersion: meta.schemaVersion, page: 'agents', generatedAt: meta.generatedAt },
  });

  return new Response(twin, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
};
