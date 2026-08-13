/**
 * Raw single-file content -- the granular fetch an agent actually needs
 * (§3.4). Byte-exact vs the source: no sanitization-safe transform here
 * beyond what ingest already applied (Unicode stripping + relative-link
 * rewriting on .md files), and deliberately NO provenance preamble --
 * prepending one would break the byte-exact copy contract this endpoint
 * exists to serve (§1.4 principle 8's carve-out; see markdown.ts).
 *
 * The `.txt` suffix is part of the published contract: this route file is
 * what emits it.
 */
import type { APIRoute, GetStaticPaths } from 'astro';
import { loadModulesIndex } from '../../../../lib/generated.ts';

export const prerender = true;

export const getStaticPaths: GetStaticPaths = () => {
  const { modules } = loadModulesIndex();
  const paths: Array<{ params: { name: string; path: string } }> = [];
  for (const mod of modules) {
    for (const file of mod.contentFiles) {
      paths.push({ params: { name: mod.name, path: file.path } });
    }
    if (mod.postInstallFile && !mod.contentFiles.some((f) => f.path === mod.postInstallFile!.path)) {
      paths.push({ params: { name: mod.name, path: mod.postInstallFile.path } });
    }
  }
  return paths;
};

export const GET: APIRoute = ({ params }) => {
  const { modules } = loadModulesIndex();
  const mod = modules.find((m) => m.name === params.name);
  if (!mod) return new Response('Not found', { status: 404 });

  const file =
    mod.contentFiles.find((f) => f.path === params.path) ??
    (mod.postInstallFile?.path === params.path ? mod.postInstallFile : undefined);
  if (!file) return new Response('Not found', { status: 404 });

  return new Response(file.content, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
