/**
 * System diagrams (#24): the geometry, a11y text, prose fallback, and
 * traceability refs for every diagram the site draws.
 *
 * Three rules this file exists to hold:
 *
 *  1. **Nothing aspirational.** Every node, caption, and legend entry names
 *     a real file, script, hook, or mechanism in `lucasmccomb/ccgm`. A box
 *     that cannot be pointed at a path does not ship.
 *  2. **Data, not markup.** The specs below are pure data so the same
 *     source drives the HTML page and its `.md` twin (§1.4 principle 3
 *     parity). `Diagram.astro` is the only renderer.
 *  3. **No colour of its own.** Geometry lives here; every stroke and fill
 *     is a CSS class resolved against the active theme's tokens, so a
 *     diagram is a quiet line drawing under `mono` and still correct under
 *     `ascii`/`minimal`/`serif`.
 *
 * Coordinates are viewBox units. `Diagram.astro` renders each SVG at its
 * natural width inside an `overflow-x` container, so text stays legible at
 * 375px instead of scaling into illegibility.
 */

const CCGM_REPO_URL = 'https://github.com/lucasmccomb/ccgm';

// ---------------------------------------------------------------------------
// Page-level prose. Single-sourced here for the same reason pagecopy.ts and
// modulepagecopy.ts exist: the `.astro` page and its `.md` twin must read
// the same strings, never two hand-kept copies (§1.4 principle 3).
// ---------------------------------------------------------------------------

export const DIAGRAMS_TITLE = 'Diagrams -- CCGM';
export const DIAGRAMS_HEADING = 'System diagrams';
export const DIAGRAMS_DESCRIPTION =
  "Maps of CCGM's real systems: the install flow, module anatomy, the hook gate pipeline, the multi-agent worktree lifecycle, and the memory and learnings loop.";
export const DIAGRAMS_INTRO =
  'Five maps of how CCGM actually works. Every box names a file, script, hook, or mechanism that exists in the repo, and every diagram lists what it was drawn from.';
export const DIAGRAMS_TRACEABILITY_LABEL = 'Drawn from';
export const DIAGRAMS_TRACEABILITY_NOTE =
  'Links resolve to this site where the file is part of an ingested module, and to a SHA-pinned GitHub blob otherwise.';

/**
 * Type scale. `Diagram.astro` emits LABEL_FONT_SIZE / META_FONT_SIZE as
 * `font-size` presentation attributes and `tests/unit/diagrams.test.ts`
 * measures against the same two constants, so the size the fit invariant
 * checks is the size that renders. LINE_HEIGHT and BASELINE_OFFSET are the
 * renderer's own text-block layout; the test reads LINE_HEIGHT too, for the
 * vertical-fit assertion.
 */
export const LABEL_FONT_SIZE = 12;
export const META_FONT_SIZE = 10;
export const LINE_HEIGHT = 12;
/** Baseline offset from the top of a text block's first line. */
export const BASELINE_OFFSET = 9.5;
/** Horizontal breathing room a node reserves inside its own box. */
export const NODE_PADDING_X = 16;

const MONO_ADVANCE = 0.6;
const SANS_ADVANCE = 0.56;

/**
 * The widest per-character advance any theme puts a diagram label in.
 * `ascii` sets `--font-body` to JetBrains Mono (src/styles/themes/ascii.css),
 * so a "body face" label there renders at the mono advance, not the sans one
 * -- roughly 7% wider. Measuring labels at this value keeps the fit check
 * honest for every theme rather than only the three with a proportional face.
 */
export const WIDEST_ADVANCE = MONO_ADVANCE;

/**
 * Deterministic width estimate for a run of text, in viewBox units.
 * Coarse on purpose. An average advance is not a true upper bound for a
 * proportional face, so treat this as a deliberately generous estimate that
 * the "no label overflows its own box" invariant is asserted against -- not
 * as a guarantee about glyph metrics.
 */
export function estimateTextWidth(text: string, fontSize: number, mono: boolean): number {
  return text.length * fontSize * (mono ? MONO_ADVANCE : SANS_ADVANCE);
}

/** Gap left between a node's edge and an incoming arrowhead's tip. */
export const ARROW_GAP = 2;

/**
 * A straight vertical connector from the bottom of `from` to the top of
 * `to`, at x. Most edges in these diagrams are exactly this, and hand-typing
 * the pair means re-deriving both endpoints whenever a node moves.
 */
export function vEdge(x: number, from: DiagramNode, to: DiagramNode): DiagramEdge {
  return { points: [[x, from.y + from.h], [x, to.y - ARROW_GAP]] };
}

