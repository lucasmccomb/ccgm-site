# ccgm-site

Landing + module-catalog site for CCGM (Claude Code God Mode) at ccgm.dev.
Astro 5 static site, Tailwind v4, content generated from the
[`lucasmccomb/ccgm`](https://github.com/lucasmccomb/ccgm) repo at build time.

## Dev quickstart

```bash
pnpm install
pnpm build      # fonts:sync -> ingest -> banner -> astro build -> gen:headers -> pagefind
pnpm test       # vitest, run after a build (several tests read dist/)
pnpm test:e2e   # playwright, against the built dist/ output
pnpm dev        # local dev server (astro dev)
```

`pnpm build` and `pnpm test` must run in that order locally, same as CI: several
unit tests (the inline-emission guard, the webfont `url()` resolution check,
the reserved-route guard) read `dist/` and fail loudly -- never skip -- when
it does not exist yet.

## Architecture overview

This is a static site with no server, no database, and no auth. Everything
below happens at build time; nothing happens at request time except serving
files Cloudflare Pages already built.

```
lucasmccomb/ccgm (public repo, main @ SHA)
        |  git clone (into .ccgm-src/)
        v
scripts/ingest.ts ──> src/generated/  (modules-index.json, presets.json)
        v
Astro 5 build (content collections)   ──> dist/  (HTML pages, .md twins,
        v                                        llms.txt/llms-full.txt,
scripts/gen-headers.ts ──> dist/_headers          modules.json/presets.json)
        v
pagefind --site dist  (search index)
        v
Cloudflare Pages (Git-integrated: push to main auto-deploys)
```

Three things keep content current without a human in the loop:

- **Per-PR previews** -- every PR to this repo gets its own preview deployment.
- **Per-merge rebuild** -- ccgm's `.github/workflows/site-deploy-hook.yml`
  POSTs this repo's Cloudflare Deploy Hook on every push to ccgm's `main`
  (see "Rebuild automation" below).
- **Nightly rebuild** -- `.github/workflows/nightly-rebuild.yml` re-ingests
  ccgm main once a day regardless, as the backstop for a quiet day on ccgm
  and the scheduled drift/census check.

## Ingest contract

`scripts/ingest.ts` is the only place that reads ccgm's repo content. It
clones (or refreshes) `lucasmccomb/ccgm` into `.ccgm-src/` (override with
`$CCGM_SRC_DIR`), then parses `modules/*/module.json`, every module's text
files, `presets/*.json`, `docs/preset-descriptions.json`, and
`.claude-plugin/marketplace.json`. `--repo-dir <path>` skips the clone and
parses a given directory instead (fixtures, offline dev, and the
local/test-only paths in `scripts/nightly-check.ts`) -- this flag is never
wired into the real Cloudflare Pages build, which always clones.

Per-module parse errors are collected into `meta.skippedModules` and never
fail the run -- one broken `module.json` degrades that module's page, it
does not break the site. Every string field is passed through a sanitizer
that strips zero-width and bidirectional control characters before it
reaches a copy surface; any file that was actually affected is listed in
`meta.sanitizedFiles`.

**Facts about ccgm's real data** (verified 2026-08-04, ccgm plan §1.4 --
trust the live `src/generated/modules-index.json` over this list, since
ccgm adds roughly six modules a month): 78 modules, `module.json.files` is
a keyed object (not an array) with 508 entries across 12 real `type`
values (`script`, `doc`, `lib`, `command`, `rule`, `hook`, `agent`,
`skill`, `content`, `config`, `settings`, `skill-reference`); 12 files
carry `merge: true` (settings fragments -- never rendered as a plain copy
target, since copying one over `settings.json` would overwrite it rather
than merge); some declared files have no extension (content-sniffed, not
extension-filtered); `presets/*.json` are bare arrays of module names with
no `description` field; `marketplacePlugin` is true for all 78 modules
(a perfect bijection with `.claude-plugin/marketplace.json`); most module
descriptions exceed llms.txt's 120-char line budget, so `summarize()` is a
real transformation the site performs, not a property of the source data.

## Build pipeline order

```
pnpm fonts:sync   # sync self-hosted webfonts from @fontsource* into public/fonts/
pnpm ingest       # parse ccgm's modules into src/generated/
pnpm banner       # generate the landing page's ASCII hero banner into src/generated/
astro build       # emit dist/
pnpm gen:headers  # write dist/_headers from the BUILT output (see below)
pagefind --site dist   # build the search index
```

This exact order is load-bearing:

- `fonts:sync` must run before the build so `url()` references in built CSS
  resolve to files that already exist in `public/fonts/`.
- `ingest` must run before `astro build` because the site's content
  collection (`src/content.config.ts`) loads `src/generated/modules-index.json`.
