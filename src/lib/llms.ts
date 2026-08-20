/**
 * `/llms.txt` and `/llms-full.txt` builders + the llms.txt grammar
 * validator (§3.4, §5 E2, §8.1). Both artifacts are size-capped by
 * construction (§1.4 principle 11): a build that would exceed either cap
 * throws rather than silently shipping an over-budget artifact.
 */
import { AGENT_NOTICE } from './markdown.ts';
import type { ModuleRecord } from './schema.ts';

export const LLMS_TXT_CAP_BYTES = 50 * 1024;
export const LLMS_FULL_TXT_CAP_BYTES = 1024 * 1024;

export interface DocEntry {
  title: string;
  url: string;
  description: string;
}

export interface BuildLlmsTxtOptions {
  siteUrl: string;
  modules: ModuleRecord[];
  /**
   * Documentation entries for the "## Docs" section. E2 owns no core-page
   * prose (index/install/agents -- E4), so this defaults to the machine
   * catalog surface E2 does own; E4 extends the list once page twins exist.
   */
  docs?: DocEntry[];
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf-8');
}

function assertCap(text: string, capBytes: number, artifactName: string): void {
  const size = byteLength(text);
  if (size >= capBytes) {
    throw new Error(
      `${artifactName} exceeds its ${capBytes}-byte cap (${size} bytes). Per §3.4/principle 11, ` +
        'the artifact must be re-sharded/re-bounded, never silently shipped oversized.',
    );
  }
}

export function defaultDocEntries(siteUrl: string): DocEntry[] {
  return [
    {
      title: 'Module catalog',
      url: `${siteUrl}/modules/index.md`,
      description: 'Every CCGM module, grouped by category, with install-cost and file inventory summaries.',
    },
    {
      title: 'Rules index',
      url: `${siteUrl}/rules/index.md`,
      description: 'Every always-loaded rule file across all modules, grouped by category, each linking its own twin.',
    },
  ];
}

/** `/llms.txt`: llmstxt.org-conformant index. Cap 50 KB (§3.4). */
export function buildLlmsTxt(options: BuildLlmsTxtOptions): string {
  const docs = options.docs ?? defaultDocEntries(options.siteUrl);
  const lines: string[] = [];

  lines.push('# CCGM');
  lines.push('');
  lines.push(
    '> A modular configuration system for Claude Code: opt-in rules, commands, hooks, skills, and agents, installed via a bash installer, an agent-paste prompt, or the native plugin marketplace.',
  );
  lines.push('');
  lines.push(AGENT_NOTICE);
  lines.push('');

  lines.push('## Docs');
  for (const doc of docs) {
    lines.push(`- [${doc.title}](${doc.url}): ${doc.description}`);
  }
  lines.push('');

  lines.push('## Modules');
  for (const mod of options.modules) {
    lines.push(`- [${mod.displayName}](${options.siteUrl}/modules/${mod.name}.md): ${mod.summary}`);
  }
  lines.push('');

  lines.push('## Optional');
  lines.push(
    `- [llms-full.txt](${options.siteUrl}/llms-full.txt): Bounded full-text companion -- every module's metadata and file manifest with per-file URLs, not full file bodies.`,
  );
  lines.push('');

  const content = lines.join('\n');
  assertCap(content, LLMS_TXT_CAP_BYTES, '/llms.txt');
  return content;
}

export interface BuildLlmsFullTxtOptions {
  siteUrl: string;
  modules: ModuleRecord[];
}