/**
 * `box` -- an outlined stage. `soft` -- a filled destination.
 * `group` -- a dashed container or an in-repo-only artifact.
 */
export type NodeKind = 'box' | 'soft' | 'group';

export interface DiagramNode {
  x: number;
  y: number;
  w: number;
  h: number;
  kind?: NodeKind;
  /** Human phrase, rendered in the theme's body face. */
  label?: string;
  /** Real paths / flags / identifiers, rendered in the theme's mono face. */
  sub?: string[];
}

export interface DiagramEdge {
  /** Polyline in viewBox units; an arrowhead is drawn at the last point. */
  points: [number, number][];
  dashed?: boolean;
}

export interface DiagramCaption {
  x: number;
  y: number;
  text: string;
  anchor?: 'start' | 'middle' | 'end';
}

/** One traceability entry: a real ccgm repo path plus the role it plays here. */
export interface DiagramRef {
  /** Repo-relative path inside lucasmccomb/ccgm, e.g. `lib/merge.sh`. */
  path: string;
  /** What this file does in this diagram. */
  role: string;
}

export interface DiagramSpec {
  /** Unique, URL-safe; ids inside the SVG are derived from it. */
  id: string;
  /** The `<h2>` above the figure. */
  heading: string;
  /** The SVG's accessible name (`<title>`). */
  title: string;
  /** What the drawing looks like -- the SVG's `<desc>`. */
  desc: string;
  /** The claim the diagram makes, rendered as visible prose above the figure. */
  summary: string;
  /** The image-free fallback: the same flow as an ordered list. */
  steps: string[];
  width: number;
  height: number;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  captions?: DiagramCaption[];
  refs: DiagramRef[];
}

// ---------------------------------------------------------------------------
// 1. Install flow -- start.sh to ~/.claude
// ---------------------------------------------------------------------------

/**
 * Nodes are named consts, not anonymous array entries, so `vEdge()` can
 * derive each connector from the boxes it joins. Moving a stage then means
 * editing one `y` instead of re-deriving both endpoints of every edge that
 * touched it.
 */
const installNodes = {
  start: { x: 110, y: 12, w: 340, h: 40, label: './start.sh', sub: ['--preset · --link · --scope · --add'] },
  resolve: {
    x: 110,
    y: 72,
    w: 340,
    h: 40,
    label: 'Resolve modules and dependencies',
    sub: ['presets/*.json · lib/modules.sh'],
  },
  backup: {
    x: 110,
    y: 132,
    w: 340,
    h: 40,
    label: 'Back up what is already there',
    sub: ['lib/backup.sh → ~/.claude/backups/'],
  },
  prune: { x: 110, y: 192, w: 340, h: 40, label: 'Prune stale symlinks', sub: ['lib/repair.sh'] },
  plan: {
    x: 110,
    y: 252,
    w: 340,
    h: 52,
    label: 'Install plan: copy · link · merge',
    sub: ['lib/template.sh expands __PLACEHOLDER__', 'lib/merge.sh folds settings.partial.json'],
  },
  verify: {
    x: 110,
    y: 324,
    w: 340,
    h: 40,
    label: 'Write the manifest, then verify',
    sub: ['.ccgm-manifest.json · placeholder check'],
  },
  target: { x: 40, y: 396, w: 480, h: 104, kind: 'group' },
  targetDirs: { x: 56, y: 426, w: 200, h: 30, kind: 'soft', sub: ['rules/ commands/ hooks/'] },
  targetLibs: { x: 304, y: 426, w: 200, h: 30, kind: 'soft', sub: ['lib/ scripts/ agents/ skills/'] },
  targetFiles: {
    x: 56,
    y: 464,
    w: 448,
    h: 30,
    kind: 'soft',
    sub: ['settings.json · .ccgm.env · .ccgm-manifest.json'],
  },
} satisfies Record<string, DiagramNode>;