- `gen:headers` must run **after** `astro build`, because the CSP's
  inline-script hash is computed by scanning the *built* HTML output, not
  source files -- see "The `_headers` file" below.

## The `_headers` file has exactly one producer

`scripts/gen-headers.ts` is the **sole** producer of `dist/_headers`. There is
no `public/_headers` -- Astro empties `outDir` and then copies `public/` over
it, so a committed literal there would silently overwrite the generated file
(or be erased by a generator that ran before `astro build`, if one existed).

`gen-headers.ts` scans every built HTML page for inline `<script>` elements
and hashes the one distinct script body it finds, embedding a `sha256-...`
CSP token. `ThemeInit.astro`'s `?theme=` review-override script is that one
inline script (see below); a build with zero inline scripts is handled
gracefully too (the token is omitted), but today's build always has exactly
one -- `tests/unit/repo-invariants.test.ts` asserts the count directly.

### The complete `_headers` rule set

This is what `gen-headers.ts` writes, generated fresh on every build (never
committed as a literal):

```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://static.cloudflareinsights.com 'sha256-{theme-init-hash}'; connect-src 'self' https://cloudflareinsights.com; style-src 'self'; img-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  X-Llms-Txt: {SITE_URL}/llms.txt
  Link: <{SITE_URL}/llms.txt>; rel="llms-txt"
/llms.txt
  Content-Type: text/plain; charset=utf-8
/llms-full.txt
  Content-Type: text/plain; charset=utf-8
/*.md
  Content-Type: text/markdown; charset=utf-8
  X-Robots-Tag: noindex, nofollow
/*.json
  Content-Type: application/json
```

The `/*` block applies to every path on the site -- security headers and
the discovery headers are global by design, so an agent finds `/llms.txt`
from any single request. The path-scoped blocks below it only add a
`Content-Type` (and, for `.md`, `X-Robots-Tag`) on top of whatever `/*`
already set; Cloudflare Pages applies every matching rule and concatenates
repeated header values, which is also why there is deliberately no rule
for the raw per-file `/modules/*/files/*.txt` endpoints -- a `/modules/*`
rule would concatenate with `/*.md`/`/*.json` on any file that happened to
share a suffix. Cloudflare's own MIME inference already serves `.txt` as
`text/plain; charset=utf-8` with no explicit rule needed.

**For the `ccgm-desktop-app` plan, which extends this same repo and Pages
project later:** any `_headers` rule it adds must be scoped to its own
reserved paths (`/download`, `/api/latest`, `/appcast.xml`, `/latest.json`,
`/install.sh`, and the `downloads.ccgm.dev` subdomain -- see
`RESERVED_ROUTES` in `src/lib/site.ts`) and must never touch or overwrite
the `/*` block above. The two rule sets are additive, not competing.

## Cross-repo write access (§3.4 write-access contract)

`main` on this repo is protected by a required, blocking CI check (full
ingest + build + Playwright E2E). The `ccgm-desktop-app` plan's release
pipeline will write `appcast.xml` and `latest.json` into this repo from a
separate workflow. Those two facts only work together under one rule:
**cross-repo release artifacts land via a PR from a bot branch, scoped to
the reserved paths above -- never a direct push to `main`, and never a
protection-bypass.** The required check stays required for every PR,
including that one; if release latency ever matters, the fix is a
path-filtered lightweight workflow on top of the existing gate, not a
weaker gate. Budget accordingly: each release costs a full site rebuild
plus a full E2E run, on top of the per-PR preview, the per-ccgm-merge
rebuild, and the nightly.

**Naming flag for that plan:** this site's own `/install` page and its
reserved `/install.sh` route are a near-collision. The desktop plan should
consider `/get.sh` instead when it claims that surface.

## The `?theme=` review override

Three theme candidates (`ascii`, `minimal`, `serif`) are built as complete
`data-theme` token layers. Exactly one ships as the default, set via
`DEFAULT_THEME` in `src/lib/site.ts` and rendered statically into
`<html data-theme="...">` -- the page is fully themed even with JavaScript
disabled.

