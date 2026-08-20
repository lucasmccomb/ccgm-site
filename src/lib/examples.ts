/**
 * Command examples (#23): the curated set of representative CCGM slash-command
 * sessions rendered by /examples and its .md twin.
 *
 * SOURCING IS THE POINT OF THIS FILE. Every rendered block declares where it
 * came from, and `tests/unit/examples.test.ts` re-derives that claim from the
 * ingested ccgm corpus rather than trusting it:
 *
 *  - `provenance: 'verbatim'` -- `text` must appear in one of the block's
 *    declared `sources` as a BYTE-EXACT, CONTIGUOUS RUN OF WHOLE LINES. Whole
 *    lines, not a bare substring: a fragment lifted out of the middle of a
 *    longer line reads on the page as "the doc shows this" when the doc does
 *    not. A single edited character in a quoted block fails the build's gate.
 *  - `provenance: 'illustrative'` -- the transcript is authored here. It cannot
 *    be line-checked, so it instead carries `anchors`: one entry per documented
 *    shape the transcript rests on. Each `anchor.text` must appear byte-for-byte
 *    in one of the block's declared sources (as a substring, because an anchor
 *    is by definition a fragment), and each `anchor.licenses` says in plain
 *    words what that anchor permits the transcript to claim.
 *
 * What that machinery does and does not prove: it proves every quoted block and
 * every anchor really is in the file it cites, and that an authored block is
 * labelled and carries at least one anchor. It cannot prove an authored block
 * shows nothing beyond what its anchors license -- an extra line whose shape no
 * anchor covers still passes. That last step is a reading, done at review time
 * against the anchor list the page prints. Cut a line rather than embellish it.
 *
 * Every `ExampleSource` names a module and a path that must be a DECLARED,
 * text-bearing file of that module in the ingested index. The page resolves
 * those at build time (see `resolveSource`), so a source that no longer exists
 * fails the build loudly instead of rendering a dead attribution.
 *
 * Facts about ccgm itself -- module display names, categories, raw-file URLs --
 * are never hand-authored here. They are read from `src/generated` at the call
 * site and passed through `resolveSource` (§1.4 principle 2).
 */
import type { ModulesIndex } from './schema.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A file in the ingested ccgm corpus that a block's content is traced to. */
export interface ExampleSource {
  /** ccgm module name, e.g. "commands-core". Must exist in the ingested index. */
  module: string;
  /** Path within that module, e.g. "commands/gs.md". Must be a declared file. */
  path: string;
}

/**
 * One documented shape an authored transcript rests on. `text` is a literal
 * fragment of a source file; `licenses` explains what the transcript is
 * therefore allowed to show.
 */
export interface TraceAnchor {
  text: string;
  licenses: string;
}

export type Provenance = 'verbatim' | 'illustrative';

/** The part of a rendered block that does not depend on its provenance. */
interface ExampleBlockBase {
  /** Unique across the whole page; becomes the <pre> element id. */
  id: string;
  /** Short label rendered above the block. */
  caption: string;
  text: string;
  /** At least one. Every source must resolve against the ingested index. */
  sources: ExampleSource[];
}

/** Quoted from a module file. Anchors are the illustrative-only mechanism. */
export type VerbatimBlock = ExampleBlockBase & { provenance: 'verbatim' };

/**
 * Authored for this page. `anchors` is a NON-EMPTY tuple on purpose: an
 * authored transcript with nothing behind it is an invented capability, so the
 * compiler refuses it rather than a test catching it after the fact.
 */
export type IllustrativeBlock = ExampleBlockBase & {
  provenance: 'illustrative';
  anchors: [TraceAnchor, ...TraceAnchor[]];
};

/**
 * One rendered <pre> on the examples page, with its provenance attached.
 *
 * A discriminated union, so the two illegal states -- an illustrative block
 * with no anchors, a verbatim block carrying anchors -- are unrepresentable
 * rather than policed at runtime. Consumers narrow on `provenance` alone.
 */
export type ExampleBlock = VerbatimBlock | IllustrativeBlock;