const installFlow: DiagramSpec = {
  id: 'install-flow',
  heading: 'Install flow',
  title: 'How start.sh turns a cloned ccgm repo into a configured ~/.claude',
  desc: 'A single vertical pipeline of six stages, each labelled with the shell library that performs it, feeding a dashed box that stands for the ~/.claude install target.',
  summary:
    'One bash entry point walks a fixed sequence: resolve, back up, prune, install, merge, verify. Every stage below is a numbered step in start.sh and a named library under lib/.',
  steps: [
    'start.sh parses --preset, --link, --scope, and --add, then checks prerequisites (git, jq, python3).',
    'lib/modules.sh discovers every modules/*/module.json and closes the dependency set; a preset is just a bare array of module names in presets/*.json.',
    'lib/backup.sh snapshots whatever already lives at the target paths into ~/.claude/backups/ before anything is written.',
    'lib/repair.sh removes symlinks left dangling by an earlier install, because ln -s refuses to overwrite one.',
    'Each files{} entry becomes one install-plan action: copy, link (under --link), or merge. lib/template.sh expands __PLACEHOLDER__ values from .ccgm.env into template:true targets.',
    'lib/merge.sh deep-merges every settings.partial.json into settings.json with jq -- permissions.allow/deny concatenate and dedupe, hooks combine by event type.',
    'start.sh writes .ccgm-manifest.json, then verifies: every installed file exists, no __PLACEHOLDER__ survived in a template target, and settings.json still parses.',
  ],
  width: 560,
  height: 512,
  nodes: Object.values(installNodes),
  edges: [
    vEdge(280, installNodes.start, installNodes.resolve),
    vEdge(280, installNodes.resolve, installNodes.backup),
    vEdge(280, installNodes.backup, installNodes.prune),
    vEdge(280, installNodes.prune, installNodes.plan),
    vEdge(280, installNodes.plan, installNodes.verify),
    vEdge(280, installNodes.verify, installNodes.target),
  ],
  captions: [{ x: 52, y: 416, text: '~/.claude/', anchor: 'start' }],
  refs: [
    { path: 'start.sh', role: 'The installer itself: 15 numbered steps from prerequisites to the final verify.' },
    { path: 'lib/modules.sh', role: 'discover_modules(), validate_module(), resolve_dependencies(), load_preset().' },
    { path: 'lib/backup.sh', role: 'create_backup() snapshots the managed paths under ~/.claude/backups/.' },
    { path: 'lib/repair.sh', role: 'repair_dangling_symlinks() clears links a rename left pointing nowhere.' },
    { path: 'lib/template.sh', role: 'expand_templates() substitutes __PLACEHOLDER__ from .ccgm.env.' },
    { path: 'lib/merge.sh', role: 'merge_settings() deep-merges a settings fragment into settings.json via jq.' },
    { path: 'presets/standard.json', role: 'A preset is a bare JSON array of module names -- no wrapper object.' },
  ],
};

// ---------------------------------------------------------------------------
// 2. Module anatomy -- module.json and where its files land
// ---------------------------------------------------------------------------

