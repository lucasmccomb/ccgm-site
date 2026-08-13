/**
 * Markdown twin of the install page (E4, wired via E2's `markdown.ts`
 * machinery). The preset table is rendered from `presets.json` -- the same
 * generated source `install.astro` reads -- never hand-authored.
 */
import type { APIRoute } from 'astro';
import { loadModulesIndex, loadPresets } from '../lib/generated.ts';
import { buildMarkdownTwin } from '../lib/markdown.ts';
import { SITE_URL } from '../lib/site.ts';
import {
  AGENT_PASTE_BLOCK,
  AGENT_TAB_INTRO,
  BASH_TAB_INTRO,
  BASH_TAB_NONINTERACTIVE_INTRO,
  INSTALL_COMMAND,
  INSTALL_COMMAND_NONINTERACTIVE,
  MANUAL_TAB_CATALOG_LINK_LABEL,
  MANUAL_TAB_INTRO,
  MARKETPLACE_ADD_COMMAND,
  MARKETPLACE_INSTALL_EXAMPLE_COMMAND,
  MARKETPLACE_NON_PARITY_NOTE,
  MARKETPLACE_TAB_INTRO,
  PRESET_TABLE_INTRO,
} from '../lib/pagecopy.ts';

export const prerender = true;

export const GET: APIRoute = () => {
  const { meta } = loadModulesIndex();
  const { presets } = loadPresets();
  const hasAnyDescription = presets.some((preset) => preset.description !== null);

  const lines: string[] = [];

  lines.push('# Install');
  lines.push('');

  lines.push('## Bash installer');
  lines.push('');
  lines.push(BASH_TAB_INTRO);
  lines.push('');
  lines.push('```');
  lines.push(INSTALL_COMMAND);
  lines.push('```');
  lines.push('');
  lines.push(BASH_TAB_NONINTERACTIVE_INTRO);
  lines.push('');
  lines.push('```');
  lines.push(INSTALL_COMMAND_NONINTERACTIVE);
  lines.push('```');
  lines.push('');

  lines.push('### Presets');
  lines.push('');
  lines.push(PRESET_TABLE_INTRO);
  lines.push('');
  if (presets.length > 0) {
    const header = hasAnyDescription
      ? '| Preset | Modules | Module list | Description |'
      : '| Preset | Modules | Module list |';
    const divider = hasAnyDescription ? '| --- | --- | --- | --- |' : '| --- | --- | --- |';
    lines.push(header);
    lines.push(divider);
    for (const preset of presets) {
      const row = [`\`${preset.name}\``, String(preset.modules.length), preset.modules.join(', ')];
      if (hasAnyDescription) row.push(preset.description ?? '');
      lines.push(`| ${row.join(' | ')} |`);
    }
    lines.push('');
  }

  lines.push('## Agent paste');
  lines.push('');
  lines.push(AGENT_TAB_INTRO);
  lines.push('');
  lines.push('```');
  lines.push(AGENT_PASTE_BLOCK);
  lines.push('```');
  lines.push('');

  lines.push('## Plugin marketplace');
  lines.push('');
  lines.push(MARKETPLACE_TAB_INTRO);
  lines.push('');
  lines.push('```');
  lines.push(MARKETPLACE_ADD_COMMAND);
  lines.push('```');
  lines.push('');
  lines.push('```');
  lines.push(MARKETPLACE_INSTALL_EXAMPLE_COMMAND);
  lines.push('```');
  lines.push('');
  lines.push(MARKETPLACE_NON_PARITY_NOTE);
  lines.push('');

  lines.push('## Manual, per module');
  lines.push('');
  lines.push(MANUAL_TAB_INTRO);
  lines.push('');
  lines.push(`[${MANUAL_TAB_CATALOG_LINK_LABEL}](${SITE_URL}/modules)`);

  const twin = buildMarkdownTwin(lines.join('\n'), {
    siteUrl: SITE_URL,
    sourceSha: meta.sourceSha,
    frontMatter: { schemaVersion: meta.schemaVersion, page: 'install', generatedAt: meta.generatedAt },
  });

  return new Response(twin, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
};
