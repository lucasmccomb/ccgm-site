/**
 * Markdown twin of the examples page (#23), wired via E2's `markdown.ts`
 * machinery. Body is built from the exact same `examples.ts` data and the same
 * ingested index `examples.astro` renders -- never a re-authored summary, and
 * in particular never a version of a block with its provenance label dropped.
 *
 * Machine-surface parity is the point: an agent reading the twin gets the same
 * verbatim/illustrative split, the same source attributions, and the same
 * per-anchor traceability a human reading the HTML page gets.
 */
import type { APIRoute } from 'astro';
import {
  ANCHORS_HEADING,
  COMMAND_EXAMPLES,
  EXAMPLES_HEADING,
  EXAMPLES_INTRO,
  NO_INVENTED_OUTPUT_NOTE,
  PROVENANCE_EXPLAINER,
  PROVENANCE_LABEL,
  SOURCE_LABEL,
  SOURCING_HEADING,
  provenanceTallyLine,
  resolveSource,
} from '../lib/examples.ts';
import { loadModulesIndex } from '../lib/generated.ts';
import { buildMarkdownTwin } from '../lib/markdown.ts';
import { SITE_URL } from '../lib/site.ts';

export const prerender = true;

/**
 * Fence a block body without letting its own backticks close the fence: pick a
 * run one longer than the longest run already inside the text. Several quoted
 * blocks are Markdown templates that contain backticks of their own.
 */
function fenceFor(text: string): string {
  const runs = text.match(/`+/g) ?? [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
}

/**
 * Inline-code an anchor without altering a single byte of it. Anchors are
 * literal fragments of source files and some contain backticks of their own,
 * so the delimiter run grows past the longest run inside, with CommonMark's
 * space padding when the text itself starts or ends with a backtick. Escaping
 * or stripping instead would silently break parity with the HTML page, which
 * renders the anchor exactly as declared.
 */
function inlineCode(text: string): string {
  const runs = text.match(/`+/g) ?? [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  const delimiter = '`'.repeat(longest + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${delimiter}${pad}${text}${pad}${delimiter}`;
}

export const GET: APIRoute = () => {
  const index = loadModulesIndex();
  const { meta } = index;

  const lines: string[] = [];

  lines.push(`# ${EXAMPLES_HEADING}`);
  lines.push('');
  lines.push(EXAMPLES_INTRO);
  lines.push('');

  lines.push(`## ${SOURCING_HEADING}`);
  lines.push('');
  lines.push(`- **${PROVENANCE_LABEL.verbatim}** -- ${PROVENANCE_EXPLAINER.verbatim}`);
  lines.push(`- **${PROVENANCE_LABEL.illustrative}** -- ${PROVENANCE_EXPLAINER.illustrative}`);
  lines.push('');
  lines.push(NO_INVENTED_OUTPUT_NOTE);
  lines.push('');
  lines.push(provenanceTallyLine());
  lines.push('');

  for (const example of COMMAND_EXAMPLES) {
    lines.push(`## ${example.command}`);
    lines.push('');
    lines.push(example.summary);
    lines.push('');
    lines.push(`Ships in [${example.module}](${SITE_URL}/modules/${example.module}).`);
    lines.push('');
    for (const paragraph of example.whatHappens) {
      lines.push(paragraph);
      lines.push('');
    }

    for (const block of example.blocks) {
      lines.push(`### ${block.caption}`);
      lines.push('');
      lines.push(`_${PROVENANCE_LABEL[block.provenance]}._`);
      lines.push('');

      const fence = fenceFor(block.text);
      lines.push(fence);
      lines.push(block.text);
      lines.push(fence);
      lines.push('');

      const attributions = block.sources.map((source) => {
        const resolved = resolveSource(index, source);
        return `[${resolved.displayName}](${SITE_URL}${resolved.modulePath}) / [\`${resolved.path}\`](${SITE_URL}${resolved.rawUrl})`;
      });
      lines.push(`${SOURCE_LABEL}: ${attributions.join(', ')}`);
      lines.push('');

      if (block.provenance === 'illustrative') {
        lines.push(`${ANCHORS_HEADING}:`);
        lines.push('');
        for (const anchor of block.anchors) {
          lines.push(`- ${inlineCode(anchor.text)} -- ${anchor.licenses}`);
        }
        lines.push('');
      }
    }
  }

  const twin = buildMarkdownTwin(lines.join('\n'), {
    siteUrl: SITE_URL,
    sourceSha: meta.sourceSha,
    frontMatter: { schemaVersion: meta.schemaVersion, page: 'examples', generatedAt: meta.generatedAt },
  });

  return new Response(twin, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
};
