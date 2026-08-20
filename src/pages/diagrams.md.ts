/**
 * Markdown twin of the diagrams page (#24, §1.4 principle 3 parity).
 *
 * A twin cannot usefully carry an SVG, so each diagram degrades to the same
 * text the page's a11y layer already exposes: the `<title>`, the `<desc>`,
 * the visible summary, the ordered step list, and the traceability list --
 * every link absolute, resolved from the same ingested index the page uses.
 */
import type { APIRoute } from 'astro';
import { loadModulesIndex } from '../lib/generated.ts';
import { buildMarkdownTwin } from '../lib/markdown.ts';
import { SITE_URL } from '../lib/site.ts';
import {
  DIAGRAMS,
  DIAGRAMS_HEADING,
  DIAGRAMS_INTRO,
  DIAGRAMS_TRACEABILITY_LABEL,
  DIAGRAMS_TRACEABILITY_NOTE,
  resolveRefs,
} from '../lib/diagrams.ts';

export const prerender = true;

export const GET: APIRoute = () => {
  const { meta, modules } = loadModulesIndex();
  const options = {
    sourceSha: meta.sourceSha,
    siteUrl: SITE_URL,
    knownModules: new Set(modules.map((mod) => mod.name)),
  };

  const lines: string[] = [];

  lines.push(`# ${DIAGRAMS_HEADING}`);
  lines.push('');
  lines.push(DIAGRAMS_INTRO);
  lines.push('');
  lines.push(DIAGRAMS_TRACEABILITY_NOTE);
  lines.push('');

  for (const spec of DIAGRAMS) {
    lines.push(`## ${spec.heading}`);
    lines.push('');
    lines.push(spec.summary);
    lines.push('');
    lines.push(`**${spec.title}.** ${spec.desc}`);
    lines.push('');
    for (const [index, step] of spec.steps.entries()) {
      lines.push(`${index + 1}. ${step}`);
    }
    lines.push('');
    lines.push(`### ${DIAGRAMS_TRACEABILITY_LABEL}`);
    lines.push('');
    for (const ref of resolveRefs(spec.refs, options)) {
      lines.push(`- [\`${ref.path}\`](${ref.absoluteHref}): ${ref.role}`);
    }
    lines.push('');
  }

  const twin = buildMarkdownTwin(lines.join('\n'), {
    siteUrl: SITE_URL,
    sourceSha: meta.sourceSha,
    frontMatter: {
      schemaVersion: meta.schemaVersion,
      page: 'diagrams',
      generatedAt: meta.generatedAt,
    },
  });

  return new Response(twin, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
};