/** `/llms-full.txt`: bounded full-text companion. Per-module metadata + file manifest, never file bodies. Cap 1 MB (§3.4). */
export function buildLlmsFullTxt(options: BuildLlmsFullTxtOptions): string {
  const lines: string[] = [];

  lines.push('# CCGM -- Full Reference');
  lines.push('');
  lines.push(AGENT_NOTICE);
  lines.push(`See ${options.siteUrl}/llms.txt for the compact index.`);
  lines.push('');

  for (const mod of options.modules) {
    lines.push(`## ${mod.displayName} (${mod.name})`);
    lines.push('');
    lines.push(mod.description);
    lines.push('');
    lines.push(`- category: ${mod.category}`);
    lines.push(`- status: ${mod.status ?? 'stable'}`);
    lines.push(`- tags: ${mod.tags.length > 0 ? mod.tags.join(', ') : 'none'}`);
    lines.push(`- dependencies: ${mod.dependencies.length > 0 ? mod.dependencies.join(', ') : 'none'}`);
    lines.push(`- presets: ${mod.presets.length > 0 ? mod.presets.join(', ') : 'none'}`);
    lines.push(`- last updated: ${mod.lastUpdated ?? 'unknown'}`);
    lines.push(
      mod.contextCostTokens > 0
        ? `- context cost: ~${mod.contextCostTokens} tokens (always-loaded rule files)`
        : '- context cost: no always-loaded rules',
    );
    if (mod.postInstall) {
      lines.push(`- postInstall: ${mod.postInstall}${mod.postInstallFile ? ` (${mod.postInstallFile.rawUrl})` : ''}`);
    }
    lines.push(`- page: ${options.siteUrl}/modules/${mod.name}.md`);
    lines.push('- files:');
    for (const file of mod.files) {
      lines.push(`  - ${file.path} (${file.type}, ${file.bytes} bytes): ${options.siteUrl}${file.rawUrl}`);
    }
    lines.push('');
  }

  const content = lines.join('\n');
  assertCap(content, LLMS_FULL_TXT_CAP_BYTES, '/llms-full.txt');
  return content;
}

/**
 * Validate `/llms.txt` grammar: exactly one H1 reading "# CCGM", a
 * blockquote immediately following it, the three required H2 sections, and
 * every link absolute against `siteUrl`. Returns an empty array when valid.
 */
export function validateLlmsTxtGrammar(content: string, siteUrl: string): string[] {
  const violations: string[] = [];
  const lines = content.split('\n');

  const h1Indices = lines.reduce<number[]>((acc, line, i) => (/^# /.test(line) ? [...acc, i] : acc), []);
  if (h1Indices.length !== 1) {
    violations.push(`expected exactly one H1 line, found ${h1Indices.length}`);
  } else if (lines[h1Indices[0]] !== '# CCGM') {
    violations.push(`H1 must read "# CCGM", found "${lines[h1Indices[0]]}"`);
  } else if (h1Indices[0] !== 0) {
    violations.push('H1 must be the first line');
  }

  const blockquoteIndex = lines.findIndex((line) => line.startsWith('> '));
  if (blockquoteIndex === -1) {
    violations.push('missing a blockquote summary');
  } else if (h1Indices.length === 1 && blockquoteIndex <= h1Indices[0]) {
    violations.push('blockquote must follow the H1');
  }

  for (const section of ['## Docs', '## Modules', '## Optional']) {
    if (!lines.includes(section)) violations.push(`missing "${section}" section`);
  }

  const linkPattern = /\[([^\]]*)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(content)) !== null) {
    const [, , url] = match;
    if (!url.startsWith(siteUrl)) {
      violations.push(`link is not absolute against SITE_URL (${siteUrl}): ${url}`);
    }
  }

  // "- [displayName](url): summary" -- the summary (not the raw description,
  // which exceeds 120 chars for 74/78 modules today) must stay <= 120 chars.
  const moduleLinePattern = /^- \[[^\]]*\]\([^)]+\): (.+)$/;
  for (const line of lines) {
    const lineMatch = line.match(moduleLinePattern);
    if (lineMatch && lineMatch[1].length > 120) {
      violations.push(`module summary exceeds 120 chars (${lineMatch[1].length}): "${lineMatch[1]}"`);
    }
  }

  const size = byteLength(content);
  if (size >= LLMS_TXT_CAP_BYTES) {
    violations.push(`exceeds ${LLMS_TXT_CAP_BYTES}-byte cap: ${size} bytes`);
  }

  return violations;
}