**No user-facing theme switcher ships.** The `?theme=` query parameter
(implemented in E3's `ThemeInit.astro`) is a review/dev mechanism only: it
lets a reviewer preview a candidate on a live deployment
(`https://ccgm-site.pages.dev/?theme=minimal`), persists the override to
`sessionStorage` for the rest of that browsing session, and is otherwise
invisible. It is documented here, not in any shipped UI.

## Frozen semantic token names

`src/styles/global.css` declares these token slots on `:root`. Every theme
in `src/styles/themes/*.css` (E3) must set exactly these names -- no renames
or removals; additive extension is permitted only alongside a matching
update to the plan and this list.

```
--color-bg          --color-fg           --color-accent
--color-surface-1    --color-surface-2    --color-surface-3    --color-surface-4
--color-border
--font-display       --font-body          --font-mono
--radius             --tracking-display   --measure
--space-unit         --density            --layout-max         --chrome-style
--rule-style
```

The last five (`--space-unit`, `--density`, `--layout-max`, `--chrome-style`,
`--rule-style`) are layout-bearing: they exist so the three themes can differ
structurally, not just in colour and type.

## Never `wrangler pages deploy`

This site's Cloudflare Pages project is Git-integrated: pushes to `main`
auto-deploy. `wrangler` is a devDependency only for `wrangler pages dev dist`,
which serves `dist/` locally under its own `_headers`/CSP for the "headers"
Playwright project. There is no `deploy` or `pages` script in `package.json`,
and a unit test asserts neither any `package.json` script nor any
`.github/workflows/*` file contains the string `pages deploy`.

## Size-budget contract

Every published machine artifact carries a stated cap and a unit test that
asserts it (`tests/unit/budgets.test.ts`, `tests/unit/pagefind-budget.test.ts`,
`tests/unit/inline-budget.test.ts`):

| Artifact | Cap | When exceeded |
|---|---|---|
| `/llms.txt` | 50 KB | Sharded by category (`/llms-{category}.txt`) if it ever binds -- the cap is never raised. |
| `/llms-full.txt` | 1 MB | Already excludes full file bodies -- follow each file's `rawUrl` for content. |
| `/modules.json` | 1 MB | Per-file bodies live outside this index, so it is not expected to bind. |
| `/modules/{name}.json` | 512 KB | `contentTruncated: true` is set; consumers use each file's `rawUrl` + `bytes` instead of the inline body. |
| Module detail page (HTML) | 250 KB of inlined file content | Remaining files render as a bounded preview plus a raw-text link, with a visible count of what is not inlined. |
| Pagefind search index | 2 MB | Module file-content sections are `data-pagefind-ignore`d so the index scales with prose, not with the 4.6 MB source corpus. |
| Landing page transfer (document + CSS + JS, excl. fonts) | 300 KB | Asserted in `e2e/perf.spec.ts`. |
| Full `pnpm build` duration | see below | Cloudflare Pages hard-times-out builds at 20 minutes. |

**Build duration.** Measured locally (`time pnpm build`, real ingest against
ccgm main, M-series Apple Silicon): under 10 seconds end to end. Cloudflare
Pages' own build environment differs (cold clone, shared build workers, no
local caches) -- the authoritative number is the first real Cloudflare Pages
build, captured once HE1 (Pages project creation) lands; until then this
line is a lower bound, not the production figure. Module file bodies render
as plain `<pre>` blocks with no build-time syntax highlighting specifically
to keep this budget away from the 20-minute ceiling -- running 4.6 MB of
Python, shell, and JSON through a highlighter is the most likely way this
build would approach it.

## Structural invariants vs. census facts

Two different things can go wrong with the ingest pipeline, and they are
checked two different ways (ccgm plan §1.4 principle 13):

- **Structural invariants** are properties of the *pipeline*, true for any
  input ccgm could produce -- every declared file is emitted or explained,
  every `rawUrl` resolves, no reserved route is claimed, every artifact
  carries its size cap or degrades per its documented rule, every twin
  carries the data-not-instructions preamble. These live in
  `tests/unit/repo-invariants.test.ts`, are **hard-asserted in the blocking
  gate**, and are never weakened, deleted, or made conditional. A red
  structural invariant means the site is wrong -- fix the pipeline, never
  the assertion.