const moduleAnatomy: DiagramSpec = {
  id: 'module-anatomy',
  heading: 'Module anatomy',
  title: 'What a ccgm module directory holds and where each file installs',
  desc: 'Two dashed columns. On the left, one module directory with its manifest above the file groups it declares. On the right, the matching directories under ~/.claude, joined by five arrows.',
  summary:
    'A module is a directory with a manifest. module.json is the only thing that decides what installs and where -- the directory layout is a convention, files{} is the contract.',
  steps: [
    'module.json carries name, displayName, description, category, scope, dependencies[], tags[], configPrompts[], and files{}.',
    'files{} is a keyed object, not an array: each key is a source path inside the module, and its value names the target, the type, whether it is a template, and whether it merges.',
    'rules/*.md install to ~/.claude/rules/ -- these are the always-loaded instruction files a module contributes.',
    'commands/*.md and agents/*.md become slash commands and subagent prompts under ~/.claude/commands/ and ~/.claude/agents/.',
    'hooks/*.py, lib/*.py, and bin/* install to the matching ~/.claude directories; hooks are what settings.json points its event registrations at.',
    'settings.partial.json is never copied. It carries merge: true, so lib/merge.sh folds it into ~/.claude/settings.json instead of overwriting it.',
    'Anything not named in files{} -- README.md, tests/ -- stays in the repo and never reaches ~/.claude.',
  ],
  width: 560,
  height: 372,
  nodes: [
    { x: 16, y: 26, w: 248, h: 316, kind: 'group' },
    {
      x: 28,
      y: 38,
      w: 224,
      h: 74,
      label: 'module.json',
      sub: ['name · category · scope', 'dependencies[] · tags[]', 'files{} · configPrompts[]'],
    },
    { x: 28, y: 124, w: 224, h: 28, sub: ['rules/*.md'] },
    { x: 28, y: 162, w: 224, h: 28, sub: ['commands/*.md · agents/*.md'] },
    { x: 28, y: 200, w: 224, h: 28, sub: ['hooks/*.py · lib/*.py · bin/*'] },
    { x: 28, y: 238, w: 224, h: 28, sub: ['skills/**'] },
    { x: 28, y: 276, w: 224, h: 28, sub: ['settings.partial.json'] },
    { x: 28, y: 310, w: 224, h: 26, kind: 'group', sub: ['README.md · tests/'] },

    { x: 296, y: 112, w: 248, h: 196, kind: 'group' },
    { x: 308, y: 124, w: 224, h: 28, kind: 'soft', sub: ['rules/'] },
    { x: 308, y: 162, w: 224, h: 28, kind: 'soft', sub: ['commands/ · agents/'] },
    { x: 308, y: 200, w: 224, h: 28, kind: 'soft', sub: ['hooks/ · lib/ · bin/'] },
    { x: 308, y: 238, w: 224, h: 28, kind: 'soft', sub: ['skills/'] },
    { x: 308, y: 276, w: 224, h: 28, kind: 'soft', sub: ['settings.json (deep-merged)'] },
  ],
  edges: [
    // Horizontal row pairings, left column to right. Left rows all end at
    // x=252 and right rows start at x=308; these keep a 4-unit clearance on
    // both sides rather than vEdge's one-sided ARROW_GAP, so they stay
    // literal.
    { points: [[256, 138], [304, 138]] },
    { points: [[256, 176], [304, 176]] },
    { points: [[256, 214], [304, 214]] },
    { points: [[256, 252], [304, 252]] },
    { points: [[256, 290], [304, 290]] },
  ],
  captions: [
    { x: 16, y: 18, text: 'modules/{name}/', anchor: 'start' },
    { x: 296, y: 104, text: '~/.claude/', anchor: 'start' },
    {
      x: 280,
      y: 360,
      text: 'Only paths declared in files{} install; README.md and tests/ stay in the repo.',
      anchor: 'middle',
    },
  ],
  refs: [
    {
      path: 'modules/branch-guard/module.json',
      role: 'A complete manifest: three files{} entries, one of them merge: true.',
    },
    {
      path: 'modules/branch-guard/rules/branch-guard.md',
      role: 'A rule file -- installs to ~/.claude/rules/ and is always in context.',
    },
    {
      path: 'modules/branch-guard/hooks/branch-guard.py',
      role: 'A hook -- installs to ~/.claude/hooks/ and is invoked by settings.json.',
    },
    {
      path: 'modules/branch-guard/settings.partial.json',
      role: 'The merge fragment: registers the hook on PreToolUse without owning settings.json.',
    },
    {
      path: 'modules/git-worktrees/commands/worktree-start.md',
      role: 'A command file -- installs to ~/.claude/commands/ as a slash command.',
    },
    {
      path: 'modules/subagent-patterns/agents/implementer.md',
      role: 'An agent file -- installs to ~/.claude/agents/ as a subagent prompt.',
    },
    { path: 'lib/merge.sh', role: 'Why settings.partial.json is merged rather than copied over settings.json.' },
  ],
};

// ---------------------------------------------------------------------------
// 3. Hook gate pipeline -- PreToolUse on a Bash tool call
// ---------------------------------------------------------------------------

const hookNodes = {
  call: { x: 170, y: 12, w: 220, h: 34, label: 'Bash tool call' },
  registration: {
    x: 110,
    y: 64,
    w: 340,
    h: 58,
    label: 'hooks.PreToolUse, matcher "Bash"',
    sub: ['~/.claude/settings.json (built by lib/merge.sh)', 'dispatcher + branch-guard.py (standard)'],
  },
  dispatcher: {
    x: 110,
    y: 140,
    w: 340,
    h: 46,
    label: 'Dispatcher: one process, not six',
    sub: ['hooks/pretooluse-bash-dispatch.py'],
  },
  manifest: { x: 40, y: 206, w: 480, h: 190, kind: 'group' },
  precedence: {
    x: 110,
    y: 408,
    w: 340,
    h: 46,
    label: 'hard_block > deny > allow > ask',
    sub: ['hook_dispatcher.DECISION_RANK'],
  },
  hardBlock: {
    x: 50,
    y: 484,
    w: 200,
    h: 46,
    kind: 'soft',
    label: 'exit 2 (bypass-proof)',
    sub: ['hook_utils.hard_block()'],
  },
  decision: {
    x: 310,
    y: 484,
    w: 200,
    h: 46,
    kind: 'soft',
    label: 'decision on stdout',
    sub: ['hook_utils.emit_decision()'],
  },
} satisfies Record<string, DiagramNode>;

