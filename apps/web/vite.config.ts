import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Single-page dashboard. `base: './'` emits relative asset URLs so the built `dist/` drops onto any
// static host. JSX is handled by esbuild's automatic runtime (no plugin dep needed) — the same
// convention the desktop renderer uses.
const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  base: './',
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      // Bundle only the browser-safe subset of the contracts package — see src/shared-browser.ts.
      // (Tests keep the real barrel: they run under the node environment where the golden loader is
      // fine.) Exact match so deep imports, if any, are untouched.
      '@undertone/shared': fileURLToPath(new URL('./src/shared-browser.ts', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
