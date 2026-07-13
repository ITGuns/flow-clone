import { defineConfig } from 'vitest/config';

export default defineConfig({
  // React renderer tests use the automatic JSX runtime; no `import React` needed.
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
