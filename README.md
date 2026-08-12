# ccgm-site

Landing + module-catalog site for CCGM (Claude Code God Mode) at ccgm.dev.
Astro 5 static site, Tailwind v4, content generated from the
[`lucasmccomb/ccgm`](https://github.com/lucasmccomb/ccgm) repo at build time.

## Dev quickstart

```bash
pnpm install
pnpm build      # fonts:sync -> ingest -> astro build -> gen:headers -> pagefind
pnpm test       # vitest, run after a build (several tests read dist/)
pnpm test:e2e   # playwright, against the built dist/ output
pnpm dev        # local dev server (astro dev)
```

`pnpm build` and `pnpm test` must run in that order locally, same as CI: several
unit tests (the inline-emission guard, the webfont `url()` resolution check,
the reserved-route guard) read `dist/` and fail loudly -- never skip -- when
it does not exist yet.

## Build pipeline order

```
pnpm fonts:sync   # sync self-hosted webfonts from @fontsource* into public/fonts/
pnpm ingest       # parse ccgm's modules into src/generated/ (E1: fixture-backed stub)
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
CSP token. Today that scan finds **zero** inline scripts -- `ThemeInit.astro`
is still an E1 placeholder that E3 fills with the real `?theme=`
review-override script -- so the sha256 token is gracefully omitted. Once E3
lands, there is exactly one.

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

## Testing

- **Unit** (`pnpm test`, Vitest): `src/lib/site.ts` helpers, `_headers`
  generation, and structural invariants read from `dist/`.
- **E2E** (`pnpm test:e2e`, Playwright): two server targets --
  `astro preview` (the bulk suite, Chromium + WebKit) and
  `wrangler pages dev dist` (the "headers" project, the only place the site
  is exercised under its real CSP).