const hookGate: DiagramSpec = {
  id: 'hook-gate',
  heading: 'Hook gate pipeline',
  title: 'How a Bash tool call is gated on PreToolUse',
  desc: 'A vertical funnel: a tool call enters a settings.json event registration, reaches the dispatcher, passes a dashed box listing ten priority-ordered checks, then narrows to a precedence rule that splits into two outcomes.',
  summary:
    'On a standard install the Bash matcher holds two entries, and one of them is a dispatcher that runs ten checks in a single process instead of six. One precedence rule -- not array order across modules -- decides the outcome.',
  steps: [
    'A Bash tool call raises the PreToolUse event. ~/.claude/settings.json holds the registrations, assembled by lib/merge.sh from every installed module settings.partial.json.',
    'The matcher "Bash" selects every entry registered against it. On a standard install that is two: hooks/pretooluse-bash-dispatch.py from the hooks module, and hooks/branch-guard.py from branch-guard. This diagram follows the dispatcher.',
    'The dispatcher is one process where there used to be six. lib/hook_dispatcher.py runs a declarative manifest by priority: git_workflow (10), destructive (20), force_branch_delete (25), smart_rules (30), port_advisory (40), agent_tracking (50), migration_timestamp (60), force_push_main (70), careful (80), pattern (90).',
    'A check declaring runs_in_bypass=true still runs in bypass mode; a check declaring short_circuit=true is emitted the instant it fires.',
    'DECISION_RANK resolves what fired: hard_block beats deny, deny beats allow, allow beats ask. Advisory output never changes the decision.',
    'A hard_block leaves via hook_utils.hard_block() and exit 2 -- the one signal honoured regardless of permission mode. Everything else leaves as JSON on stdout via hook_utils.emit_decision().',
    'The same event also has a file-edit arm: branch-guard.py on Edit, MultiEdit, Write, NotebookEdit, and the filesystem-MCP write tools; auto-approve-file-ops.py on Read, Edit, and Write; check-freeze.py on Edit and Write. branch-guard.py is the one hook on both arms -- its second entry is the Bash one above, covering git commit, add, stage, and apply.',
  ],
  width: 560,
  height: 544,
  nodes: Object.values(hookNodes),
  edges: [
    vEdge(280, hookNodes.call, hookNodes.registration),
    vEdge(280, hookNodes.registration, hookNodes.dispatcher),
    vEdge(280, hookNodes.dispatcher, hookNodes.manifest),
    vEdge(280, hookNodes.manifest, hookNodes.precedence),
    // The precedence node forks; both branches drop to a shared y then run
    // out to their own outcome box, so they are polylines rather than vEdges.
    { points: [[280, 454], [280, 468], [150, 468], [150, 482]] },
    { points: [[280, 454], [280, 468], [410, 468], [410, 482]] },
  ],
  captions: [
    { x: 60, y: 226, text: 'lib/hook_dispatcher.py runs the manifest in priority order', anchor: 'start' },
    { x: 62, y: 256, text: '10  git_workflow', anchor: 'start' },
    { x: 62, y: 276, text: '20  destructive', anchor: 'start' },
    { x: 62, y: 296, text: '25  force_branch_delete', anchor: 'start' },
    { x: 62, y: 316, text: '30  smart_rules', anchor: 'start' },
    { x: 62, y: 336, text: '40  port_advisory', anchor: 'start' },
    { x: 300, y: 256, text: '50  agent_tracking', anchor: 'start' },
    { x: 300, y: 276, text: '60  migration_timestamp', anchor: 'start' },
    { x: 300, y: 296, text: '70  force_push_main', anchor: 'start' },
    { x: 300, y: 316, text: '80  careful', anchor: 'start' },
    { x: 300, y: 336, text: '90  pattern', anchor: 'start' },
    {
      x: 62,
      y: 372,
      text: 'runs_in_bypass=true survives bypass mode; short_circuit emits at once',
      anchor: 'start',
    },
  ],
  refs: [
    {
      path: 'modules/hooks/settings.partial.json',
      role: 'The registrations themselves: which hook runs on which event, behind which matcher.',
    },
    {
      path: 'modules/hooks/hooks/pretooluse-bash-dispatch.py',
      role: "The hooks module's PreToolUse:Bash entry point and the declarative manifest it builds.",
    },
    {
      path: 'modules/hooks/lib/hook_dispatcher.py',
      role: 'DECISION_RANK, the bypass short-circuit, and the priority walk.',
    },
    {
      path: 'modules/hooks/lib/pretooluse_bash_checks.py',
      role: 'The ten check functions the manifest names.',
    },
    {
      path: 'modules/hooks/lib/hook_utils.py',
      role: 'hard_block(), emit_decision(), is_bypass_mode(), redact_secrets(), file_locked_append().',
    },
    {
      path: 'modules/branch-guard/hooks/branch-guard.py',
      role: 'The Bash matcher\'s other entry, and the file-edit arm: Edit, MultiEdit, Write, NotebookEdit, and the filesystem-MCP write tools, plus git commit/add/stage/apply on Bash.',
    },
    {
      path: 'modules/hooks/hooks/auto-approve-file-ops.py',
      role: 'The file-edit arm on Read, Edit, and Write; check-freeze.py runs alongside it on Edit and Write.',
    },
  ],
};