- **Census facts** are properties of ccgm *this week* -- module count, file
  count, the `type`/`status` histograms, preset names and sizes, and
  whether `skippedFiles`/`sanitizedFiles`/dangling-dependency lists are
  empty. These live in the committed `tests/fixtures/repo-census.json`
  snapshot and are **compared, never asserted**: `pnpm census:check`
  reports a delta as a non-blocking note (in CI, and in the nightly
  workflow's `ingest-drift` issue) and exits 0 either way.

**The maintenance ritual:** when `pnpm census:check` reports a delta (ccgm
added or removed a module, changed a preset, etc.), run
`pnpm census:update` to refresh the snapshot, and correct the matching
fact in this README's "Ingest contract" section in the *same* PR. Never
promote a census fact into a hard assertion to "catch drift" -- that is
what turns an ordinary ccgm module addition into a red gate on an
unrelated PR, and ccgm adds roughly six modules a month.

## Rebuild automation

Three things keep the deployed site in sync with ccgm, each with its own
verification step -- POSTing the Cloudflare Deploy Hook is not evidence a
rebuild actually happened, since a Cloudflare-side build failure (a
transient clone error, a registry hiccup, an OOM on the 4.6 MB content
build) is invisible outside the CF dashboard and would otherwise leave
GitHub Actions green while the site quietly goes stale:

1. **Per-merge trigger** (`ccgm/.github/workflows/site-deploy-hook.yml`,
   lives in the ccgm repo, not here). On push to ccgm's `main`, it POSTs
   this repo's Deploy Hook (`$CCGM_SITE_DEPLOY_HOOK_URL`, skip-with-notice
   when the secret is unset) and polls `/modules.json` for `generatedAt`
   to advance with a matching `sourceSha`. This workflow is a **guest** in
   ccgm (ccgm plan §1.4 principle 16): the POST and the poll both run
   `continue-on-error: true` so a Cloudflare outage never reds ccgm's
   main-branch CI, and a verification failure opens an issue **on ccgm
   itself** (label `ccgm-site-deploy-stale`) using ccgm's own
   `GITHUB_TOKEN` -- no cross-repo credential exists anywhere in this
   design.
2. **Nightly rebuild** (`.github/workflows/nightly-rebuild.yml`, 03:00
   UTC + `workflow_dispatch`). The zero-merge-day backstop and the drift
   check. Runs `scripts/nightly-check.ts`: real ingest against ccgm main,
   a full build, and the full unit suite (matching `ci.yml`'s own
   ingest -> build -> test order). A pipeline failure opens/updates an
   `ingest-drift` issue and **skips** the rebuild -- never deploy on top
   of a broken pipeline. A census delta opens/updates the same issue
   naming the delta and **rebuilds anyway** (a new ccgm module is content,
   not breakage). Otherwise it POSTs the hook, polls for the deploy to
   land (`scripts/verify-rebuild.sh`), and separately confirms the live
   `sourceSha` is the ccgm HEAD it ingested at start or a descendant of it
   (so a merge landing mid-poll never raises a false alarm), opening/
   updating a `deploy-stale` issue on any of those failing.
   `workflow_dispatch` accepts an optional `repo_dir` input (a local/test-only
   `--repo-dir` fixture path, e.g. `tests/fixtures/ccgm-mini`) to exercise
   the drift-check/census paths on demand -- passing it always suppresses
   the hook POST and verification poll, regardless of the separate
   `suppress_hook` input, since a fixture run's `sourceSha` is never a real
   ccgm commit and must never reach the real deployment.
3. **Verification scripts**, runnable against any deployment (local
   wrangler, a PR preview, or production):
   - `scripts/verify-headers.sh <base-url>` -- security + discovery
     headers on `/`, plus content types for `/llms.txt`, `/llms-full.txt`,
     a `.md` twin (+ `X-Robots-Tag`), `/modules.json`, `/presets.json`,
     and one raw per-file `.txt` endpoint (discovered from `/modules.json`,
     never hardcoded).
   - `scripts/verify-links.sh <base-url>` -- resolves every absolute URL
     `/llms.txt` and the discovery headers emit against the deployment
     under test, by swapping the origin and checking the path. Catches a
     build whose baked-in `SITE_URL` doesn't match the server actually
     serving it.
   - `scripts/verify-rebuild.sh [base-url]` -- poll-only by default
     (watches `/modules.json` for `generatedAt` to advance, 15-minute
     timeout); POSTs the hook only when `$CCGM_SITE_DEPLOY_HOOK_URL` is
     already in the environment, which is true inside the two workflows
     above and false everywhere else, including an agent session -- the
     hook URL is never meant to enter one. `--expect-site-sha <sha>` polls
     for the live `siteSha` to equal a given ccgm-site commit instead, the
     "this deployment is this commit" oracle used at final bring-up.

## Testing

- **Unit** (`pnpm test`, Vitest): `src/lib/site.ts` helpers, `_headers`
  generation, structural invariants read from `dist/`, and the
  nightly-rebuild decision logic (`tests/unit/nightly-check.test.ts`).
- **E2E** (`pnpm test:e2e`, Playwright): two server targets --
  `astro preview` (the bulk suite, Chromium + WebKit, including the
  landing-page transfer-size budget in `e2e/perf.spec.ts`) and
  `wrangler pages dev dist` (the "headers" project, the only place the site
  is exercised under its real CSP -- `e2e/headers.spec.ts` also shells out
  to `scripts/verify-headers.sh` against that server). Both ports default to
  4321 / 8788 but are overridable via `E2E_PORT_PREVIEW` / `E2E_PORT_HEADERS`,
  so sibling worktrees can run `test:e2e` at the same time without colliding
  on the default ports.
