# ccgm-mini fixture

A minimal, deterministic stand-in for the real `lucasmccomb/ccgm` repo,
used by `scripts/ingest.ts`'s E1 contract stub (and, in E2, by the real
ingest pipeline's unit tests). Three modules covering the `core`,
`workflow`, and `tech-specific` categories, a dependency link
(`sample-workflow` → `sample-core`), one config prompt, one `template:
true` file, and one preset (`sample`) covering two of the three modules.
