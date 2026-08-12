import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import { SITE_URL } from './src/lib/site.ts';

// https://astro.build/config
export default defineConfig({
  site: SITE_URL,
  output: 'static',
  build: {
    // Astro's default ('auto') inlines sub-4kB stylesheets as <style>
    // elements, which style-src 'self' blocks under this site's CSP.
    inlineStylesheets: 'never',
  },
  vite: {
    plugins: [tailwindcss()],
    build: {
      // Astro inlines small client <script> chunks below this threshold
      // the same way it would inline small stylesheets -- there is no
      // per-script equivalent of build.inlineStylesheets: 'never', so this
      // is the mechanism that keeps CopyButton/CommandTabs's bundled
      // scripts external. The one inline script this site ever emits is
      // ThemeInit's (§3.5, hashed into CSP by scripts/gen-headers.ts).
      assetsInlineLimit: 0,
    },
  },
});
