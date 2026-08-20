/**
 * Per-rule .md twin (#22). All the decision logic -- inline the body under
 * the cap, fall back to the raw-endpoint link over it, never inline a
 * merge fragment -- lives in buildRuleTwin() (src/lib/rules.ts), the same
 * separation src/pages/modules/[name].md.ts keeps with module-twin.ts.
 */
import type { APIRoute, GetStaticPaths } from 'astro';
import { loadModulesIndex } from '../../../lib/generated.ts';
import { buildRuleTwin, collectRules } from '../../../lib/rules.ts';
import { SITE_URL } from '../../../lib/site.ts';

export const prerender = true;

export const getStaticPaths: GetStaticPaths = () => {
  const { modules } = loadModulesIndex();
  return collectRules(modules).map((rule) => ({
    params: { module: rule.moduleName, slug: rule.slug },
  }));
};

export const GET: APIRoute = ({ params }) => {
  const { meta, modules } = loadModulesIndex();
  const rule = collectRules(modules).find(
    (candidate) => candidate.moduleName === params.module && candidate.slug === params.slug,
  );
  if (!rule) return new Response('Not found', { status: 404 });

  const frontMatter = {
    schemaVersion: meta.schemaVersion,
    module: rule.moduleName,
    rule: rule.path,
    sourceSha: meta.sourceSha,
    generatedAt: meta.generatedAt,
  };

  const { text } = buildRuleTwin(rule, { siteUrl: SITE_URL, sourceSha: meta.sourceSha, frontMatter });

  return new Response(text, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
};