export interface CommandExample {
  /** Unique slug; becomes the section's heading id. */
  id: string;
  /** The slash command itself, e.g. "/gs". */
  command: string;
  /** ccgm module the command ships in. */
  module: string;
  /** One line: what the command is for. */
  summary: string;
  /** "What happens" -- one paragraph per entry. */
  whatHappens: string[];
  blocks: ExampleBlock[];
}

// ---------------------------------------------------------------------------
// Page prose
// ---------------------------------------------------------------------------

export const EXAMPLES_TITLE = 'Examples -- CCGM';

export const EXAMPLES_HEADING = 'Command examples';

export const EXAMPLES_DESCRIPTION =
  'Representative CCGM slash-command sessions: what you type, what the command does, and what it prints -- each block traced to the module file it came from.';

export const EXAMPLES_INTRO =
  'CCGM ships slash commands as Markdown files inside modules. Each example below shows one command, what it does, and the output it produces. Every block names the module file it comes from, and every attribution links straight to that file so you can check it.';

export const SOURCING_HEADING = 'How to read the provenance labels';

/** Rendered as the description of each provenance value, on the page and in the twin. */
export const PROVENANCE_EXPLAINER: Record<Provenance, string> = {
  verbatim:
    'Quoted byte-for-byte from the module file named beneath it. A unit test re-checks each quoted block against the ingested file on every build, so a block that drifts from its source fails the build.',
  illustrative:
    'Written for this page, not captured from a real run. Sample values (paths, branch names, counts) are made up; every line shape is traced to a documented output string in the files named beneath it, listed line by line. Nothing here claims a flag, step, or output the module does not document.',
};

/** Short badge text per provenance, used on the page and in the twin. */
export const PROVENANCE_LABEL: Record<Provenance, string> = {
  verbatim: 'Verbatim from the module docs',
  illustrative: 'Illustrative -- authored for this page',
};

export const ANCHORS_HEADING = 'What each line rests on';

export const SOURCE_LABEL = 'Source';

export const NO_INVENTED_OUTPUT_NOTE =
  'No example on this page shows a flag, a step, or an output line that its module does not document. Where a real run would print data we do not have, the block is labelled illustrative and every line of it is anchored to a documented output string, listed under the block.';

// ---------------------------------------------------------------------------
// The examples
// ---------------------------------------------------------------------------