// ---------------------------------------------------------------------------
// 4. Multi-agent worktree flow
// ---------------------------------------------------------------------------

const worktreeNodes = {
  delegator: {
    x: 24,
    y: 14,
    w: 240,
    h: 46,
    label: 'Delegator splits the work',
    sub: ['Agent/Workflow isolation: worktree'],
  },
  created: { x: 296, y: 14, w: 240, h: 46, label: 'One worktree per unit', sub: ['.claude/worktrees/<name>'] },
  implement: {
    x: 296,
    y: 82,
    w: 240,
    h: 46,
    label: 'Sub-agent implements',
    sub: ['own index + HEAD, feature branch'],
  },
  merged: { x: 296, y: 150, w: 240, h: 46, label: 'PR opened and merged', sub: ['squash merge onto origin/main'] },
  teardown: {
    x: 296,
    y: 218,
    w: 240,
    h: 52,
    label: 'Teardown (mandatory)',
    sub: ['worktree-sweep.sh --worktree <path>', 'non-force remove, then prune'],
  },
  backstop: {
    x: 24,
    y: 218,
    w: 240,
    h: 52,
    label: '/worktree-sweep backstop',
    sub: ['removes only CLEAN worktrees', 'preserves uncommitted / mid-rebase'],
  },
  branchRule: {
    x: 24,
    y: 300,
    w: 512,
    h: 52,
    kind: 'soft',
    label: 'Branch deleted only when its work is already upstream',
    sub: ['ancestor of the default branch, or patch-equivalent after a squash merge'],
  },
} satisfies Record<string, DiagramNode>;

const worktreeFlow: DiagramSpec = {
  id: 'worktree-flow',
  heading: 'Multi-agent worktree flow',
  title: 'The lifecycle of a git worktree used to isolate one unit of delegated work',
  desc: 'A loop that runs down the right column from delegation to teardown, crosses left to a backstop sweep, and drops into a full-width box stating the rule for deleting the branch.',
  summary:
    'A worktree is created for exactly one unit of work and removed when that unit merges. Teardown is the load-bearing half: a worktree an agent built in never auto-removes.',
  steps: [
    'A delegating command splits the work into independent units and gives each sub-agent its own worktree, via the Agent/Workflow isolation: "worktree" option or /worktree-start.',
    'Each worktree lives under .claude/worktrees/<name>, shares the parent .git, and has its own index and HEAD -- so parallel builds and commits never collide.',
    'The sub-agent implements on a feature branch cut from origin/main and opens a PR.',
    'The PR is reviewed and squash-merged onto main.',
    'The delegator tears that unit down: worktree-sweep.sh --worktree <path> does a non-force git worktree remove, then git worktree prune. Non-force is itself a gate -- git refuses on uncommitted or untracked files.',
    '/worktree-sweep is the orphan backstop for anything the happy path missed. It removes only CLEAN worktrees and preserves any with uncommitted work, untracked files, an in-progress rebase, a lock, or a detached HEAD carrying commits reachable from no ref.',
    'The branch is deleted only when the default branch already contains its work -- either as an ancestor, or patch-equivalent after a squash merge. Anything else is kept and reported.',
  ],
  width: 560,
  height: 380,
  nodes: Object.values(worktreeNodes),
  edges: [
    // Delegator hands off rightward into the per-unit column.
    { points: [[266, 37], [294, 37]] },
    vEdge(416, worktreeNodes.created, worktreeNodes.implement),
    vEdge(416, worktreeNodes.implement, worktreeNodes.merged),
    vEdge(416, worktreeNodes.merged, worktreeNodes.teardown),
    // Teardown back to the backstop: right-to-left, so not a vEdge.
    { points: [[294, 244], [266, 244]], dashed: true },
    vEdge(416, worktreeNodes.teardown, worktreeNodes.branchRule),
    vEdge(144, worktreeNodes.backstop, worktreeNodes.branchRule),
  ],
  captions: [
    { x: 280, y: 370, text: 'git branch -D is denied; the sweep is the permitted path.', anchor: 'middle' },
  ],
  refs: [
    {
      path: 'modules/git-worktrees/lib/worktree-sweep.sh',
      role: 'The janitor: CLEAN vs PRESERVE classification, non-force removal, and the squash-aware branch check.',
    },
    {
      path: 'modules/git-worktrees/rules/git-worktrees.md',
      role: 'The lifecycle contract, the four decided cases, and the 237 GB incident that produced it.',
    },
    {
      path: 'modules/git-worktrees/commands/worktree-start.md',
      role: 'Hands-on creation: gitignore verification, uniqueness checks, project setup.',
    },
    {
      path: 'modules/git-worktrees/commands/worktree-finish.md',
      role: 'The four-option end gate: merge locally, push and PR, keep, or discard.',
    },
    {
      path: 'modules/git-worktrees/commands/worktree-sweep.md',
      role: 'The repo-wide backstop sweep.',
    },
    {
      path: 'modules/multi-agent/rules/multi-agent.md',
      role: 'Why worktrees are the default isolation and when a separate clone is the right call instead.',
    },
  ],
};

