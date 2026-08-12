# ccgm-mini fixture

A minimal, deterministic stand-in for the real `lucasmccomb/ccgm` repo,
used by `scripts/ingest.ts`'s real ingest pipeline (E2) and its unit
tests. Five module directories and two preset files:

- `sample-core` / `sample-workflow` / `sample-tech` (E1): the `core`,
  `workflow`, and `tech-specific` categories, a dependency link
  (`sample-workflow` → `sample-core`), one config prompt, one
  `template: true` file, and a `sample` preset covering two of the three.
- `sample-hazards` (E2): every remaining ingest hazard in one module --
  an extension-less executable, a `merge: true` settings fragment,
  placeholder-templated + scaffold-templated + runtime-placeholder files
  (exercising the `template === true && __VAR__` conjunction), a binary
  asset, an in-repo symlink that escapes its own module dir, an
  out-of-clone symlink (refused), an unknown declared file `type`
  (`"widget"`), an XSS-payload + bidi/zero-width-payload README with
  relative links to both a declared and an undeclared file, and a
  `postInstall` target outside `files[]`.
- `sample-malformed` (E2): a `module.json` with a trailing comma (invalid
  JSON), exercising the collect-and-skip contract -- this module lands in
  `meta.skippedModules`, and every other fixture module still ingests.
- `presets/bad-preset.json` (E2): a JSON object, not a bare array --
  exercises the `presets/*.json` structural refusal (never a sixth
  preset).
