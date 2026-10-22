import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    // Each file boots its own in-memory MongoDB; allow time for the first download/start.
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