// ---------------------------------------------------------------------------
// 5. Memory / learnings loop
// ---------------------------------------------------------------------------

const memoryNodes = {
  session: { x: 180, y: 12, w: 200, h: 40, label: 'Claude Code session', sub: ['~/.claude/projects/**'] },
  capture: {
    x: 30,
    y: 84,
    w: 210,
    h: 66,
    label: 'Capture',
    sub: ['/reflect · /consolidate', 'hooks/reflection-trigger.py', 'hooks/precompact-reflection.py'],
  },
  mining: {
    x: 300,
    y: 84,
    w: 210,
    h: 66,
    label: 'Nightly mining',
    sub: ['bin/dream-daily.sh', 'lib/transcript_miner.py', 'lib/dream_analyze.py'],
  },
  write: {
    x: 30,
    y: 172,
    w: 210,
    h: 66,
    label: 'Write an op-event',
    sub: ['bin/ccgm-learnings-log', 'lib/learnings_store.py', 'add · verify · contradict'],
  },
  proposals: {
    x: 300,
    y: 172,
    w: 210,
    h: 66,
    label: 'Evidence-tagged proposals',
    sub: ['~/.claude/dreaming/proposals/', '/dream-apply human gate'],
  },
  store: {
    x: 90,
    y: 266,
    w: 380,
    h: 64,
    kind: 'soft',
    label: 'Learnings store (append-only JSONL)',
    sub: ['~/.claude/learnings/{slug}/agents/{id}.jsonl', 'confidence decay · staleness · dwell_until'],
  },
  inject: {
    x: 90,
    y: 352,
    w: 380,
    h: 64,
    label: 'SessionStart injection (opt-in)',
    sub: ['hooks/learnings-inject.py', 'CCGM_LEARNINGS_INJECT · source=startup'],
  },
} satisfies Record<string, DiagramNode>;

