import { defineConfig } from 'vitest/config';

// Default to the node environment (real file: URLs, so the shared package's golden fixture loader
// resolves cleanly). Component tests that need a DOM opt into jsdom with a per-file docblock:
//   // @vitest-environment jsdom
export default defineConfig({
  // Automatic JSX runtime — component tests need no `import React`.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    testTimeout: 60000,
  },
});
