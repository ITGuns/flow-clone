import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // The build-output guard runs a real `vite build`; give it room on cold CI runners.
    testTimeout: 60000,
  },
});