const memoryLoop: DiagramSpec = {
  id: 'memory-loop',
  heading: 'Memory and learnings loop',
  title: 'How a session writes durable learnings and how they come back',
  desc: 'A cycle. A session forks into two write paths -- in-session capture on the left, nightly transcript mining on the right -- which converge on the append-only store, and the store returns to the session through an opt-in SessionStart injection along the right rail.',
  summary:
    'Learnings are op-events appended to a per-project, per-agent JSONL shard. Two paths write to it -- an in-session reflection and a nightly transcript mining run -- and one opt-in hook reads it back at session start.',
  steps: [
    'A session leaves a transcript under ~/.claude/projects/**. That is the raw material for both write paths.',
    'In-session capture: /reflect and /consolidate, plus hooks/reflection-trigger.py (after a merge) and hooks/precompact-reflection.py (before context compaction).',
    'bin/ccgm-learnings-log appends an op-event through lib/learnings_store.py -- add, verify, contradict, supersede, or deprecate. Content passes a prompt-injection sanitizer on the way in.',
    'The other path is nightly: bin/dream-daily.sh runs lib/transcript_miner.py over the same transcripts, and lib/dream_analyze.py map-reduces them.',
    'Its output lands in ~/.claude/dreaming/proposals/{date}.jsonl and stays pending. /dream-apply is the always-available human gate; opt-in optimistic integration writes behind a dwell window instead.',
    'Both paths converge on one append-only JSONL shard at ~/.claude/learnings/{project-slug}/agents/{agent-id}.jsonl. Reads project the op chain into current heads and apply confidence decay, staleness, and any dwell window.',
    'hooks/learnings-inject.py returns the top-ranked learnings at SessionStart -- but only when the source is startup and CCGM_LEARNINGS_INJECT is set. Unset, it reads stdin and exits having printed nothing.',
  ],
  width: 560,
  height: 440,
  nodes: Object.values(memoryNodes),
  edges: [
    // The session forks at a shared y into the two write columns.
    { points: [[280, 52], [280, 66], [135, 66], [135, 82]] },
    { points: [[280, 52], [280, 66], [405, 66], [405, 82]] },
    vEdge(135, memoryNodes.capture, memoryNodes.write),
    vEdge(405, memoryNodes.mining, memoryNodes.proposals),
    // Both columns step in to their own entry point on the store's top edge.
    { points: [[135, 238], [135, 252], [260, 252], [260, 264]] },
    { points: [[405, 238], [405, 252], [300, 252], [300, 264]] },
    vEdge(280, memoryNodes.store, memoryNodes.inject),
    // The return rail: out of the injection box, up the right margin, back
    // into the session.
    { points: [[470, 384], [536, 384], [536, 32], [382, 32]] },
  ],
  captions: [
    { x: 129, y: 78, text: 'in-session', anchor: 'end' },
    { x: 414, y: 78, text: 'transcripts', anchor: 'start' },
    { x: 528, y: 60, text: 'injected at session start', anchor: 'end' },
  ],
  refs: [
    {
      path: 'modules/self-improving/lib/learnings_store.py',
      role: 'The store: shard layout, op-event projection, confidence decay, sanitizer, dwell window.',
    },
    {
      path: 'modules/self-improving/bin/ccgm-learnings-log',
      role: 'The write CLI: add, verify, contradict, supersede, deprecate.',
    },
    {
      path: 'modules/self-improving/bin/ccgm-learnings-search',
      role: 'The ranked, token-budgeted read path.',
    },
    {
      path: 'modules/self-improving/hooks/learnings-inject.py',
      role: 'The opt-in SessionStart injection and its two no-op conditions.',
    },
    {
      path: 'modules/self-improving/hooks/reflection-trigger.py',
      role: 'Fires the reflection checklist after a PR merge.',
    },
    {
      path: 'modules/dreaming/lib/transcript_miner.py',
      role: 'discover(), mine(), cluster(), budget(), schema_canary() over ~/.claude/projects/**.',
    },
    {
      path: 'modules/dreaming/lib/dream_analyze.py',
      role: 'The map-reduce that turns mined evidence into per-change proposals.',
    },
    {
      path: 'modules/dreaming/bin/dream-daily.sh',
      role: 'The nightly chain: analyze, eval-refresh, optimistic-integrate, digest, reconcile, retention.',
    },
    {
      path: 'modules/dreaming/commands/dream-apply.md',
      role: 'The always-available human gate for a pending proposal.',
    },
  ],
};

/** Every diagram the site draws, in page order. */
export const DIAGRAMS: readonly DiagramSpec[] = [
  installFlow,
  moduleAnatomy,
  hookGate,
  worktreeFlow,
  memoryLoop,
] as const;

// ---------------------------------------------------------------------------
// Traceability link resolution
// ---------------------------------------------------------------------------

export interface ResolvedRef extends DiagramRef {
  /** The ingested module this path belongs to, or null when it is a repo-root file. */
  module: string | null;
  /** Link for the HTML page: site-root-relative when we host the target, else GitHub. */
  href: string;
  /** Always-absolute link, for the `.md` twin and any machine surface. */
  absoluteHref: string;
}

export interface ResolveRefOptions {
  /** The ccgm commit this build ingested -- pins every GitHub link (§1.4 principle 15). */
  sourceSha: string;
  siteUrl: string;
  /** Module names present in this build's ingested index. */
  knownModules: ReadonlySet<string>;
}

const MODULE_PATH = /^modules\/([^/]+)\//;

/**
 * One rule, no special cases: a path inside a module this build actually
 * ingested links to that module's own page on this site; everything else
 * links to a SHA-pinned GitHub blob, which cannot rot when ccgm moves on.
 */
export function resolveRef(ref: DiagramRef, options: ResolveRefOptions): ResolvedRef {
  const match = MODULE_PATH.exec(ref.path);
  const module = match && options.knownModules.has(match[1]) ? match[1] : null;

  if (module) {
    return {
      ...ref,
      module,
      href: `/modules/${module}`,
      absoluteHref: `${options.siteUrl}/modules/${module}.md`,
    };
  }

  const blob = `${CCGM_REPO_URL}/blob/${options.sourceSha}/${ref.path}`;
  return { ...ref, module: null, href: blob, absoluteHref: blob };
}

export function resolveRefs(refs: readonly DiagramRef[], options: ResolveRefOptions): ResolvedRef[] {
  return refs.map((ref) => resolveRef(ref, options));
}
