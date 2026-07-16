import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Package root, resolved from this file's URL so the config is location-independent.
const root = fileURLToPath(new URL('.', import.meta.url));

// Static multi-page site. `base: './'` emits relative asset URLs so the built `dist/`
// drops onto any static host (root domain, sub-path, S3, GitHub Pages) with no rewrites.
export default defineConfig({
  root,
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(root, 'index.html'),
        pricing: resolve(root, 'pricing.html'),
        privacy: resolve(root, 'privacy.html'),
        terms: resolve(root, 'terms.html'),
      },
    },
  },
});
