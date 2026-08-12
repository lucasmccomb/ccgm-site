// @ts-check
import js from '@eslint/js';
import astroPlugin from 'eslint-plugin-astro';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      '.astro/**',
      '.wrangler/**',
      'node_modules/**',
      'src/generated/**',
      'playwright-report/**',
      'test-results/**',
      '.ccgm-src/**',
      'public/fonts/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...astroPlugin.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
);