export const COMMAND_EXAMPLES: CommandExample[] = [
  {
    id: 'gs',
    command: '/gs',
    module: 'commands-core',
    summary: 'One screen of repository state: branch, sync, recent commits, open PRs, and what to do next.',
    whatHappens: [
      'The command hands its whole workflow to a sub-agent on a cheaper model, which runs a single gather script that emits structured "=== SECTION ===" blocks, then formats those blocks into the dashboard below. Sections with no data are omitted rather than printed empty.',
      'The last line is a suggestion, picked from a table in the command doc that maps repository state to a next step -- uncommitted changes on a feature branch suggests /commit, committed changes with no PR suggests /pr.',
    ],
    blocks: [
      {
        id: 'gs-invocation',
        caption: 'Invocation',
        // Not verbatim: gs.md names the command in its H1 and inside a script
        // path, but never shows the bare invocation as a line of its own. A
        // three-character fragment of a heading cannot carry "quoted from the
        // module file", so this block is anchored instead -- same treatment
        // /pressure-test's invocation gets.
        provenance: 'illustrative',
        text: '/gs',
        sources: [{ module: 'commands-core', path: 'commands/gs.md' }],
        anchors: [
          {
            text: '# /gs - Git Status Dashboard',
            licenses: 'The command name, which the doc carries in its heading rather than as a written-out invocation line.',
          },
        ],
      },
      {
        id: 'gs-output',
        caption: 'The dashboard it prints',
        provenance: 'verbatim',
        text: `Repository: {name from REPO section}
Branch: {branch} -> {upstream}
Status: {clean / N files changed based on STATUS section}

Sync:
  Main: {ahead_behind from SYNC main: line - format as "N ahead, N behind"}
  Remote: {ahead_behind from SYNC upstream: line - format as "N unpushed, N to pull"}

Recent Commits:
  {LOG section content}

Open PRs:
  {PRS section content, highlight any from current branch}

Sibling Sessions (same repo):
  {SESSIONS content, or omit if empty}

Changes:
  {DIFF section content - summarize staged/unstaged/untracked}

Suggested: {recommended next action per table below}`,
        sources: [{ module: 'commands-core', path: 'commands/gs.md' }],
      },
    ],
  },

  {
    id: 'ship-ready',
    command: '/ship-ready',
    module: 'ship-readiness',
    summary: 'A read-only pre-merge dashboard: what is blocking this branch, in one screen.',
    whatHappens: [
      'Sections print in a fixed order: branch context, failing tests, open PRs, stale branches, outdated dependencies, merge velocity, review freshness, and unresolved risks pulled from prior learnings. The command never runs tests, linters, or installers; where a signal needs a running process it reports the last known result and how to refresh it.',
      'Review freshness is the section that sets this apart from a generic status read-out. It reads the JSON envelopes /ce-review leaves in .context/ce-review/, resolves the commit each review ran against, and counts the commits that have landed since -- so a review that has gone stale is visible as staleness rather than as a green tick.',
      'A single gate line closes the dashboard. Only a failing CI run, a P0 finding in the latest review, or a branch behind its base count as hard blockers; stale reviews and outdated dependencies are informational.',
    ],
    blocks: [
      {
        id: 'ship-ready-usage',
        caption: 'Usage',
        provenance: 'verbatim',
        text: `/ship-ready                   # Dashboard for the current branch
/ship-ready base:origin/main  # Override the base ref for diffs and review lookup (default: origin/main)
/ship-ready mode:strict       # Exit non-zero if any gate is red; for CI or for blocking /cpm`,
        sources: [{ module: 'ship-readiness', path: 'commands/ship-ready.md' }],
      },
      {
        id: 'ship-ready-branch',
        caption: 'Section 1 of the dashboard: branch context',
        provenance: 'verbatim',
        text: `Branch: {branch}  @  {head_sha}
Base:   {base_ref}  (ahead: {ahead}, behind: {behind})
Files changed on branch: {diff_files}`,
        sources: [{ module: 'ship-readiness', path: 'commands/ship-ready.md' }],
      },
      {
        id: 'ship-ready-reviews',
        caption: 'Section 7: review freshness',
        provenance: 'verbatim',
        text: `Reviews vs {base_ref}:
  /ce-review  ran {relative-age}  on {head_sha_short}
              commits since review: {N}  ({STATUS})
              findings: P0:{n}  P1:{n}  P2:{n}  P3:{n}
              auto-fixed: {n}   needs input: {n}   red-team: {n}`,
        sources: [{ module: 'ship-readiness', path: 'commands/ship-ready.md' }],
      },
      {
        id: 'ship-ready-gate',
        caption: 'The gate line, printed last',
        provenance: 'verbatim',
        text: 'GATE: {STATUS}   ({reason})',
        sources: [{ module: 'ship-readiness', path: 'commands/ship-ready.md' }],
      },
    ],
  },

  {
    id: 'retro',
    command: '/retro',
    module: 'self-improving',
    summary: 'A retrospective built from git history over a window, not from one session\'s memory.',
    whatHappens: [
      'The window is resolved to an absolute date anchored at local midnight before any git query runs, so "last 7 days" means the same thing at 9am and at 11pm. The command then walks the log for commit counts, per-author line counts, hotspot files, a test-to-prod ratio, referenced issue numbers, and session boundaries inferred from gaps between commits.',
      'The result is a short note, not a data dump. If any pattern looks like a reusable learning, the command offers to capture it through /reflect -- it never writes to the learnings store itself.',
    ],
    blocks: [
      {
        id: 'retro-usage',
        caption: 'Usage',
        provenance: 'verbatim',
        text: `/retro                     # Last 7 days, this repo
/retro [N]d                # Last N days (e.g. /retro 14d)
/retro [YYYY-MM-DD]        # From that date through today
/retro global              # Aggregate across ALL repos under the code directory
/retro global [window]     # Global + windowed`,
        sources: [{ module: 'self-improving', path: 'commands/retro.md' }],
      },
      {
        id: 'retro-output',
        caption: 'The retro it renders',
        provenance: 'verbatim',
        text: `# Retro: {REPO_NAME}  ({SINCE} - today)

**Sessions**: {N}   **Commits**: {N}   **PRs referenced**: #{a}, #{b}, ...

## Shipped

- {merged PRs / closed issues, 1 line each}

## Hotspots

- {path}  ({N} changes)  - {one-line observation}
- ...

## Per-author activity

| Author | Commits | LOC (+/-) | Files |
|--------|---------|-----------|-------|
| ...

## Patterns worth noting

- {any 3+ time topic, or test-ratio flag, or repeated-attempt pattern}

## Context from notes

{If ~/.claude/retro-context.md exists, 3-5 line summary of relevant bits.}

## Suggested follow-ups

- {1-3 concrete actions the user could take next - an issue to open, a
  refactor to plan, a pattern to capture via /reflect}`,
        sources: [{ module: 'self-improving', path: 'commands/retro.md' }],
      },
    ],
  },

  {
    id: 'worktree-sweep',
    command: '/worktree-sweep',
    module: 'git-worktrees',
    summary: 'Remove the worktrees a parallel agent run left behind, and preserve every one with unsaved work.',
    whatHappens: [
      'The command runs an installed shell script that walks every worktree of the current repository and classifies each one. Anything with uncommitted tracked changes, untracked non-ignored files, a paused rebase or merge, a lock, or a detached HEAD carrying commits no ref reaches is preserved. Clean worktrees in the managed directories are removed with a non-force git worktree remove, which is itself the last safety gate: git refuses the removal if the classification missed something.',
      'A removed worktree never costs you commits -- they survive on the branch ref. The script deletes a branch only after verifying the default branch already contains its work, either as an ancestor or as a patch-equivalent squash merge; a branch that passes neither test is kept, and the report prints the git worktree add line that restores its checkout.',
      '--dry-run classifies and reports without changing anything.',
    ],
    blocks: [
      {
        id: 'worktree-sweep-usage',
        caption: 'Usage',
        provenance: 'verbatim',
        text: `/worktree-sweep [--dry-run] [--conservative] [--all]
                [--worktree <path>] [--keep-branches] [--merged-branches]`,
        sources: [{ module: 'git-worktrees', path: 'commands/worktree-sweep.md' }],
      },
      {
        id: 'worktree-sweep-output',
        caption: 'A --dry-run over three worktrees',
        provenance: 'illustrative',
        text: `=== worktree-sweep (DRY RUN - nothing removed) ===
default branch: origin/main

REMOVED (2, ~18 MB reclaimed):
  - /Users/dev/code/acme/.claude/worktrees/fix-471  [fix/471-null-session] -> WOULD REMOVE, ~12 MB (branch fix/471-null-session WOULD BE DELETED: already on origin/main)
  - /Users/dev/code/acme/.claude/worktrees/docs-api  [docs/api-reference] -> WOULD REMOVE, ~6 MB (branch docs/api-reference KEPT: work not on origin/main - nothing discarded; restore with 'git worktree add /Users/dev/code/acme/.claude/worktrees/docs-api docs/api-reference')

PRESERVED (1, unsaved work / in-progress / locked):
  - /Users/dev/code/acme/.claude/worktrees/feat-auth  [feature/auth-refresh] -> PRESERVE (uncommitted or untracked changes)

Done. 2 removed, 1 preserved, 0 skipped, 1 branch(es) deleted.`,
        sources: [
          { module: 'git-worktrees', path: 'lib/worktree-sweep.sh' },
          { module: 'git-worktrees', path: 'commands/worktree-sweep.md' },
        ],
        anchors: [
          {
            text: 'echo "=== worktree-sweep (DRY RUN - nothing removed) ==="',
            licenses: 'The banner line, printed instead of the plain one whenever --dry-run is passed.',
          },
          {
            text: 'echo "default branch: $DEFAULT_REF"',
            licenses: 'The "default branch: origin/main" line under the banner.',
          },
          {
            text: 'echo "REMOVED ($REMOVED, ~$((RECLAIMED_KB/1024)) MB reclaimed):"',
            licenses: 'The REMOVED section header, its count, and the reclaimed-megabyte total.',
          },
          {
            text: '  - $label -> WOULD REMOVE, ~$((kb/1024)) MB${BRANCH_NOTE}',
            licenses: 'Each removal line under --dry-run: two-space indent, the label, the arrow, the size, then the branch note.',
          },
          {
            text: 'label="$label  [$CUR_BRANCH]"',
            licenses: 'The "<path>  [<branch>]" label shape, with two spaces before the bracket.',
          },
          {
            text: 'BRANCH_NOTE=" (branch $b WOULD BE DELETED: already on $DEFAULT_REF)"',
            licenses: 'The note on fix/471-null-session, whose work the default branch already contains.',
          },
          {
            text: 'BRANCH_NOTE=" (branch $b KEPT: work not on ${DEFAULT_REF:-<unknown default>} - nothing discarded)"',
            licenses: 'The note on docs/api-reference, whose work is not on the default branch and so is kept.',
          },
          {
            text: "BRANCH_NOTE=\"${BRANCH_NOTE%)}; restore with 'git worktree add $1 $CUR_BRANCH')\"",
            licenses: 'The restore hint appended inside that note, before its closing parenthesis.',
          },
          {
            text: 'echo "PRESERVED ($PRESERVED, unsaved work / in-progress / locked):"',
            licenses: 'The PRESERVED section header and its parenthetical.',
          },
          {
            text: '  - $label -> PRESERVE (uncommitted or untracked changes)',
            licenses: 'The preserve line for feat-auth, the dirty worktree.',
          },
          {
            text: 'echo "Done. $REMOVED removed, $PRESERVED preserved, $SKIPPED skipped, $BRANCHES_DELETED branch(es) deleted."',
            licenses: 'The closing tally line and its exact wording, including "branch(es)".',
          },
          {
            text: '*/.claude/worktrees/*|*/.worktrees/*) return 0 ;;',
            licenses: 'The .claude/worktrees/ paths in the sample: only these two locations are swept without --all.',
          },
        ],
      },
    ],
  },

  {
    id: 'recall',
    command: '/recall',
    module: 'session-history',
    summary: 'Search Claude Code session history across every clone of a repository.',
    whatHappens: [
      'The command runs a Python script that reads Claude Code\'s own JSONL transcripts directly. There is no separate index or database -- the transcripts are the source of truth, read on demand. Sessions from every clone of the repository are unified into one list, matched by the canonical repository name plus a known clone suffix.',
      'With no query it prints a summary of the last seven days: one line per session, most recent first. With a query it prints the matching turns instead, filtered by a case-insensitive regular expression.',
    ],
    blocks: [
      {
        id: 'recall-usage',
        caption: 'Examples',
        provenance: 'verbatim',
        text: `/recall                       # What have I been doing in this repo this week?
/recall migration             # What did I try with that migration?
/recall --days 30 auth        # Broader lookback on auth work
/recall --repo other-repo     # Switch to another repo's sessions
/recall --session 65b57a04    # Read a specific session`,
        sources: [{ module: 'session-history', path: 'commands/recall.md' }],
      },
      {
        id: 'recall-output',
        caption: 'Summary output for a bare /recall',
        provenance: 'illustrative',
        text: `Recent activity: acme (last 7 days, 3 clones, 5 sessions) — summary
2026-08-19  acme-w0-c1      65b57a04   42 turns  rebase the auth branch and rerun the migration
2026-08-19  acme-w0-c0      7f0c1d33   18 turns  why does /ship-ready say the review is stale?
2026-08-18  acme-w0-c2      a91e4b6d    9 turns  add the 375px viewport case to the theme suite
2026-08-17  acme-w0-c1      1c8d0e52   77 turns  port the ingest script off the old schema
2026-08-15  acme-w0-c0      3b2a9f70    5 turns  quick look at the failing headers test`,
        sources: [
          { module: 'session-history', path: 'scripts/recall.py' },
          { module: 'session-history', path: 'scripts/repo_detect.py' },
        ],
        anchors: [
          {
            text: 'print(f"Recent activity: {repo} (last {days} days{suffix}, {count} sessions) — {mode}")',
            licenses: 'The header line, including the em dash before the mode name.',
          },
          {
            text: 'suffix = f", {len(clones)} clones" if len(clones) > 1 else ""',
            licenses: 'The ", 3 clones" fragment, which only appears when more than one clone contributed sessions.',
          },
          {
            text: 'mode = "summary"',
            licenses: 'The word "summary" as the mode, which is what a bare /recall selects.',
          },
          {
            text: 'DEFAULT_DAYS = 7',
            licenses: 'The "last 7 days" window in the header when no --days is passed.',
          },
          {
            text: 'f"{_fmt_date(s.mtime)}  {s.clone:<14}  {s.session_id[:8]}  "',
            licenses: 'The first half of each row: date, two spaces, clone padded to 14 columns, two spaces, an 8-character session id.',
          },
          {
            text: 'f"{s.turn_count:>3} turns  {_truncate(s.last_user_msg, 60)}"',
            licenses: 'The second half of each row: the turn count right-aligned in 3 columns, the word "turns", then the last user message capped at 60 characters.',
          },
          {
            text: 'return time.strftime("%Y-%m-%d", time.localtime(mtime))',
            licenses: 'The YYYY-MM-DD date format in the first column.',
          },
          {
            text: 'sessions.sort(key=lambda s: s.mtime, reverse=True)',
            licenses: 'Most-recent-first ordering of the rows.',
          },
          {
            text: "repo='ccgm', -home-alice-code-ccgm-workspaces-ccgm-w0-c2      → 'ccgm-w0-c2'",
            licenses: 'The "acme-w0-c1" clone-label shape: the repository name plus its workspace and clone numbers.',
          },
        ],
      },
    ],
  },

  {
    id: 'pressure-test',
    command: '/pressure-test',
    module: 'rule-authoring',
    summary: 'Attack a candidate rule with adversarial scenarios, then harden it with what got through.',
    whatHappens: [
      'The command reads a rule file, pulls out its Iron Law, and generates five to seven adversarial scenarios that each combine three or more pressure vectors. It dispatches sub-agents against those scenarios twice -- once without the rule loaded to establish a baseline, once with it -- and records where the rule held and where an agent talked its way past it.',
      'The rationalizations it captures are added to the rule\'s Rationalizations Table and the red flags to its Red Flags list. The run then re-tests against fresh scenarios to check the hardening held, and the report closes on one of three recommendations: ship as-is, iterate further, or sharpen the Iron Law.',
    ],
    blocks: [
      {
        id: 'pressure-test-invocation',
        caption: 'Invocation',
        provenance: 'illustrative',
        text: '/pressure-test modules/verification/rules/verification.md',
        sources: [{ module: 'rule-authoring', path: 'commands/pressure-test.md' }],
        anchors: [
          {
            text: '# /pressure-test - Pressure-Test a Candidate Rule',
            licenses: 'The command name.',
          },
          {
            text: 'argument-hint: <path-to-rule-file-or-draft>',
            licenses: 'That the single argument is a path to a rule file.',
          },
          {
            text: '`modules/verification/rules/verification.md`',
            licenses: 'The specific path shown, which the command doc itself offers as the example path to pass.',
          },
        ],
      },
      {
        id: 'pressure-test-output',
        caption: 'The report it produces',
        provenance: 'verbatim',
        text: `## Pressure-Test Report: {rule-name}

**Rule file:** {path}
**Iron Law:** {extracted Iron Law}

### Baseline (RED) compliance: {N/total}
### After rule loaded (GREEN) compliance: {N/total}
### After hardening (adversarial GREEN) compliance: {N/total}

### Scenarios run
1. {scenario-title} - RED: BYPASS, GREEN: COMPLY
2. {scenario-title} - RED: BYPASS, GREEN: BYPASS (loophole identified, added)
...

### Rationalizations captured (added to table)
- "It's a trivial test case..." -> "Follow-up PR is how untested code becomes permanent..."
- ...

### Red Flags captured (added to list)
- "It's just a trivial case"
- ...

### Outstanding concerns
{any scenarios where the rule still fails, or any DONE_WITH_CONCERNS the agent raised}

### Recommendation
{one of: ship as-is | iterate further | Iron Law needs sharpening}`,
        sources: [{ module: 'rule-authoring', path: 'commands/pressure-test.md' }],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Resolution against the ingested corpus
// ---------------------------------------------------------------------------

/** An `ExampleSource` resolved against the ingested index, ready to render. */
export interface ResolvedSource extends ExampleSource {
  /** The module's human-readable name, e.g. "Core Commands". */
  displayName: string;
  /** The module's ccgm category, e.g. "commands". */
  category: string;
  /** This site's own raw-text endpoint for the file, from the ingested record. */
  rawUrl: string;
  /** The module's detail page on this site. */
  modulePath: string;
}

/**
 * Resolve one declared source against the ingested index. Throws when the
 * module or the file is missing, so a stale attribution fails the build rather
 * than rendering a link to nothing (§1.4 principle 2/13).
 */
export function resolveSource(index: ModulesIndex, source: ExampleSource): ResolvedSource {
  const mod = index.modules.find((candidate) => candidate.name === source.module);
  if (!mod) {
    throw new Error(
      `examples.ts: source module "${source.module}" is not in the ingested index. ` +
        'Every example source must name a real ccgm module.',
    );
  }

  const file = mod.files.find((candidate) => candidate.path === source.path);
  if (!file) {
    throw new Error(
      `examples.ts: "${source.path}" is not a declared file of module "${source.module}". ` +
        'Every example source must name a file that module.json actually declares.',
    );
  }

  return {
    ...source,
    displayName: mod.displayName,
    category: mod.category,
    rawUrl: file.rawUrl,
    modulePath: `/modules/${mod.name}`,
  };
}

/** Every block on the page, flattened -- the unit test's and the twin's entry point. */
export function allBlocks(examples: CommandExample[] = COMMAND_EXAMPLES): ExampleBlock[] {
  return examples.flatMap((example) => example.blocks);
}

/**
 * THE VERBATIM CONTRACT, as a function: true when `needle` occurs in `haystack`
 * as a byte-exact, contiguous run of WHOLE lines.
 *
 * Whole lines, not a bare substring. A block labelled "quoted byte-for-byte
 * from the module file" that is really backed by a fragment from the middle of
 * a longer line -- three characters lifted out of a heading, say -- reads on the
 * page as "the doc shows this line" when the doc does not.
 *
 * It lives here, beside the type it defines, because BOTH gates that enforce it
 * call it: the unit suite against the ingested corpus, and the e2e suite against
 * the served raw endpoints. One implementation, so the two doors cannot drift
 * into asserting different contracts.
 */
export function containsWholeLineRun(haystack: string, needle: string): boolean {
  const lines = haystack.split('\n');
  const needleLines = needle.split('\n');

  for (let i = 0; i + needleLines.length <= lines.length; i++) {
    if (lines.slice(i, i + needleLines.length).join('\n') === needle) return true;
  }
  return false;
}

/** Count of blocks by provenance, rendered as the page's own honesty tally. */
export function provenanceCounts(examples: CommandExample[] = COMMAND_EXAMPLES): Record<Provenance, number> {
  const counts: Record<Provenance, number> = { verbatim: 0, illustrative: 0 };
  for (const block of allBlocks(examples)) {
    counts[block.provenance] += 1;
  }
  return counts;
}

/** The tally sentence, built from the data rather than hand-counted. */
export function provenanceTallyLine(examples: CommandExample[] = COMMAND_EXAMPLES): string {
  const counts = provenanceCounts(examples);
  const total = counts.verbatim + counts.illustrative;
  return `${examples.length} commands, ${total} blocks: ${counts.verbatim} quoted verbatim from module docs, ${counts.illustrative} authored and labelled illustrative.`;
}
