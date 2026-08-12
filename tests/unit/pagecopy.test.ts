import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AGENT_PASTE_BLOCK,
  agentPromptDiffPreset,
  agentPromptEvaluateCcgm,
  agentPromptInstallModule,
  agentPrompts,
  costMethodologyNote,
} from '../../src/lib/pagecopy.ts';

const DIST_DIR = join(process.cwd(), 'dist');
const GENERATED_DIR = join(process.cwd(), 'src', 'generated');

function requireDist(): void {
  if (!existsSync(DIST_DIR)) {
    throw new Error(
      'dist/ does not exist -- run `pnpm build` before `pnpm test` (dist-reading tests never skip)',
    );
  }
}

function requireGenerated(): void {
  if (!existsSync(GENERATED_DIR)) {
    throw new Error(
      'src/generated/ does not exist -- run `pnpm ingest` (or `pnpm build`) before `pnpm test`',
    );
  }
}

interface PresetRecord {
  name: string;
  description: string | null;
  modules: string[];
}

describe('AGENT_PASTE_BLOCK', () => {
  it('is the literal README paste block: starts with the install instruction, has 8 numbered steps, no trailing whitespace', () => {
    expect(AGENT_PASTE_BLOCK.startsWith('Install CCGM (Claude Code God Mode) for me.')).toBe(true);
    expect(AGENT_PASTE_BLOCK.endsWith('any errors.')).toBe(true);
    expect(AGENT_PASTE_BLOCK).not.toMatch(/[ \t]+\n/);
    expect(AGENT_PASTE_BLOCK).not.toMatch(/\s+$/);

    for (let step = 1; step <= 8; step++) {
      expect(AGENT_PASTE_BLOCK).toContain(`\n${step}. `);
    }
  });
});

describe('agent prompts', () => {
  it('interpolate the given siteUrl verbatim, never a hardcoded host', () => {
    const siteUrl = 'https://example-preview.pages.dev';

    expect(agentPromptEvaluateCcgm(siteUrl)).toContain(`${siteUrl}/llms.txt`);
    expect(agentPromptEvaluateCcgm(siteUrl)).toContain(`${siteUrl}/modules.json`);
    expect(agentPromptEvaluateCcgm(siteUrl)).not.toContain('ccgm.dev');

    expect(agentPromptInstallModule(siteUrl, 'code-quality')).toContain(
      `${siteUrl}/modules/code-quality.md`,
    );

    expect(agentPromptDiffPreset(siteUrl, 'standard')).toContain(`${siteUrl}/presets.json`);
    expect(agentPromptDiffPreset(siteUrl, 'standard')).toContain('"standard"');
  });

  it('agentPrompts() returns exactly 3 prompts with unique ids', () => {
    const prompts = agentPrompts('https://ccgm.dev');
    expect(prompts).toHaveLength(3);
    expect(new Set(prompts.map((p) => p.id)).size).toBe(3);
    for (const prompt of prompts) {
      expect(prompt.text).toContain('https://ccgm.dev');
    }
  });
});

describe('costMethodologyNote', () => {
  it('interpolates the given percentage, never a hardcoded census number', () => {
    expect(costMethodologyNote(49)).toContain('49%');
    expect(costMethodologyNote(0)).toContain('0%');
    expect(costMethodologyNote(49)).not.toContain('0%');
  });
});

describe('install page preset table (built output)', () => {
  it('renders exactly the presets in src/generated/presets.json, in order, with no site-authored description text', () => {
    requireDist();
    requireGenerated();

    const presetsJsonPath = join(GENERATED_DIR, 'presets.json');
    const presetsData = JSON.parse(readFileSync(presetsJsonPath, 'utf-8')) as {
      presets: PresetRecord[];
    };

    const html = readFileSync(join(DIST_DIR, 'install', 'index.html'), 'utf-8');

    // Extract every rendered preset row's data-* attributes, in document order.
    const rowPattern = /data-preset-row[^>]*data-preset-name="([^"]*)"[^>]*data-preset-module-count="([^"]*)"/g;
    const renderedRows: Array<{ name: string; moduleCount: number }> = [];
    let match: RegExpExecArray | null;
    while ((match = rowPattern.exec(html)) !== null) {
      renderedRows.push({ name: match[1], moduleCount: Number(match[2]) });
    }

    expect(renderedRows).toEqual(
      presetsData.presets.map((preset) => ({ name: preset.name, moduleCount: preset.modules.length })),
    );

    // Every rendered row's module list must equal the JSON's module list
    // exactly (comma-joined, in source order) -- never a hand-authored list.
    const moduleListPattern = /<td data-preset-modules[^>]*>([^<]*)<\/td>/g;
    const renderedModuleLists: string[] = [];
    while ((match = moduleListPattern.exec(html)) !== null) {
      renderedModuleLists.push(match[1]);
    }
    expect(renderedModuleLists).toEqual(presetsData.presets.map((preset) => preset.modules.join(', ')));

    // No preset in the fixture data carries a description yet (ccgm's
    // docs/preset-descriptions.json has not merged -- see E2 scope), so the
    // description column must not exist in the rendered page at all.
    const anyDescriptionInData = presetsData.presets.some((preset) => preset.description !== null);
    expect(anyDescriptionInData).toBe(false);
    expect(html).not.toContain('data-preset-description');
    expect(html).not.toContain('<th>Description</th>');
  });
});
